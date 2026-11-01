// Live Windows global-listener registration/cancel-event check. Sends no physical keys.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { WorkerClient } from "../dist/client.js";
import { nativeWorkerLaunch } from "../dist/launcher.js";

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
