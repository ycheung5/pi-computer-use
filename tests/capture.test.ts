import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { WorkerClient } from "../src/client.js";

test("screenshots reject invalid bounds and options without touching the desktop", async () => {
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
    for (const args of [
      { maxWidth: -1 },
      { maxWidth: 7681 },
      { maxWidth: 0.5 },
      { scope: "invented" },
      { nativeWindowHandle: -3 },
      { processId: "123" },
    ]) {
      const result = await worker.execute("screenshot", args);
      assert.equal(result.ok, false);
      assert.match(String(result.error), /INVALID_ARGUMENTS/);
    }
    assert.equal((await worker.execute("health", {})).ok, true);
  } finally {
    await worker.dispose();
  }
});
