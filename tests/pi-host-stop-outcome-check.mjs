import assert from "node:assert/strict";
import { assessHostStop, canDiscardHost } from "./pi-host-stop-outcome.mjs";

const trace = [
  { sequence: 1, pid: 50, kind: "ready" },
  {
    sequence: 2,
    pid: 50,
    kind: "input",
    id: 4,
    action: "type_text",
    operationId: "owned",
  },
  {
    sequence: 3,
    pid: 50,
    kind: "output",
    event: "stopped",
    operationId: "owned",
  },
  {
    sequence: 4,
    pid: 50,
    kind: "output",
    id: 4,
    result: {
      ok: false,
      action: "type_text",
      error: "COMPUTER_USE_STOPPED",
      cleanupConfirmed: true,
    },
  },
  {
    sequence: 5,
    pid: 50,
    kind: "input",
    id: 5,
    action: "operation_end",
    operationId: "owned",
  },
  {
    sequence: 6,
    pid: 50,
    kind: "output",
    id: 5,
    result: { ok: true, action: "operation_end", released: true },
  },
  {
    sequence: 7,
    pid: 50,
    kind: "output",
    id: 6,
    result: {
      ok: true,
      action: "health",
      control: {
        exclusiveControl: false,
        physicalKeysHeld: 0,
        physicalButtonsHeld: 0,
      },
    },
  },
];
const good = {
  toolStarted: true,
  toolEnded: true,
  settled: true,
  aborted: true,
  abortRequested: false,
  extensionErrors: 0,
  stopKeyObserved: false,
  before: 80,
  after: 80,
  total: 2000,
  keysReleased: true,
  unexpectedCharacters: 0,
  workerTrace: trace,
};
assert.equal(assessHostStop(good).ok, true);
assert.equal(assessHostStop(good).releaseConfirmed, true);
assert.equal(
  assessHostStop({
    ...good,
    workerTrace: [...trace, { ...trace[5], sequence: 8 }],
  }).releaseConfirmed,
  false,
);
assert.equal(
  assessHostStop({
    ...good,
    workerTrace: trace.map((r) =>
      r.operationId ? { ...r, operationId: undefined } : r,
    ),
  }).releaseConfirmed,
  false,
);

assert.equal(
  assessHostStop({ ...good, keysReleased: false }).releaseConfirmed,
  false,
);
assert.equal(
  assessHostStop({
    ...good,
    workerTrace: trace.map((r) =>
      r.id === 6
        ? {
            ...r,
            result: {
              ...r.result,
              control: {
                exclusiveControl: false,
                physicalKeysHeld: 1,
                physicalButtonsHeld: 0,
              },
            },
          }
        : r,
    ),
  }).releaseConfirmed,
  false,
);
assert.equal(
  assessHostStop({ ...good, aborted: false }).releaseConfirmed,
  true,
);

for (const change of [
  { toolStarted: false },
  { toolEnded: false },
  { settled: false },
  { aborted: false },
  { abortRequested: true },
  { extensionErrors: 1 },
  { stopKeyObserved: true },
  { before: 0 },
  { before: 2000 },
  { after: 81 },
  { keysReleased: false },
  { unexpectedCharacters: 1 },
  { workerTrace: [] },
  { workerTrace: trace.filter((r) => r.event !== "stopped") },
  { workerTrace: trace.filter((r) => r.id !== 5) },
  {
    workerTrace: trace.map((r) =>
      r.id === 4 && r.result
        ? { ...r, result: { ...r.result, cleanupConfirmed: false } }
        : r,
    ),
  },
  {
    workerTrace: trace.map((r) =>
      r.id === 4 && r.result
        ? { ...r, result: { ...r.result, error: "AbortError" } }
        : r,
    ),
  },
  {
    workerTrace: trace.map((r) =>
      r.id === 4 && r.result ? { ...r, id: 9 } : r,
    ),
  },
  {
    workerTrace: trace.map((r) =>
      r.id === 6
        ? {
            ...r,
            result: {
              ...r.result,
              control: {
                exclusiveControl: true,
                physicalKeysHeld: 1,
                physicalButtonsHeld: 0,
              },
            },
          }
        : r,
    ),
  },
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
const source = "0".repeat(64);
const proofs = ["command", "host-exit"].map((mode) => ({
  ok: true,
  source,
  mode,
  physicalInput: false,
  remaining: [],
}));
assert.doesNotThrow(() => requireHostContainment(proofs, source));
for (const bad of [
  proofs.slice(0, 1),
  [proofs[0], proofs[0]],
  proofs.map((p) => ({ ...p, source: "1".repeat(64) })),
  proofs.map((p) => ({ ...p, remaining: [50] })),
  proofs.map((p) => ({ ...p, ok: false })),
  proofs.map((p) => ({ ...p, physicalInput: true })),
])
  assert.throws(
    () => requireHostContainment(bad, source),
    /HOST_CONTAINMENT_UNVERIFIED/,
  );

assert.equal(canDiscardHost({ workerExited: true, exitCode: 0 }), true);
assert.equal(canDiscardHost({ workerExited: true, exitCode: 1 }), false);
assert.equal(canDiscardHost({ workerExited: false, exitCode: 0 }), false);
assert.equal(canDiscardHost({ workerExited: true, exitCode: null }), false);
