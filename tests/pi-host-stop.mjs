// Native Windows Pi CLI with a scripted provider; dedicated desktop and real physical key required.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import {
  launchStopHost,
  requireHostContainment,
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
  assert.equal(process.platform, "win32");
  assert.equal(
    process.env.PI_CU_DEDICATED_INPUT_DESKTOP,
    "1",
    "Dedicated Windows desktop required",
  );
  const mode = process.argv[2] ?? "esc";
  assert.ok(["esc", "shortcut"].includes(mode));
  requireHostContainment();
  const cli = process.env.PI_CU_PI_CLI;
  assert.ok(cli, "PI_CU_PI_CLI must name the installed Pi CLI");
  const statusFile = process.env.PI_CU_STOP_STATUS_FILE;
  if (statusFile)
    await writeFile(statusFile, JSON.stringify({ phase: "setup", mode }), {
      flag: "wx",
    });
  const status = async (phase) => {
    if (statusFile)
      await writeFile(statusFile, JSON.stringify({ phase, mode }));
  };
  const folder = await mkdtemp(join(tmpdir(), "pi-cu-host-stop-"));
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
      fileURLToPath(new URL("./pi-host-stop-fixture.cs", import.meta.url)),
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
    dispatchStopped = false,
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
    const m = (await response).match(/^state:(\d+):(released|held)$/);
    assert.ok(m);
    return { count: Number(m[1]), keysReleased: m[2] === "released" };
  };
  try {
    const match = (await line(/^ready:/)).match(/^ready:(\d+)$/);
    assert.ok(match && fixture.pid > 0);
    const target = {
      nativeWindowHandle: Number(match[1]),
      processId: fixture.pid,
    };
    assert.deepEqual(await observe(), { count: 0, keysReleased: true });
    console.log("Fixture ready. Send start followed by Enter on stdin.");
    await status("ready");
    await waitForStart(process.stdin, 120000);
    host = launchStopHost({ cli, folder, agent, settings, target });
    host.stdin.on("error", () => {
      extensionErrors++;
    });
    host.stderr.resume();
    const events = createInterface({ input: host.stdout });
    let aborted = false,
      settlementResolve,
      settlementReject;
    const settlement = new Promise((resolve, reject) => {
      settlementResolve = resolve;
      settlementReject = reject;
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
        const resultText = JSON.stringify(event.result ?? {});
        dispatchStopped =
          event.isError === true &&
          /COMPUTER_USE_STOPPED|AbortError|aborted/i.test(resultText);
      }
      if (
        event.type === "tool_execution_end" &&
        event.toolName === "windows_computer_use_health"
      )
        workerPid = event.result?.details?.processId;
      if (event.type === "agent_settled") {
        aborted = event.aborted === true;
        settlementResolve();
      }
    });
    host.once("error", settlementReject);
    host.once("exit", (code, signal) => {
      if (!settled)
        settlementReject(
          new Error(`Pi exited before verified settlement: ${code}/${signal}`),
        );
    });
    const notification = line(/^started$/, 20000).then(async () => {
      await status("started");
      console.log(
        `Input started. Press ${mode === "esc" ? "Esc" : "Ctrl+Alt+F9"} physically now.`,
      );
    });
    inputAttempted = true;
    host.stdin.write(
      `${JSON.stringify({ id: "fixture-prompt", type: "prompt", message: "Execute the scripted stop fixture." })}\n`,
    );
    await notification;
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
    const before = await observeReleased(
      observe,
      (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    );
    await new Promise((resolve) => setTimeout(resolve, 500));
    const after = await observe();
    const evidence = {
      toolStarted,
      toolEnded,
      dispatchStopped,
      settled,
      aborted,
      extensionErrors,
      stopKeyObserved: stoppedKey,
      before: before.count,
      after: after.count,
      total: 2000,
      keysReleased: before.keysReleased && after.keysReleased,
    };
    const assessment = assessHostStop(evidence);
    assert.ok(
      Number.isSafeInteger(workerPid) && workerPid > 0,
      "Worker identity unavailable",
    );
    host.stdin.end();
    if (host.exitCode === null)
      await bounded(once(host, "exit"), 10000, "Pi orderly exit unconfirmed");
    let workerExited = false;
    try {
      process.kill(workerPid, 0);
    } catch (error) {
      if (error.code === "ESRCH") workerExited = true;
      else throw error;
    }
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
        scope:
          "Native Windows Pi CLI with scripted provider; not WSL Pi, a real model, DSH, or held-modifier cancellation",
      }),
    );
    assert.equal(assessment.ok, true);
  } finally {
    if (inputAttempted && (!settled || !hostClean)) {
      if (!settled && !abortRequested && host?.exitCode === null) {
        host.stdin.write(
          `${JSON.stringify({ id: "fixture-abort", type: "abort" })}\n`,
        );
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
  }
}
