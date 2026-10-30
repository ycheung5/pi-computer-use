// Dedicated Windows desktop only. Both engines act through their public interfaces.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export async function runDragDrop({ engine, referencePath }) {
  const folder = await mkdtemp(join(tmpdir(), "pi-cu-drop-"));
  process.env.PI_CU_SETTINGS_FILE = join(folder, "settings.json");
  const executable = join(folder, "fixture.exe");
  const compiler = join(
    process.env.WINDIR,
    "Microsoft.NET",
    "Framework64",
    "v4.0.30319",
    "csc.exe",
  );
  const built = spawnSync(
    compiler,
    [
      "/nologo",
      "/target:exe",
      `/out:${executable}`,
      "/r:System.Windows.Forms.dll",
      "/r:System.Drawing.dll",
      fileURLToPath(new URL("./pointer-drop-fixture.cs", import.meta.url)),
    ],
    { encoding: "utf8", cwd: folder, windowsHide: true },
  );
  assert.equal(built.status, 0, built.stdout + built.stderr);
  const fixture = spawn(executable, [`Pi CU Drop ${Date.now()}`], {
    stdio: ["pipe", "pipe", "pipe"],
    cwd: folder,
    windowsHide: true,
  });
  const [ready] = await once(fixture.stdout, "data");
  const target = {
    nativeWindowHandle: Number(ready.toString().trim()),
    processId: fixture.pid,
  };
  let host, client, execute;
  let inputStarted = false,
    released = false;
  const observe = () =>
    new Promise((resolve, reject) => {
      let buffer = "";
      const timeout = setTimeout(
        () => finish(new Error("drop oracle timed out")),
        5000,
      );
      const receive = (chunk) => {
        buffer += chunk.toString();
        const match = buffer.match(/state:(\d+):(\d+)\r?\n/);
        if (match)
          finish(null, { drops: Number(match[1]), held: Number(match[2]) });
      };
      function finish(error, state) {
        clearTimeout(timeout);
        fixture.stdout.off("data", receive);
        error ? reject(error) : resolve(state);
      }
      fixture.stdout.on("data", receive);
      fixture.stdin.write("observe\n");
    });
  try {
    if (engine === "pi") {
      const [{ default: computerUse }, { computerUseHost }] = await Promise.all(
        [import("../dist/extension.js"), import("./native-host.mjs")],
      );
      host = computerUseHost();
      computerUse(host.api);
      execute = async (action, args) =>
        (
          await host.tools
            .get(`windows_computer_use_${action}`)
            .execute(action, args, undefined, undefined, {})
        ).details;
    } else {
      const { createComparisonClient } = await import(
        "./comparison-client.mjs"
      );
      client = await createComparisonClient({
        engine,
        referencePath,
        cwd: folder,
      });
      execute = (action, args) => client.execute(action, args);
    }
    const call = async (action, args = {}) => {
      const result = await execute(action, { ...target, ...args });
      console.log(JSON.stringify({ engine, action, result }));
      return result;
    };
    const initial = await observe();
    assert.deepEqual(
      initial,
      { drops: 0, held: 0 },
      "fresh fixture and released button required",
    );
    const find = async (query) => {
      const result = await call("find", {
        query,
        controlType: "Pane",
        ocrFallback: false,
      });
      assert.equal(result.ok, true);
      assert.equal(result.matches.length, 1);
      return result.matches[0];
    };
    const source = await find("Drop source");
    const destination = await find("Drop target");
    const point = (item) => ({
      x: Math.round(item.boundingBox.centerX),
      y: Math.round(item.boundingBox.centerY),
    });
    const start = point(source),
      end = point(destination);
    const path = Array.from({ length: 21 }, (_, i) => ({
      x: Math.round(start.x + ((end.x - start.x) * i) / 20),
      y: Math.round(start.y + ((end.y - start.y) * i) / 20),
    }));
    inputStarted = true;
    let dispatch;
    try {
      dispatch = { status: "fulfilled", value: await call("drag", { path }) };
    } catch (error) {
      dispatch = {
        status: "rejected",
        error: { name: error.name, message: String(error.message) },
      };
    }
    let state, observationError;
    try {
      for (let i = 0; i < 50; i++) {
        state = await observe();
        if (state.held === 0 && state.drops === 1) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      // A timed-out or failed dispatch can still have a live input owner even
      // when the button happens to be up at this instant.
      released =
        dispatch.status === "fulfilled" &&
        dispatch.value?.ok === true &&
        state?.held === 0;
    } catch (error) {
      observationError = String(error.message);
    }
    const ok =
      dispatch.status === "fulfilled" &&
      dispatch.value?.ok === true &&
      state?.drops === 1 &&
      released;
    console.log(
      JSON.stringify({
        engine,
        check: "successful-drag-drop",
        ok,
        dispatch,
        state,
        observationError,
        cleanupVerification: released ? "released" : "unconfirmed",
      }),
    );
    assert.ok(ok, "drag/drop or independent cleanup was not confirmed");
  } finally {
    if (inputStarted && !released) {
      console.error(
        "Input cleanup unconfirmed: retaining the engine and fixture; stop dependent tests and investigate before terminating the input owner.",
      );
      await new Promise(() => {});
    }
    for (const handler of host?.shutdown ?? []) await handler();
    await client?.dispose();
    if (fixture.exitCode === null) {
      const closed = once(fixture, "close");
      fixture.stdin.end("stop\n");
      await closed;
    }
    await rm(folder, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  }
}
