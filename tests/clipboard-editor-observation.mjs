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
