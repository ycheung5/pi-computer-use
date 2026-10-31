// Observable evidence for a manual stop during an owned long typing action.
export function assessStop(evidence) {
  const {
    started,
    stopped,
    settled,
    before,
    after,
    total,
    keysReleased,
    dispatch,
  } = evidence;
  const result = dispatch?.value;
  if (
    started !== true ||
    stopped !== true ||
    settled !== true ||
    result?.ok !== false ||
    result.action !== "type_text" ||
    result.error !== "COMPUTER_USE_STOPPED" ||
    result.cleanupConfirmed !== true ||
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
