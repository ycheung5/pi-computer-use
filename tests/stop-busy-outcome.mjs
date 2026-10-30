// Observable evidence for a manual stop during an owned long typing action.
export function assessStop(evidence) {
  const { started, stopped, settled, before, after, total, keysReleased } =
    evidence;
  if (
    started !== true ||
    stopped !== true ||
    settled !== true ||
    !Number.isSafeInteger(total) ||
    total < 2 ||
    !Number.isSafeInteger(before) ||
    before <= 0 ||
    before >= total ||
    after !== before ||
    keysReleased !== true
  ) {
    return { ok: false };
  }
  return { ok: true };
}
