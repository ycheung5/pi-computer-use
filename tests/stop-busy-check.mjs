import assert from "node:assert/strict";
import { assessStop } from "./stop-busy-outcome.mjs";

assert.deepEqual(
  assessStop({
    started: true,
    stopped: true,
    settled: true,
    before: 2,
    after: 2,
    total: 400,
    keysReleased: true,
  }),
  { ok: true },
);
for (const change of [
  { started: false },
  { stopped: false },
  { settled: false },
  { before: 0 },
  { before: 400 },
  { after: 3 },
  { keysReleased: false },
]) {
  const evidence = {
    started: true,
    stopped: true,
    settled: true,
    before: 2,
    after: 2,
    total: 400,
    keysReleased: true,
    ...change,
  };
  assert.equal(assessStop(evidence).ok, false, JSON.stringify(evidence));
}
console.log("stop acceptance evidence checks passed");
