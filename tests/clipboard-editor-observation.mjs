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
    result?.action !== "type_text" ||
    typeof result?.ok !== "boolean" ||
    result?.cleanupConfirmed !== true ||
    result?.clipboardCleanupConfirmed === false
  )
    return false;
  return (
    result.clipboardCleanupConfirmed === true || isSafeClipboardRefusal(result)
  );
}

// Reference window activation can synthesize Alt input, so missing or wrong-action
// acknowledgment cannot establish that its keys were released.
export function referenceActivationCleanupConfirmed(result) {
  return (
    result?.action === "activate_window" &&
    typeof result.ok === "boolean" &&
    result.cleanupConfirmed === true &&
    result.inputCleanupConfirmed !== false &&
    result.keyboardCleanupConfirmed !== false &&
    !["unconfirmed", "held", "failed"].includes(result.cleanupVerification)
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
