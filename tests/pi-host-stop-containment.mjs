// Do not start physical input until the real Pi host and its descendants have
// independently verified containment. The no-input receipts below establish
// recorded participant cleanup, not containment during held physical input.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { commandObserver } from "./pi-host-command.mjs";

// Shared by the physical fixture and its no-input participant/cleanup preflight.
export function launchStopHost({
  cli,
  folder,
  agent,
  settings,
  target,
  trace,
  preflight = false,
}) {
  const preload =
    "data:text/javascript;base64," +
    Buffer.from(
      `if(process.argv[1]?.replaceAll('\\\\','/').endsWith('/dist/worker.js'))await import(${JSON.stringify(commandObserver(trace, null, true))});`,
    ).toString("base64");
  return spawn(
    process.execPath,
    [
      cli,
      "--mode",
      "rpc",
      "--no-session",
      "--no-extensions",
      "--no-context-files",
      "--no-skills",
      "--no-prompt-templates",
      "--no-themes",
      "--no-mcp",
      "--offline",
      "--provider",
      "pi-cu-stop-host",
      "--model",
      "fixture",
      "-e",
      fileURLToPath(new URL("../dist/extension.js", import.meta.url)),
      "-e",
      fileURLToPath(new URL("./pi-host-stop-provider.ts", import.meta.url)),
    ],
    {
      cwd: folder,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        PI_CODING_AGENT_DIR: agent,
        PI_CU_SETTINGS_FILE: settings,
        PI_OFFLINE: "1",
        PI_CU_HOST_STOP_TARGET: JSON.stringify(target),
        PI_CU_HOST_STOP_PREFLIGHT: preflight ? "1" : "",
        ...(trace
          ? {
              NODE_OPTIONS:
                `${process.env.NODE_OPTIONS ?? ""} --import=${preload}`.trim(),
            }
          : {}),
      },
    },
  );
}

export function requireHostContainment() {
  throw new Error(
    "HOST_CONTAINMENT_UNVERIFIED: the real Pi host and its descendants are not independently contained; no input dispatched",
  );
}

