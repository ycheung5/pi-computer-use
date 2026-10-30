import assert from "node:assert/strict";
import test from "node:test";
import {
  compareEditorObservation,
  inputCleanupConfirmed,
  isSafeClipboardRefusal,
} from "./clipboard-editor-observation.mjs";

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

test("only a recognized pre-input snapshot refusal qualifies as safe", () => {
  assert.equal(
    isSafeClipboardRefusal({
      ok: false,
      error:
        "CLIPBOARD_SNAPSHOT_UNSUPPORTED: indexed file contents cannot be preserved; unchanged",
    }),
    true,
  );
  for (const result of [
    { ok: false, error: "CLIPBOARD_HELPER_TIMEOUT" },
    { ok: false, error: "CLIPBOARD_RESTORE_UNCONFIRMED" },
    { ok: false, error: "UNSUPPORTED_HOST" },
    { ok: false, error: "Clipboard format error" },
    { ok: true, error: "CLIPBOARD_SNAPSHOT_UNSUPPORTED: no" },
    { error: "CLIPBOARD_SNAPSHOT_UNSUPPORTED: no" },
  ])
    assert.equal(isSafeClipboardRefusal(result), false);
});

test("clipboard input retains its owner until both cleanup acknowledgments or a pre-input refusal", () => {
  assert.equal(
    inputCleanupConfirmed({
      ok: true,
      cleanupConfirmed: true,
      clipboardCleanupConfirmed: true,
    }),
    true,
  );
  assert.equal(
    inputCleanupConfirmed({
      ok: false,
      error: "CLIPBOARD_SNAPSHOT_UNSUPPORTED: unchanged",
      cleanupConfirmed: true,
    }),
    true,
  );
  for (const result of [
    undefined,
    { ok: true },
    { ok: true, cleanupConfirmed: true },
    { ok: true, cleanupConfirmed: false, clipboardCleanupConfirmed: true },
    { ok: false, error: "CLIPBOARD_HELPER_TIMEOUT", cleanupConfirmed: true },
  ])
    assert.equal(inputCleanupConfirmed(result), false);
});
