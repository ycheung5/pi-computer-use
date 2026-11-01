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
    unexpectedCharacters: 0,
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
  { unexpectedCharacters: 1 },
  { unexpectedCharacters: undefined },
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
    unexpectedCharacters: 0,
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

const { PassThrough } = await import("node:stream");
const { waitForStart, observeReleased } = await import(
  "./stop-busy-coordination.mjs"
);
const input = new PassThrough();
const gate = waitForStart(input, 1000);
input.write("start\n");
await gate;
const invalidInput = new PassThrough();
const invalidGate = waitForStart(invalidInput, 1000);
invalidInput.write("unexpected\n");
await assert.rejects(invalidGate, /START_GATE_INVALID/);
const timed = new PassThrough();
await assert.rejects(waitForStart(timed, 10), /START_GATE_TIMEOUT/);
const closed = new PassThrough();
const closedGate = waitForStart(closed, 1000);
closed.end();
await assert.rejects(closedGate, /START_GATE_CLOSED/);
let reads = 0;
const released = await observeReleased(
  async () => ({ count: 3, keysReleased: ++reads >= 3 }),
  async () => {},
  5,
);
assert.equal(released.keysReleased, true);
assert.equal(released.observations, 3);
reads = 0;
const held = await observeReleased(
  async () => ({ count: 3, keysReleased: false }),
  async () => {},
  3,
);
assert.equal(held.keysReleased, false);
assert.equal(held.observations, 3);
