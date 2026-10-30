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
    dispatch: {
      value: {
        ok: false,
        action: "type_text",
        error: "COMPUTER_USE_STOPPED",
        cleanupConfirmed: true,
      },
    },
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
  { dispatch: { value: { ok: true, action: "type_text" } } },
  {
    dispatch: {
      value: {
        ok: false,
        action: "type_text",
        error: "TARGET_FOCUS_CHANGED",
        cleanupConfirmed: true,
      },
    },
  },
  {
    dispatch: {
      value: { ok: false, action: "type_text", error: "COMPUTER_USE_STOPPED" },
    },
  },
  { dispatch: { error: "COMPUTER_USE_STOPPED" } },
]) {
  const evidence = {
    started: true,
    stopped: true,
    settled: true,
    before: 2,
    after: 2,
    total: 400,
    keysReleased: true,
    dispatch: {
      value: {
        ok: false,
        action: "type_text",
        error: "COMPUTER_USE_STOPPED",
        cleanupConfirmed: true,
      },
    },
    ...change,
  };
  assert.equal(assessStop(evidence).ok, false, JSON.stringify(evidence));
}
console.log("stop acceptance evidence checks passed");
