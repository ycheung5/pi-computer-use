import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { WorkerClient } from "../src/client.js";

test("text and key tools reject malformed or unsafe input before touching the desktop or clipboard", async () => {
  const worker = new WorkerClient({
    launch: async () => ({
      executable: process.execPath,
      args: [
        "--import",
        "tsx",
        fileURLToPath(new URL("../src/worker.ts", import.meta.url)),
      ],
    }),
  });
  try {
    for (const [action, args] of [
      ["type_text", {}],
      ["type_text", { text: "" }],
      ["type_text", { text: "hello", method: "shell" }],
      ["type_text", { text: "hello", focusMode: "guess" }],
      ["type_text", { text: "hello", restoreClipboard: 1 }],
      ["keypress", { keys: [] }],
      ["keypress", { keys: ["Ctrl"] }],
      ["keypress", { keys: ["Ctrl", "A", "B"] }],
      ["keypress", { keys: ["Win", "R"] }],
      ["keypress", { keys: ["Escape"], dispatch: "background" }],
    ] as const) {
      const result = await worker.execute(action, args);
      assert.equal(result.ok, false);
      assert.match(
        String(result.error),
        /INVALID_ARGUMENTS|KEY_BLOCKED|BACKGROUND_UNAVAILABLE/,
      );
    }
  } finally {
    await worker.dispose();
  }
});
