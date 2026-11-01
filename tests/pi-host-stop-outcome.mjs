import { assessStop } from "./stop-busy-outcome.mjs";

// Results describe the real Pi host, not an actual model or DSH.
export function canDiscardHost({ workerExited, exitCode }) {
  return workerExited === true && exitCode === 0;
}

export function assessHostStop(evidence) {
  const rows = evidence.workerTrace ?? [];
  const valid =
    Array.isArray(rows) &&
    rows.length > 0 &&
    rows[0]?.kind === "ready" &&
    Number.isSafeInteger(rows[0].pid) &&
    rows[0].pid > 0 &&
    rows.every(
      (r, i) => r && r.sequence === i + 1 && r.pid === rows[0].pid && !r.fault,
    );
  if (!valid) return { ok: false, cleanupConfirmed: false };
  const inputs = rows.filter(
    (r) => r.kind === "input" && r.action === "type_text",
  );
  const input = inputs[0];
  const replies = rows.filter(
    (r) =>
      r.kind === "output" &&
      r.id === input?.id &&
      r.result?.action === "type_text",
  );
  const response = replies[0];
  const ends = rows.filter(
    (r) =>
      r.kind === "input" &&
      r.action === "operation_end" &&
      r.operationId === input?.operationId,
  );
  const releases = rows.filter(
    (r) =>
      r.kind === "output" &&
      r.id === ends[0]?.id &&
      r.result?.ok === true &&
      r.result?.released === true &&
      r.result?.action === "operation_end",
  );
  const release = releases[0];
  const health = rows.find(
    (r) =>
      r.kind === "output" &&
      r.sequence > (release?.sequence ?? Infinity) &&
      r.result?.ok === true &&
      r.result?.action === "health",
  )?.result.control;
  const stopped = rows.some(
    (r) =>
      r.kind === "output" &&
      r.event === "stopped" &&
      r.operationId === input?.operationId,
  );
  const basic = assessStop({
    started: evidence.toolStarted,
    stopped,
    settled: evidence.settled,
    before: evidence.before,
    after: evidence.after,
    total: evidence.total,
    keysReleased: evidence.keysReleased,
    unexpectedCharacters: evidence.unexpectedCharacters,
    dispatch: { value: response?.result },
  });
  const cleanupConfirmed =
    valid &&
    inputs.length === 1 &&
    Number.isSafeInteger(input.id) &&
    input.id > 0 &&
    typeof input.operationId === "string" &&
    input.operationId.length > 0 &&
    replies.length === 1 &&
    typeof response.result.ok === "boolean" &&
    ends.length === 1 &&
    Number.isSafeInteger(ends[0].id) &&
    ends[0].id > 0 &&
    releases.length === 1 &&
    release.sequence > ends[0].sequence &&
    response?.result?.cleanupConfirmed === true &&
    response.sequence > input.sequence &&
    release?.sequence > response.sequence;
  const releaseConfirmed =
    cleanupConfirmed &&
    evidence.keysReleased === true &&
    health?.exclusiveControl === false &&
    health.physicalKeysHeld === 0 &&
    health.physicalButtonsHeld === 0;
  return {
    cleanupConfirmed,
    releaseConfirmed,
    ok:
      basic.ok &&
      releaseConfirmed &&
      evidence.toolEnded === true &&
      evidence.aborted === true &&
      evidence.abortRequested === false &&
      evidence.extensionErrors === 0 &&
      evidence.stopKeyObserved === false,
  };
}
