import assert from "node:assert/strict";
import { assessHostStop, canDiscardHost } from "./pi-host-stop-outcome.mjs";

const good = {
  toolStarted: true,
  toolEnded: true,
  dispatchStopped: true,
  settled: true,
  aborted: true,
  extensionErrors: 0,
  stopKeyObserved: true,
  before: 80,
  after: 80,
  total: 2000,
  keysReleased: true,
};
assert.equal(assessHostStop(good).ok, true);
for (const change of [
  { toolStarted: false },
  { toolEnded: false },
  { dispatchStopped: false },
  { settled: false },
  { aborted: false },
  { extensionErrors: 1 },
  { stopKeyObserved: false },
  { before: 0 },
  { before: 2000 },
  { after: 81 },
  { keysReleased: false },
])
  assert.equal(
    assessHostStop({ ...good, ...change }).ok,
    false,
    JSON.stringify(change),
  );
console.log("Pi host stop outcome checks passed");

const { requireHostContainment } = await import(
  "./pi-host-stop-containment.mjs"
);
assert.throws(() => requireHostContainment(), /HOST_CONTAINMENT_UNVERIFIED/);
assert.equal(canDiscardHost({ workerExited: true, exitCode: 0 }), true);
assert.equal(canDiscardHost({ workerExited: true, exitCode: 1 }), false);
assert.equal(canDiscardHost({ workerExited: false, exitCode: 0 }), false);
assert.equal(canDiscardHost({ workerExited: true, exitCode: null }), false);
