// Live Windows global-listener registration/cancel-event check. Sends no physical keys.
import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { WorkerClient } from "../dist/client.js";
import { nativeWorkerLaunch } from "../dist/launcher.js";
import { DEFAULT_SETTINGS } from "../dist/settings.js";
import { commandWorkerIdentity } from "./pi-host-command.mjs";

if (process.argv.includes("--desktop-loss")) {
  await testDesktopLoss();
  process.exit(0);
}

const seen = [];
const worker = new WorkerClient({
  launch: nativeWorkerLaunch,
  onStop: (id) => seen.push(id),
});
const operation = "stop-fixture-operation";
const run = promisify(execFile);
async function assertEvent(name, signaled) {
  // Independently observe the actual Windows kernel event, not the tool result.
  const script = `$e=[Threading.EventWaitHandle]::OpenExisting('${name}'); try { if($e.WaitOne(0) -ne $${signaled}){throw 'unexpected cancellation event state'} } finally {$e.Dispose()}`;
  await run("powershell.exe", [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-EncodedCommand",
    Buffer.from(script, "utf16le").toString("base64"),
  ]);
}
try {
  const prepared = await worker.execute(
    "prepare_input",
    {},
    undefined,
    operation,
  );
  assert.equal(prepared.ok, true);
  assert.equal(prepared.hookInstalled, true);
  assert.equal(prepared.inputReady, true);
  assert.ok(prepared.readyActions.includes("drag"));
  assert.ok(prepared.readyActions.includes("keypress"));
  assert.match(prepared.cancelEvent, /^Local\\PiComputerUseStop-/);
  await assertEvent(prepared.cancelEvent, false);
  worker.stopOperation(operation);
  const deadline = Date.now() + 3000;
  while (!seen.includes(operation)) {
    if (Date.now() > deadline) throw new Error("stop notification timed out");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  await assertEvent(prepared.cancelEvent, true);
  const retry = await worker.execute(
    "list_windows",
    { maxWindows: 1 },
    undefined,
    operation,
  );
  assert.equal(retry.ok, false);
  assert.match(retry.error, /STOPPED/);
  await worker.execute("operation_end", {}, undefined, operation);
  const recovered = await worker.execute(
    "list_windows",
    { maxWindows: 1 },
    undefined,
    "new-user-operation",
  );
  assert.equal(recovered.ok, true);
  const fresh = await worker.execute(
    "prepare_input",
    {},
    undefined,
    "new-user-operation",
  );
  assert.equal(fresh.ok, true);
  assert.notEqual(fresh.cancelEvent, prepared.cancelEvent);
  await assertEvent(fresh.cancelEvent, false);
  const gated = await worker.execute(
    "click",
    { x: 0, y: 0, nativeWindowHandle: 1, processId: 1 },
    undefined,
    "new-user-operation",
  );
  assert.equal(gated.ok, false);
  assert.match(gated.error, /TARGET_IDENTITY_CHANGED/);
  const controlling = await worker.execute("health", {});
  assert.equal(controlling.control.exclusiveControl, true);
  assert.equal(controlling.control.presentation.visible, true);
  await assertEvent(`${fresh.cancelEvent}-exclusive`, true);
  await worker.execute("operation_end", {}, undefined, "new-user-operation");
  const handedBack = await worker.execute("health", {});
  assert.equal(handedBack.control.exclusiveControl, false);
  assert.equal(handedBack.control.presentation.visible, false);
  await assertEvent(`${fresh.cancelEvent}-exclusive`, false);
  const exitOperation = "owned-listener-exit";
  const exitReady = await worker.execute(
    "prepare_input",
    {},
    undefined,
    exitOperation,
  );
  const exitGuard = await worker.execute(
    "click",
    { x: 0, y: 0, nativeWindowHandle: 1, processId: 1 },
    undefined,
    exitOperation,
  );
  assert.equal(exitGuard.ok, false);
  assert.match(exitGuard.error, /TARGET_IDENTITY_CHANGED/);
  assert.equal(exitGuard.cleanupConfirmed, true);
  // No physical input was dispatched. Pin the owned helper's OS handle,
  // parent and creation time before requesting an unexpected cooperative listener exit.
  const listenerId = Number(exitReady.listenerProcessId);
  const workerId = Number(controlling.processId);
  assert.ok(Number.isSafeInteger(listenerId) && listenerId > 0);
  assert.ok(Number.isSafeInteger(workerId) && workerId > 0);
  const exitScript = `$ErrorActionPreference='Stop';$p=Get-Process -Id ${listenerId};$identity=$p.Handle;$c=Get-CimInstance Win32_Process -Filter 'ProcessId=${listenerId}';if($c.ParentProcessId -ne ${workerId} -or $p.Path -ne $c.ExecutablePath -or [Math]::Abs(($p.StartTime.ToUniversalTime()-$c.CreationDate.ToUniversalTime()).TotalMilliseconds) -ge 1){throw 'owned helper identity mismatch'};$main=@($p.Threads|Sort-Object StartTime)[0];Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class StopFixtureExit31{[DllImport("user32.dll",SetLastError=true)]public static extern bool PostThreadMessage(uint id,uint msg,IntPtr w,IntPtr l);}';if(-not [StopFixtureExit31]::PostThreadMessage($main.Id,0x12,[IntPtr]::Zero,[IntPtr]::Zero)){throw 'cooperative listener exit refused'};if(-not $p.WaitForExit(3000)){throw 'helper exit unconfirmed'};$p.Dispose()`;
  await run("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-EncodedCommand",
    Buffer.from(exitScript, "utf16le").toString("base64"),
  ]);
  const exitDeadline = Date.now() + 3000;
  while (!seen.includes(exitOperation)) {
    if (Date.now() > exitDeadline)
      throw new Error("Listener exit did not stop its operation");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const afterExit = await worker.execute(
    "wait",
    { milliseconds: 1 },
    undefined,
    exitOperation,
  );
  assert.equal(afterExit.ok, false);
  assert.match(afterExit.error, /STOPPED/);
  const exitEnd = await worker.execute(
    "operation_end",
    {},
    undefined,
    exitOperation,
  );
  assert.equal(exitEnd.ok, true);
  console.log(
    JSON.stringify({
      ok: true,
      hookRegistration: true,
      cancelEvent: true,
      eventInitiallyUnsignaled: true,
      freshOperationEventIsolated: true,
      sameOperationBlocked: true,
      newOperation: true,
      guardFailureSentPhysicalInput: false,
      exclusiveControlAcquired: true,
      workerProcessId: controlling.processId,
      listenerProcessId: fresh.listenerProcessId,
      handbackReleasedControl: true,
      idleListenerExitStops: true,
      physicalEsc: "manual check pending",
    }),
  );
} finally {
  await worker.dispose();
}

// Native helper protocol check. Inject only desktop unavailability into a copy;
// keep the production Windows desktop check, timer and stop/release paths intact.
async function testDesktopLoss() {
  assert.equal(process.platform, "win32");
  const { acquireDesktop, releaseDesktop, disposeOwnership } = await import(
    "../dist/ownership.js"
  );
  const folder = await mkdtemp(join(tmpdir(), "pi-cu-desktop-loss-"));
  const available = join(folder, "available"),
    sourcePath = join(folder, "stop.cs"),
    indicators = join(folder, "indicators.cs"),
    executable = join(folder, "fixture.exe");
  const source = await readFile(
    new URL("../assets/stop.cs", import.meta.url),
    "utf8",
  );
  const seam = "static bool InteractiveDesktop() {";
  assert.equal(source.split(seam).length, 2);
  await writeFile(available, "available");
  await writeFile(
    sourcePath,
    source.replace(
      seam,
      `${seam}\n    if(!System.IO.File.Exists(@"${available.replaceAll('"', '""')}"))return false;`,
    ),
  );
  await writeFile(
    indicators,
    await readFile(new URL("../assets/indicators.cs", import.meta.url)),
  );
  const compiled = spawnSync(
    join(
      process.env.WINDIR,
      "Microsoft.NET",
      "Framework64",
      "v4.0.30319",
      "csc.exe",
    ),
    [
      "/nologo",
      `/out:${executable}`,
      "/r:System.Web.Extensions.dll",
      "/r:System.Windows.Forms.dll",
      "/r:System.Drawing.dll",
      sourcePath,
      indicators,
    ],
    { encoding: "utf8", windowsHide: true },
  );
  assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
  const stops = [];
  const helper = new WorkerClient({
    launch: async () => ({ executable, args: [], cwd: folder }),
    onStop: (id) => stops.push(id),
  });
  const operation = `desktop-loss-${randomUUID()}`,
    cancelEvent = `Local\\PiComputerUseStop-test-${randomUUID()}`;
  const acquired = await acquireDesktop(operation);
  if (!acquired.ok) {
    await disposeOwnership();
    throw Error(String(acquired.error));
  }
  let pin,
    result,
    releaseConfirmed = false;
  try {
    const configured = await helper.execute("configure", {
      settings: DEFAULT_SETTINGS,
    });
    assert.equal(configured.ok, true);
    pin = commandWorkerIdentity(process.execPath, configured.listenerProcessId);
    assert.ok(pin);
    assert.equal(
      (await helper.execute("arm", { operationId: operation, cancelEvent })).ok,
      true,
    );
    const control = await helper.execute("take_control", {
      operationId: operation,
    });
    assert.equal(control.ok, true, JSON.stringify(control));
    assert.equal(control.exclusiveControl, true);
    assert.equal(control.cancelEventSet, false);
    // Negative control: ordinary timer ticks do not stop an available desktop.
    await new Promise((resolve) => setTimeout(resolve, 350));
    const stable = await helper.execute("status", {});
    assert.equal(stable.exclusiveControl, true);
    assert.equal(stable.stopped, false);
    assert.equal(stops.length, 0);
    await unlink(available);
    const deadline = Date.now() + 5000;
    while (!stops.includes(operation)) {
      assert.ok(
        Date.now() < deadline,
        "Desktop loss did not emit the normal stop event",
      );
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const stopped = await helper.execute("status", {});
    assert.equal(stopped.stopped, true);
    assert.equal(stopped.cancelEventSet, true);
    assert.equal(stopped.exclusiveControl, false);
    assert.equal(stopped.presentation.visible, false);
    assert.equal(stopped.physicalKeysHeld, 0);
    assert.equal(stopped.physicalButtonsHeld, 0);
    const refused = await helper.execute("take_control", {
      operationId: operation,
    });
    assert.equal(refused.ok, false);
    assert.match(refused.error, /STOP_OPERATION_NOT_ARMED/);
    const released = await helper.execute("disarm", { operationId: operation });
    assert.equal(released.ok, true);
    assert.equal(released.exclusiveControl, false);
    releaseConfirmed = true;
    await helper.dispose();
    assert.equal(commandWorkerIdentity(process.execPath, pin.pid), undefined);
    result = {
      ok: true,
      scope:
        "native availability-loss injection; not a real OS lock or held-input run",
      sourceHash: createHash("sha256").update(source).digest("hex"),
      normalTimerStable: true,
      normalStopEvent: true,
      cancelEventSet: true,
      controlAndBorderReleased: true,
      sameOperationRefused: true,
      helperExited: true,
    };
  } finally {
    if (!releaseConfirmed) {
      const released = await helper.execute("disarm", {
        operationId: operation,
      });
      assert.equal(released.ok, true);
      assert.equal(released.exclusiveControl, false);
    }
    await helper.dispose();
    const released = await releaseDesktop(operation);
    assert.equal(released.ok, true);
    assert.equal(released.released, true);
    await disposeOwnership();
  }
  await writeFile(join(folder, "result.json"), JSON.stringify(result, null, 2));
  await rm(executable);
  await rm(sourcePath);
  await rm(indicators);
  console.log(JSON.stringify({ ...result, evidence: folder }));
}
