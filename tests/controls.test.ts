import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { WorkerClient } from "../src/client.js";

test("background controls validate arguments before native execution or physical escalation", async () => {
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
      ["focus", {}],
      ["invoke", { elementId: "uia:rt:1-2", action: "delete" }],
      ["set_value", { elementId: "uia:rt:1-2", value: 12 }],
      ["scroll", { elementId: "uia:rt:1-2", deltaY: 1.5 }],
    ] as const) {
      const result = await worker.execute(action, args);
      assert.equal(result.ok, false);
      assert.match(String(result.error), /INVALID_ARGUMENTS/);
    }
  } finally {
    await worker.dispose();
  }
});
