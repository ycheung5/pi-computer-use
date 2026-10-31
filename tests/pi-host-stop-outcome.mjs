// Results describe the real Pi host, not an actual model or DSH.
export function canDiscardHost({ workerExited, exitCode }) {
  return workerExited === true && exitCode === 0;
}

export function assessHostStop(evidence) {
  const {
    toolStarted,
    toolEnded,
    dispatchStopped,
    settled,
    aborted,
    extensionErrors,
    stopKeyObserved,
    before,
    after,
    total,
    keysReleased,
  } = evidence;
  return {
    ok:
      toolStarted === true &&
      toolEnded === true &&
      dispatchStopped === true &&
      settled === true &&
      aborted === true &&
      extensionErrors === 0 &&
      stopKeyObserved === true &&
      Number.isSafeInteger(total) &&
      total > 1 &&
      Number.isSafeInteger(before) &&
      before > 0 &&
      before < total &&
      after === before &&
      keysReleased === true,
  };
}
