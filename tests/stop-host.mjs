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
      physicalEsc: "manual check pending",
    }),
  );
} finally {
  await worker.dispose();
}