// Actual default extension and the same launcher as the guarded physical runner.
// This receipt proves orderly cleanup only; it cannot authorize forced retirement.
export async function runStopHostPreflight(mode = "command") {
  const { default: assert } = await import("node:assert/strict");
  const { spawnSync } = await import("node:child_process");
  const { once } = await import("node:events");
  const { writeFileSync } = await import("node:fs");
  const { mkdir, mkdtemp, rm, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { dirname, join } = await import("node:path");
  const { createInterface } = await import("node:readline");
  const { commandRows, commandWorkerIdentity } = await import(
    "./pi-host-command.mjs"
  );
  const { keepVisualOwnership } = await import("./pi-visual-host.mjs");
  assert.ok(["command", "host-exit"].includes(mode));
  assert.equal(process.platform, "win32");
  const cli = join(
    dirname(
      fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")),
    ),
    "bundle",
    "cli.js",
  );
  const folder = await mkdtemp(join(tmpdir(), "pi-cu-stop-preflight-"));
  const agent = join(folder, "agent"),
    settings = join(folder, "settings.json"),
    trace = join(folder, "worker.jsonl");
  await mkdir(agent);
  await writeFile(
    settings,
    JSON.stringify({
      indicatorEnabled: false,
      cursorIndicatorEnabled: false,
      stopShortcut: "Ctrl+Alt+F9",
    }),
  );
  const write = (name, value) =>
    writeFile(join(folder, name), JSON.stringify(value, null, 2));
  const host = launchStopHost({
    cli,
    folder,
    agent,
    settings,
    trace,
    preflight: true,
  });
  const closed = once(host, "close");
  let fault,
    stopRequested = false;
  const requestStop = () => {
    if (stopRequested || host.exitCode !== null || host.stdin.destroyed) return;
    stopRequested = true;
    host.stdin.write(
      JSON.stringify({
        id: "failure-stop",
        type: "prompt",
        message: "/computer-stop",
      }) + "\n",
    );
  };
  host.on("error", (error) => {
    fault = error;
  });
  host.stdin.on("error", (error) => {
    fault = error;
  });
  host.stderr.resume();
  console.log(
    JSON.stringify({
      phase: "host-preflight",
      folder,
      hostPid: host.pid,
      physicalInput: false,
    }),
  );
  await keepVisualOwnership(
    host,
    async (active) => {
      try {
        const hostPin = commandWorkerIdentity(process.execPath, host.pid);
        assert.ok(hostPin);
        const events = [];
        const lines = createInterface({ input: host.stdout });
        lines.on("line", (line) => {
          try {
            const e = JSON.parse(line);
            events.push(e);
            if (e.type === "extension_error")
              fault = Error("Pi extension error");
          } catch (error) {
            fault = error;
          }
        });
        const until = async (check, label) => {
          const deadline = Date.now() + 20000;
          while (true) {
            active();
            if (fault) throw fault;
            const value = await check();
            if (value) return value;
            if (Date.now() > deadline) throw Error(`Unconfirmed: ${label}`);
            await new Promise((resolve) => setTimeout(resolve, 25));
          }
        };
        const rows = () => commandRows(trace);
        const send = (id, message) =>
          host.stdin.write(
            JSON.stringify({ id, type: "prompt", message }) + "\n",
          );
        send("initial", "Execute the no-input host preflight.");
        await until(
          () =>
            events.find(
              (e) =>
                e.type === "tool_execution_start" &&
                e.toolName === "windows_computer_use_wait",
            ),
          "pending wait",
        );
        const pending = await until(
          () => rows().find((r) => r.kind === "input" && r.action === "wait"),
          "actual pending worker request",
        );
        const observed = rows();
        assert.ok(observed.every((r) => !r.fault));
        assert.ok(pending?.operationId);
        const click = observed.find(
          (r) => r.kind === "output" && r.result?.action === "click",
        );
        assert.equal(click?.result.ok, false);
        assert.match(
          click?.result.error ?? "",
          /^TARGET_IDENTITY_CHANGED(?::|$)/,
        );
        assert.equal(click?.result.cleanupConfirmed, true);
        const health = observed
          .filter((r) => r.kind === "output" && r.result?.action === "health")
          .at(-1)?.result;
        assert.equal(health?.control.exclusiveControl, true);
        assert.equal(health?.control.hookInstalled, true);
        const workerPid = health.processId;
        assert.equal(observed[0].pid, workerPid);
        const ps = (script) => {
          const r = spawnSync(
            "powershell.exe",
            [
              "-NoProfile",
              "-NonInteractive",
              "-EncodedCommand",
              Buffer.from(
                "$ErrorActionPreference='Stop';" + script,
                "utf16le",
              ).toString("base64"),
            ],
            { encoding: "utf8", windowsHide: true, timeout: 15000 },
          );
          assert.equal(r.status, 0, r.stderr);
          return JSON.parse(r.stdout);
        };
        // Birth-aware descent excludes unrelated processes whose parent PID was reused.
        const identities = ps(
          `$all=@(Get-CimInstance Win32_Process);$root=@($all|Where-Object ProcessId -eq ${host.pid});if($root.Count -ne 1){throw 'Pi absent'};$pending=@($root[0]);$out=@();for($i=0;$i -lt $pending.Count;$i++){$p=$pending[$i];$role=$null;if($p.Name -eq 'windows.exe'){$a=[Reflection.Assembly]::ReflectionOnlyLoadFrom($p.ExecutablePath);foreach($t in @('StopBridge','WindowsBridge','OwnershipBridge')){if($a.GetType($t)){$role=$t}}};$out+=@(@{pid=$p.ProcessId;parent=$p.ParentProcessId;creation=$p.CreationDate.ToUniversalTime().ToString('o');executable=$p.ExecutablePath;role=$role});foreach($c in @($all|Where-Object {$_.ParentProcessId -eq $p.ProcessId -and $_.CreationDate -ge $p.CreationDate})){$pending+=@($c)}};ConvertTo-Json -Depth 4 -Compress -InputObject @($out)`,
        );
        const pinnedHost = identities.find((p) => p.pid === host.pid);
        assert.equal(pinnedHost?.creation, hostPin.creation);
        assert.equal(pinnedHost?.parent, process.pid);
        assert.equal(
          pinnedHost?.executable.toLowerCase(),
          hostPin.executable.toLowerCase(),
        );
        const worker = identities.find((p) => p.pid === workerPid);
        assert.equal(worker?.parent, host.pid);
        assert.equal(
          worker?.executable.toLowerCase(),
          observed[0].executable.toLowerCase(),
        );
        for (const role of ["StopBridge", "WindowsBridge", "OwnershipBridge"]) {
          const matches = identities.filter((p) => p.role === role);
          assert.equal(matches.length, 1, role);
          assert.equal(matches[0].parent, workerPid);
          assert.ok(
            observed.some(
              (r) =>
                r.kind === "child_spawn" &&
                r.childPid === matches[0].pid &&
                r.executable.toLowerCase() ===
                  matches[0].executable.toLowerCase(),
            ),
          );
        }
        assert.equal(
          identities.find((p) => p.role === "StopBridge").pid,
          health.control.listenerProcessId,
        );
        await write("participants.json", { identities, pending, click });
        if (mode === "command") {
          send("stop", "/computer-stop");
          await until(
            () =>
              rows().find(
                (r) =>
                  r.kind === "output" &&
                  r.id === pending.id &&
                  r.result?.error === "COMPUTER_USE_STOPPED",
              ),
            "exact pending cancellation",
          );
          await until(() => {
            const current = rows();
            const end = current.find(
              (r) =>
                r.kind === "input" &&
                r.action === "operation_end" &&
                r.operationId === pending.operationId,
            );
            return (
              end &&
              current.find(
                (r) =>
                  r.kind === "output" &&
                  r.id === end.id &&
                  r.result?.ok &&
                  r.result.released === true,
              )
            );
          }, "released operation acknowledgment");
          await until(
            () => events.find((e) => e.type === "agent_settled"),
            "Pi settlement",
          );
          host.stdin.end();
        } else {
          // The only pointer request already failed before dispatch with cleanup.
          // Terminate the Pi host, never a native input/stop/ownership helper.
          assert.equal(host.kill("SIGTERM"), true);
        }
        const exit = await Promise.race([
          closed,
          new Promise((_, reject) => {
            const timer = setTimeout(
              () => reject(Error("Pi exit unconfirmed")),
              15000,
            );
            timer.unref();
          }),
        ]);
        if (mode === "command") assert.deepEqual(exit, [0, null]);
        const remaining = await until(() => {
          const present = ps(
            `$ids=@(${identities.map((p) => p.pid).join(",")});ConvertTo-Json -Compress -InputObject @(Get-CimInstance Win32_Process|Where-Object {$ids -contains $_.ProcessId}|ForEach-Object {@{pid=$_.ProcessId}})`,
          );
          return present.length === 0 ? present : undefined;
        }, "recorded participant exit");
        const final = commandRows(trace, true);
        assert.ok(final.every((r) => !r.fault));
        await write("result.json", {
          ok: true,
          mode,
          scope:
            mode === "command"
              ? "native Windows Pi RPC, no physical input; orderly cleanup only"
              : "native Windows Pi host exit, no physical input; recorded participant cleanup only",
          hostExit: exit,
          remaining,
          workerPid,
        });
        await rm(agent, { recursive: true });
        await rm(settings);
        lines.close();
        console.log(
          JSON.stringify({
            ok: true,
            folder,
            participants: identities.length,
            mode,
            physicalInput: false,
            physicalGateEnabled: false,
          }),
        );
      } catch (error) {
        requestStop();
        await write("failure.json", { error: error.message });
        console.error(error.message);
        throw error;
      }
    },
    {
      deadlineMs: 120000,
      writeOwner: (value) => {
        requestStop();
        writeFileSync(join(folder, "owner.json"), JSON.stringify(value));
      },
    },
  );
}
