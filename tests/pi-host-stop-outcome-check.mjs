import assert from "node:assert/strict";
import { assessHostStop } from "./pi-host-stop-outcome.mjs";

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
