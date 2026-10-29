import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { WorkerClient } from "../src/client.js";

const workerPath = fileURLToPath(new URL("../src/worker.ts", import.meta.url));
test("accessibility observations reject invalid options before native execution", async () => {
  const worker = new WorkerClient({
    launch: async () => ({
      executable: process.execPath,
      args: ["--import", "tsx", workerPath],
    }),
  });
  try {
    for (const [action, args] of [
      ["accessibility_tree", { maxDepth: 13 }],
      ["accessibility_tree", { maxDepth: null }],
      ["snapshot", { treeTimeoutMs: 99 }],
      ["find", { query: "" }],
      ["element_info", {}],
    ] as const) {
      const result = await worker.execute(action, args);
      assert.equal(result.ok, false);
      assert.match(String(result.error), /INVALID_ARGUMENTS/);
    }
  } finally {
    await worker.dispose();
  }
});
