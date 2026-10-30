import assert from "node:assert/strict";
import test from "node:test";
import { compareEditorObservation } from "./clipboard-editor-observation.mjs";

test("blank fixture evidence remains usable when UIA omits its value", () => {
  const observed = compareEditorObservation({}, "");
  assert.deepEqual(observed, {
    fixtureValue: "",
    uiaAvailability: "unavailable",
  });
});

test("available UIA values must match the independent fixture, including nonempty text", () => {
  assert.deepEqual(
    compareEditorObservation({ value: "text 中文" }, "text 中文"),
    { fixtureValue: "text 中文", uiaAvailability: "available" },
  );
  assert.throws(
    () => compareEditorObservation({ value: "different" }, "text 中文"),
    /UIA and fixture editor text must agree/,
  );
  assert.deepEqual(compareEditorObservation({}, "text 中文"), {
    fixtureValue: "text 中文",
    uiaAvailability: "unavailable",
  });
});
