import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import {
  compareEditorObservation,
  inputCleanupConfirmed,
  isSafeClipboardRefusal,
  referenceActivationCleanupConfirmed,
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
      action: "type_text",
      ok: true,
      cleanupConfirmed: true,
      clipboardCleanupConfirmed: true,
    }),
    true,
  );
  assert.equal(
    inputCleanupConfirmed({
      action: "type_text",
      ok: false,
      error: "CLIPBOARD_SNAPSHOT_UNSUPPORTED: unchanged",
      cleanupConfirmed: true,
    }),
    true,
  );
  for (const result of [
    undefined,
    {
      action: "type_text",
      cleanupConfirmed: true,
      clipboardCleanupConfirmed: true,
    },
    {
      action: "other",
      ok: true,
      cleanupConfirmed: true,
      clipboardCleanupConfirmed: true,
    },
    { ok: true, cleanupConfirmed: true, clipboardCleanupConfirmed: true },
    {
      action: "other",
      ok: false,
      error: "CLIPBOARD_SNAPSHOT_UNSUPPORTED: unchanged",
      cleanupConfirmed: true,
    },
    { ok: true },
    { ok: true, cleanupConfirmed: true },
    { ok: true, cleanupConfirmed: false, clipboardCleanupConfirmed: true },
    { ok: false, error: "CLIPBOARD_HELPER_TIMEOUT", cleanupConfirmed: true },
  ])
    assert.equal(inputCleanupConfirmed(result), false);
});

test("retained owner remains alive without any other active handles", async () => {
  const { spawn } = await import("node:child_process");
  const script = `import { retainUnconfirmedOwner } from ${JSON.stringify(new URL("./clipboard-editor-observation.mjs", import.meta.url).href)}; console.log("ready"); await retainUnconfirmedOwner();`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const closed = once(child, "close");
  try {
    const [chunk] = await once(child.stdout, "data");
    assert.match(String(chunk), /ready/);
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(child.exitCode, null, "retained process must stay alive");
  } finally {
    child.kill();
    await closed;
  }
});

test("reference activation requires its own explicit input cleanup acknowledgment", () => {
  assert.equal(
    referenceActivationCleanupConfirmed({
      action: "activate_window",
      ok: true,
      cleanupConfirmed: true,
    }),
    true,
  );
  for (const result of [
    undefined,
    { action: "activate_window", ok: true },
    { action: "type_text", ok: true, cleanupConfirmed: true },
    { action: "activate_window", cleanupConfirmed: true },
    {
      action: "activate_window",
      ok: true,
      cleanupConfirmed: true,
      inputCleanupConfirmed: false,
    },
    {
      action: "activate_window",
      ok: true,
      cleanupConfirmed: true,
      keyboardCleanupConfirmed: false,
    },
    {
      action: "activate_window",
      ok: true,
      cleanupConfirmed: true,
      cleanupVerification: "unconfirmed",
    },
  ])
    assert.equal(referenceActivationCleanupConfirmed(result), false);
});
