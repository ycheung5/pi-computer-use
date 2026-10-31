import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { WorkerClient } from "../src/client.js";

test("OCR rejects invalid targets and options before capture and remains usable", async () => {
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
      { query: 123 },
      { query: "" },
      { scope: "invented" },
      { resolveControl: "yes" },
      { includeScreenshot: 1 },
      { language: "en-US" },
      { processId: -1 },
      { image: "untrusted" },
    ]) {
      const result = await worker.execute("ocr", args);
      assert.equal(result.ok, false);
      assert.match(String(result.error), /INVALID_ARGUMENTS/);
    }
    assert.equal((await worker.execute("health", {})).ok, true);
    const cancelled = new AbortController();
    cancelled.abort();
    await assert.rejects(worker.execute("ocr", {}, cancelled.signal));
  } finally {
    await worker.dispose();
  }
});
