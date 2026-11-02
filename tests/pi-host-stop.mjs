// Native Windows Pi CLI with a scripted provider; dedicated desktop and real physical key required.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { commandRows, commandWorkerIdentity } from "./pi-host-command.mjs";
import {
  launchStopHost,
  requireHostContainment,
  runStopHostPreflight,
  stopHostActorsAbsent,
  stopHostIdentity,
  stopHostParticipants,
  stopHostSource,
  stopHostWindowsPath,
} from "./pi-host-stop-containment.mjs";
import { assessHostStop, canDiscardHost } from "./pi-host-stop-outcome.mjs";
import { observeReleased, waitForStart } from "./stop-busy-coordination.mjs";

const selectedMode = process.argv[2] ?? "esc";
if (selectedMode === "preflight") {
  const { runStopHostPreflight } = await import(
    "./pi-host-stop-containment.mjs"
  );
  assert.ok(process.argv.length <= 4, "Unknown preflight arguments");
  await runStopHostPreflight(process.argv[3] ?? "command");
} else if (selectedMode === "command") {
  const { runPassiveCommandStop, commandOptions } = await import(
    "./pi-host-command.mjs"
  );
  const options = commandOptions(process.argv.slice(3));
  if (options.plan)
    console.log(
      JSON.stringify({
        mode: "plan",
        commandHost: options.commandHost,
        physicalInput: false,
        tools: ["health", "wait"],
      }),
    );
  else await runPassiveCommandStop(options.commandHost);
} else {
  assert.ok(["win32", "linux"].includes(process.platform));
  assert.equal(
    process.env.PI_CU_DEDICATED_INPUT_DESKTOP,
    "1",
    "Dedicated Windows desktop required",
  );
  const mode = process.argv[2] ?? "esc";
  assert.ok(["esc", "shortcut", "handback"].includes(mode));
  const source = await stopHostSource();
  const prerequisites = [
    await runStopHostPreflight(),
    await runStopHostPreflight("host-exit"),
  ];
  requireHostContainment(prerequisites, source);
  const statusFile = process.env.PI_CU_STOP_STATUS_FILE;
  if (statusFile)
    await writeFile(
      statusFile,
      JSON.stringify({ phase: "setup", mode, coordinatorPid: process.pid }),
      {
        flag: "wx",
      },
    );
  const status = async (phase, extra = {}) => {
    if (statusFile)
      await writeFile(
        statusFile,
        JSON.stringify({ phase, mode, coordinatorPid: process.pid, ...extra }),
      );
  };
  const { nativeWorkerLaunch, windowsHostEnvironment } = await import(
    "../dist/launcher.js"
  );
  const native = await nativeWorkerLaunch();
  const fixtureParent =
    process.platform === "win32"
      ? tmpdir()
      : join((await windowsHostEnvironment()).localData, "Temp");
  const folder = await mkdtemp(join(fixtureParent, "pi-cu-host-stop-"));
  await status("setup", { folder });
  const agent = join(folder, "agent");
  await mkdir(agent);
  const settings = join(folder, "settings.json");
  await writeFile(
    settings,
    JSON.stringify({
      indicatorEnabled: false,
      cursorIndicatorEnabled: false,
      stopShortcut: mode === "shortcut" ? "Ctrl+Alt+F9" : "",
    }),
  );
  const executable = join(folder, "fixture.exe");
  const built = spawnSync(
    native.executable,
    [
      "-e",
      "const p=require('node:path'),c=require('node:child_process');c.execFileSync(p.join(process.env.WINDIR,'Microsoft.NET','Framework64','v4.0.30319','csc.exe'),process.argv.slice(1),{stdio:'inherit'});",
      "/nologo",
      "/target:exe",
      `/out:${stopHostWindowsPath(executable)}`,
      "/r:System.Windows.Forms.dll",
      "/r:System.Drawing.dll",
      stopHostWindowsPath(
        fileURLToPath(new URL("./pi-host-stop-fixture.cs", import.meta.url)),
      ),
    ],
    { encoding: "utf8", cwd: folder, windowsHide: true },
  );
  assert.equal(built.status, 0, built.stdout + built.stderr);
  const fixture = spawn(executable, [`Pi Host Stop ${Date.now()}`], {
    stdio: ["pipe", "pipe", "pipe"],
    cwd: folder,
  });
  const lines = createInterface({ input: fixture.stdout });
  const waiting = [],
    saved = [];
  let host,
    toolStarted = false,
    toolEnded = false,
    stoppedKey = false,
    settled = false,
    hostClean = false,
    inputAttempted = false,
    abortRequested = false,
    extensionErrors = 0,
    workerPid;
  lines.on("line", (line) => {
    if (line === `stop-key:${mode}` && toolStarted && !toolEnded)
      stoppedKey = true;
    const i = waiting.findIndex((x) => x.pattern.test(line));
    if (i < 0) saved.push(line);
    else {
      const item = waiting.splice(i, 1)[0];
      clearTimeout(item.timer);
      item.resolve(line);
    }
  });
  function line(pattern, ms = 5000) {
    const i = saved.findIndex((x) => pattern.test(x));
    if (i >= 0) return Promise.resolve(saved.splice(i, 1)[0]);
    return new Promise((resolve, reject) => {
      const item = {
        pattern,
        resolve,
        timer: setTimeout(() => {
          const j = waiting.indexOf(item);
          if (j >= 0) waiting.splice(j, 1);
          reject(new Error(`Timed out: ${pattern}`));
        }, ms),
      };
      waiting.push(item);
    });
  }
  async function bounded(p, ms, message) {
    let timer;
    try {
      return await Promise.race([
        p,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(message)), ms);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  const observe = async () => {
    const response = line(/^state:/);
    fixture.stdin.write("observe\n");
    const m = (await response).match(/^state:(\d+):(released|held):(\d+)$/);
    assert.ok(m);
    return {
      count: Number(m[1]),
      keysReleased: m[2] === "released",
      unexpectedCharacters: Number(m[3]),
    };
  };
  try {
    const match = (await line(/^ready:/)).match(/^ready:(\d+):(\d+)$/);
    assert.ok(match && fixture.pid > 0);
    const target = {
      nativeWindowHandle: Number(match[1]),
      processId: Number(match[2]),
    };
    assert.deepEqual(await observe(), {
      count: 0,
      keysReleased: true,
      unexpectedCharacters: 0,
    });
    console.log("Fixture ready. Send start followed by Enter on stdin.");
    await status("ready", { target });
    await waitForStart(process.stdin, 120000);
    const trace = join(folder, "worker.jsonl"),
      gate = join(folder, "input-authorized");
    host = launchStopHost({
      folder,
      agent,
      settings,
      target,
      trace,
      gate,
      handback: mode === "handback",
    });
    const hostClosed = once(host, "close");
    const hostPin = stopHostIdentity(host.pid);
    assert.ok(hostPin);
    const until = async (check, label, timeoutMs = 15000) => {
      const deadline = Date.now() + timeoutMs;
      while (true) {
        const found = check();
        if (found) return found;
        if (Date.now() > deadline) throw Error(`Unconfirmed: ${label}`);
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    };
    const rows = () => commandRows(trace);
    host.stdin.on("error", () => {
      extensionErrors++;
    });
    host.stderr.resume();
    const events = createInterface({ input: host.stdout });
    let aborted = false,
      settlementCount = 0,
      recoveryResolve,
      settlementResolve,
      settlementReject;
    const settlement = new Promise((resolve, reject) => {
      settlementResolve = resolve;
      settlementReject = reject;
    });
    const recovered = new Promise((resolve) => {
      recoveryResolve = resolve;
    });
    events.on("line", (line) => {
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        extensionErrors++;
        return;
      }
      if (event.type === "extension_error") extensionErrors++;
      if (
        event.type === "tool_execution_start" &&
        event.toolName === "windows_computer_use_type_text"
      )
        toolStarted = true;
      if (
        event.type === "tool_execution_end" &&
        event.toolName === "windows_computer_use_type_text"
      ) {
        toolEnded = true;
      }
      if (
        event.type === "tool_execution_end" &&
        event.toolName === "windows_computer_use_health"
      ) {
        const pid = event.result?.details?.processId;
        if (workerPid && pid !== workerPid) extensionErrors++;
        workerPid ??= pid;
      }
      if (event.type === "agent_settled") {
        settlementCount++;
        if (settlementCount === 1) {
          aborted = event.aborted === true;
          settlementResolve();
        } else recoveryResolve();
      }
    });
    host.once("error", settlementReject);
    host.once("exit", (code, signal) => {
      if (!settled)
        settlementReject(
          new Error(`Pi exited before verified settlement: ${code}/${signal}`),
        );
    });
    inputAttempted = true;
    host.stdin.write(
      `${JSON.stringify({ id: "fixture-prompt", type: "prompt", message: "Execute the scripted stop fixture." })}\n`,
    );
    await until(
      () => {
        try {
          return (
            rows().filter(
              (r) => r.kind === "output" && r.result?.action === "health",
            ).length === 2
          );
        } catch (error) {
          if (error.code === "ENOENT") return false;
          throw error;
        }
      },
      "control setup before typing",
      90000,
    );
    const identities = stopHostParticipants(host.pid, hostPin, rows());
    requireHostContainment(prerequisites, await stopHostSource());
    await writeFile(gate, "authorized", { flag: "wx" });
    const notification = line(/^started$/, 20000).then(async () => {
      await status("started");
      console.log(
        mode === "handback"
          ? "Initial owned text sent; checking control release."
          : `Input started. Press ${mode === "esc" ? "Esc" : "Ctrl+Alt+F9"} physically now.`,
      );
    });
    await notification;
    if (mode === "handback") {
      const assertReleasedInputs = () => {
        const current = rows();
        assert.equal(extensionErrors, 0);
        assert.ok(
          current.length > 0 &&
            current.every(
              (r, i) => r.sequence === i + 1 && !r.fault && r.pid === workerPid,
            ),
        );
        for (const input of current.filter(
          (r) =>
            r.kind === "input" && ["type_text", "keypress"].includes(r.action),
        )) {
          const replies = current.filter(
            (r) => r.kind === "output" && r.id === input.id,
          );
          assert.equal(replies.length, 1);
          assert.equal(replies[0].result.ok, true);
          assert.equal(replies[0].result.cleanupConfirmed, true);
          const ends = current.filter(
            (r) =>
              r.kind === "input" &&
              r.action === "operation_end" &&
              r.operationId === input.operationId,
          );
          assert.equal(ends.length, 1);
          const release = current.filter(
            (r) => r.kind === "output" && r.id === ends[0].id,
          );
          assert.equal(release.length, 1);
          assert.equal(release[0].result.released, true);
          assert.equal(release[0].result.ok, true);
          assert.ok(release[0].sequence > replies[0].sequence);
        }
      };
      await bounded(
        settlement,
        15000,
        "Initial handback settlement unconfirmed",
      );
      const request = async (id, message, count) => {
        host.stdin.write(
          `${JSON.stringify({ id, type: "prompt", message })}\n`,
        );
        await until(
          () => settlementCount === count,
          "handback user-turn settlement",
        );
      };
      await request(
        "handback-health",
        "Confirm control has returned without input.",
        2,
      );
      const health = rows()
        .filter((r) => r.kind === "output" && r.result?.action === "health")
        .at(-1)?.result.control;
      assert.equal(health.exclusiveControl, false);
      assert.equal(health.physicalKeysHeld, 0);
      assert.equal(health.physicalButtonsHeld, 0);
      assertReleasedInputs();
      assert.deepEqual(await observe(), {
        count: 1,
        keysReleased: true,
        unexpectedCharacters: 0,
      });
      await status("human-handback");
      console.log(
        "Control returned. In this disposable editor, go to the end and type abc once; then explicitly continue.",
      );
      await waitForStart(process.stdin, 120000);
      const humanBefore = line(/^human:/);
      fixture.stdin.write("human\n");
      assert.equal(await humanBefore, "human:1:0");
      await request(
        "resume",
        "The human step is complete. Observe the owned target freshly and append one x.",
        3,
      );
      await request(
        "final-health",
        "Confirm control returned after continuation.",
        4,
      );
      const finalHealth = rows()
        .filter((r) => r.kind === "output" && r.result?.action === "health")
        .at(-1)?.result.control;
      assert.equal(finalHealth.exclusiveControl, false);
      assert.equal(finalHealth.physicalKeysHeld, 0);
      assert.equal(finalHealth.physicalButtonsHeld, 0);
      assertReleasedInputs();
      const humanAfter = line(/^human:/);
      fixture.stdin.write("human\n");
      assert.equal(await humanAfter, "human:0:1");
      assert.deepEqual(await observe(), {
        count: 5,
        keysReleased: true,
        unexpectedCharacters: 3,
      });
      const current = rows(),
        texts = current.filter(
          (r) => r.kind === "input" && r.action === "type_text",
        ),
        snapshots = current.filter(
          (r) => r.kind === "input" && r.action === "snapshot",
        );
      assert.equal(texts.length, 2);
      assert.equal(snapshots.length, 1);
      assert.notEqual(texts[0].operationId, texts[1].operationId);
      assert.ok(snapshots[0].sequence < texts[1].sequence);
      assert.equal(snapshots[0].operationId, texts[1].operationId);
      const fresh = current.filter(
        (r) => r.kind === "output" && r.id === snapshots[0].id,
      );
      assert.equal(fresh.length, 1);
      assert.equal(fresh[0].result.ok, true);
      assert.ok(fresh[0].sequence < texts[1].sequence);
      for (const text of texts) {
        const response = current.find(
          (r) => r.kind === "output" && r.id === text.id,
        );
        assert.equal(response.result.ok, true);
        assert.equal(response.result.cleanupConfirmed, true);
      }
      settled = true;
      host.stdin.end();
      assert.deepEqual(
        await bounded(hostClosed, 15000, "Handback Pi exit unconfirmed"),
        [0, null],
      );
      await until(
        () => stopHostActorsAbsent(identities),
        "handback actors absent",
      );
      hostClean = true;
      console.log(
        JSON.stringify({
          ok: true,
          mode,
          humanInputPreserved: true,
          explicitUserResume: true,
          freshObservation: true,
          separateOperations: true,
          controlReleased: true,
          actorsAbsent: true,
        }),
      );
    } else {
      try {
        await bounded(
          settlement,
          40000,
          "Physical stop was not observed before deadline",
        );
      } catch (error) {
        // Request orderly abort only; do not kill Pi or any possible input owner.
        if (host.exitCode === null)
          host.stdin.write(
            `${JSON.stringify({ id: "fixture-abort", type: "abort" })}\n`,
          );
        abortRequested = true;
        await bounded(
          settlement,
          15000,
          "Pi input settlement unconfirmed after abort",
        );
        throw error;
      }
      settled = true;
      await until(
        () => assessHostStop({ workerTrace: rows() }).cleanupConfirmed,
        "actual input cleanup and operation release",
      );
      const before = await observeReleased(
        observe,
        (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      );
      await new Promise((resolve) => setTimeout(resolve, 500));
      const after = await observe();
      host.stdin.write(
        `${JSON.stringify({ id: "released-health", type: "prompt", message: "Observe health after human handback." })}\n`,
      );
      await bounded(
        recovered,
        15000,
        "Post-release health settlement unconfirmed",
      );
      const evidence = {
        toolStarted,
        toolEnded,
        settled,
        aborted,
        extensionErrors,
        stopKeyObserved: stoppedKey,
        before: before.count,
        after: after.count,
        total: 2000,
        keysReleased: before.keysReleased && after.keysReleased,
        unexpectedCharacters: Math.max(
          before.unexpectedCharacters,
          after.unexpectedCharacters,
        ),
        workerTrace: rows(),
        abortRequested,
      };
      const assessment = assessHostStop(evidence);
      assert.ok(
        Number.isSafeInteger(workerPid) && workerPid > 0,
        "Worker identity unavailable",
      );
      assert.equal(
        assessment.releaseConfirmed,
        true,
        "INPUT_OR_CONTROL_RELEASE_UNCONFIRMED: retain owners",
      );
      host.stdin.end();
      const hostExit = await bounded(
        hostClosed,
        15000,
        "Pi orderly exit unconfirmed",
      );
      assert.deepEqual(hostExit, [0, null]);
      await until(
        () => stopHostActorsAbsent(identities),
        "recorded participant exit",
      );
      const workerExited =
        commandWorkerIdentity(native.executable, workerPid) === undefined;
      assert.equal(
        canDiscardHost({ workerExited, exitCode: host.exitCode }),
        true,
        "Pi or worker shutdown not confirmed",
      );
      hostClean = true;
      console.log(
        JSON.stringify({
          ...assessment,
          mode,
          evidence,
          workerExited,
          scope: `${process.platform} Pi CLI with scripted provider; physical stop integration, not a real model or held-modifier cancellation`,
        }),
      );
      assert.equal(assessment.ok, true);
    }
  } finally {
    if (inputAttempted && (!settled || !hostClean)) {
      if (!abortRequested && host?.exitCode === null) {
        host.stdin.write(
          `${JSON.stringify({ id: "fixture-retain-stop", type: "prompt", message: "/computer-stop" })}\n`,
        );
        abortRequested = true;
      }
      console.error(
        JSON.stringify({
          error: "HOST_OR_INPUT_SETTLEMENT_UNCONFIRMED",
          fixturePid: fixture.pid,
          hostPid: host?.pid,
          folder,
        }),
      );
      await new Promise(() => {});
    }
    if (fixture.exitCode === null) {
      const closed = once(fixture, "close");
      fixture.stdin.end("stop\n");
      await bounded(closed, 5000, "Fixture exit unconfirmed");
    }
    lines.close();
    await rm(folder, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
    process.stdin.destroy();
  }
}
