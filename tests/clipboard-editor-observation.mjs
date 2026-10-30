import assert from "node:assert/strict";

// Fixture text is an independent oracle. Missing UIA values are reported, never inferred.
export function compareEditorObservation(element, fixtureValue) {
  assert.ok(
    element && typeof element === "object",
    "element_info must return an element",
  );
  const available = element.value !== undefined && element.value !== null;
  if (available)
    assert.equal(
      element.value,
      fixtureValue,
      "UIA and fixture editor text must agree",
    );
  return {
    fixtureValue,
    uiaAvailability: available ? "available" : "unavailable",
  };
}

// Only this product error is documented as occurring before clipboard mutation/input.
export function isSafeClipboardRefusal(result) {
  return (
    result?.ok === false &&
    typeof result.error === "string" &&
    /^CLIPBOARD_SNAPSHOT_UNSUPPORTED(?::|$)/.test(result.error)
  );
}

// An absent cleanup acknowledgment does not establish that physical input has stopped.
export function inputCleanupConfirmed(result) {
  if (
    result?.cleanupConfirmed !== true ||
    result?.clipboardCleanupConfirmed === false
  )
    return false;
  return (
    result.clipboardCleanupConfirmed === true || isSafeClipboardRefusal(result)
  );
}

// An unresolved promise alone does not keep Node alive once child pipes close.
export async function retainUnconfirmedOwner() {
  const keepAlive = setInterval(() => {}, 1000);
  try {
    await new Promise(() => {});
  } finally {
    clearInterval(keepAlive);
  }
}
