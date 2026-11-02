// Real worker interface; owned target observes a held input before triggering failure.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { commandWorkerIdentity } from "./pi-host-command.mjs";
import { retainPointerOwner } from "./pointer-input-safety.mjs";

const cases = ["key-cancel", "key-error", "button-cancel", "button-error"];
if (process.argv.includes("--plan")) {
  console.log(
    JSON.stringify({
      cases,
      physicalInput: true,
      humanKeyRequired: false,
      clipboard: false,
    }),
  );
} else {
  const { WorkerClient } = await import("../dist/client.js");
  const { nativeWorkerLaunch } = await import("../dist/launcher.js");
  assert.equal(process.platform, "win32");
  assert.equal(
    process.env.PI_CU_DEDICATED_INPUT_DESKTOP,
    "1",
    "Idle Windows desktop required",
  );
  const folder = await mkdtemp(join(tmpdir(), "pi-cu-held-"));
  process.env.PI_CU_SETTINGS_FILE = join(folder, "settings.json");
  await writeFile(process.env.PI_CU_SETTINGS_FILE, "{}");
  const executable = join(folder, "fixture.exe");
  const built = spawnSync(
    join(
      process.env.WINDIR,
      "Microsoft.NET",
      "Framework64",
      "v4.0.30319",
      "csc.exe",
    ),
    [
      "/nologo",
      "/target:exe",
      `/out:${executable}`,
      "/r:System.Windows.Forms.dll",
      "/r:System.Drawing.dll",
      fileURLToPath(new URL("./stop-busy-fixture.cs", import.meta.url)),
    ],
    { encoding: "utf8", windowsHide: true },
  );
  assert.equal(built.status, 0, built.stdout + built.stderr);
  const results = [];
  for (const scenario of cases) {
    const fixture = spawn(executable, [`Pi Held Input ${scenario}`, "held"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const closed = once(fixture, "close");
    fixture.stderr.resume();
    const lines = createInterface({ input: fixture.stdout });
    const waiting = [],
      saved = [];
    lines.on("line", (value) => {
      const i = waiting.findIndex((w) => w.prefix === value.split(":")[0]);
      if (i < 0) saved.push(value);
      else {
        const w = waiting.splice(i, 1)[0];
        clearTimeout(w.timer);
        w.resolve(value);
      }
    });
    const line = (prefix) => {
      const i = saved.findIndex((value) => value.split(":")[0] === prefix);
      if (i >= 0) return Promise.resolve(saved.splice(i, 1)[0]);
      return new Promise((resolve, reject) => {
        const item = {
          prefix,
          resolve,
          timer: setTimeout(
            () => reject(Error(`Fixture ${prefix} timed out`)),
            10000,
          ),
        };
        waiting.push(item);
      });
    };
    const ask = async (command, prefix = command) => {
      const response = line(prefix);
      fixture.stdin.write(`${command}\n`);
      return response;
    };
    const worker = new WorkerClient({ launch: nativeWorkerLaunch });
    const operation = `held-${scenario}`;
    let attempted = false,
      inputClean = false,
      osReleased = false,
      settled = false,
      controlReleased = false;
    const releaseControl = async () => {
      if (!settled) {
        const end = await worker.execute(
          "operation_end",
          {},
          undefined,
          operation,
        );
        assert.equal(end.ok, true, JSON.stringify(end));
        settled = true;
      }
      const after = await worker.execute("health", {});
      assert.equal(after.control.exclusiveControl, false);
      assert.equal(after.control.physicalKeysHeld, 0);
      assert.equal(after.control.physicalButtonsHeld, 0);
      controlReleased = true;
    };
    try {
      const target = {
        nativeWindowHandle: Number((await line("ready")).split(":")[1]),
        processId: fixture.pid,
      };
      assert.ok(target.nativeWindowHandle > 0);
      // Same-launcher invalid-target refusal exercises acquisition and settlement
      // before any input; it does not claim a held-input crash guarantee.
      const guarded = await worker.execute(
        "click",
        { nativeWindowHandle: 1, processId: 1, x: 0, y: 0 },
        undefined,
        "preflight",
      );
      assert.equal(guarded.ok, false);
      assert.equal(guarded.cleanupConfirmed, true);
      assert.match(guarded.error, /^TARGET_IDENTITY_CHANGED/);
      assert.equal(
        (await worker.execute("operation_end", {}, undefined, "preflight")).ok,
        true,
      );
      const health = await worker.execute("health", {});
      const workerPin = commandWorkerIdentity(
        process.execPath,
        health.processId,
      );
      assert.ok(workerPin);
      const prepared = await worker.execute(
        "prepare_input",
        {},
        undefined,
        operation,
      );
      assert.equal(prepared.ok, true);
      const armed = (
        await ask(`arm:${scenario}:${prepared.cancelEvent}`, "armed")
      )
        .split(":")
        .slice(1)
        .map(Number);
      assert.equal(armed.length, 2);
      const activation = await worker.execute(
        "activate_window",
        target,
        undefined,
        operation,
      );
      assert.equal(activation.activated, true, JSON.stringify(activation));
      assert.equal(await ask("foreground"), "foreground:1");
      const heldReceipt = line("held");
      // Attach rejection handling before dispatch. No unbounded wait or repeated input.
      const observed = heldReceipt.then(
        (value) => ({ value }),
        (error) => ({ error: String(error) }),
      );
      const button = scenario.startsWith("button");
      attempted = true;
      const response = await worker.execute(
        button ? "drag" : "keypress",
        button
          ? {
              ...target,
              path: Array.from({ length: 100 }, (_, i) => ({
                x: armed[0] + (i % 2),
                y: armed[1],
              })),
              activate: false,
            }
          : { ...target, keys: ["Ctrl", "Alt", "A"], activate: false },
        undefined,
        operation,
      );
      inputClean = response.cleanupConfirmed === true;
      osReleased = (await ask("released")) === "released:1";
      const held = await observed;
      assert.equal(
        held.value,
        `held:${button ? 1 : 17}:1:${scenario}`,
        JSON.stringify(held),
      );
      assert.equal(response.ok, false, JSON.stringify(response));
      assert.equal(inputClean, true, JSON.stringify(response));
      assert.match(
        response.error,
        scenario.endsWith("cancel")
          ? /COMPUTER_USE_STOPPED/
          : /TARGET_(IDENTITY_CHANGED|FOREGROUND_CHANGED|DISABLED)/,
      );
      assert.equal(osReleased, true);
      await releaseControl();
      await worker.dispose();
      assert.equal(
        commandWorkerIdentity(process.execPath, workerPin.pid),
        undefined,
      );
      results.push({
        scenario,
        heldObservedAtTrigger: true,
        error: response.error,
        cleanupConfirmed: true,
        osInputsReleased: true,
        controlReleased: true,
        workerExited: true,
      });
      console.log(JSON.stringify(results.at(-1)));
    } catch (error) {
      console.error(
        JSON.stringify({
          scenario,
          error: String(error),
          attempted,
          inputClean,
          settled,
          folder,
        }),
      );
      if (attempted && inputClean && osReleased && !controlReleased) {
        try {
          await releaseControl();
        } catch (cleanupError) {
          console.error(String(cleanupError));
        }
      }
      if (
        attempted &&
        (!inputClean || !osReleased || !settled || !controlReleased)
      ) {
        worker.stopOperation(operation);
        await retainPointerOwner();
      }
      throw error;
    } finally {
      if (!attempted || inputClean) {
        if (!settled)
          assert.equal(
            (await worker.execute("operation_end", {}, undefined, operation))
              .ok,
            true,
          );
        await worker.dispose();
        fixture.stdin.write("stop\n");
        const [code] = await closed;
        assert.equal(code, 0);
        lines.close();
      }
    }
  }
  await writeFile(
    join(folder, "result.json"),
    JSON.stringify({ ok: true, results }, null, 2),
  );
  console.log(JSON.stringify({ ok: true, results, evidence: folder }));
  await rm(executable);
}
