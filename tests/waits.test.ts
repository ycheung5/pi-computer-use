import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { WorkerClient } from "../src/client.js";

const launch = async () => ({
  executable: process.execPath,
  args: [
    "--import",
    "tsx",
    fileURLToPath(new URL("../src/worker.ts", import.meta.url)),
  ],
});
test("explicit wait honors its bounded delay even with a shorter ordinary transport deadline", async () => {
  const worker = new WorkerClient({ launch, timeoutMs: 10 });
  try {
    const start = performance.now();
    const result = await worker.execute("wait", { milliseconds: 45 });
    assert.equal(result.ok, true);
    assert.equal(result.milliseconds, 45);
    assert.ok(performance.now() - start >= 40);
    assert.equal(result.verification, undefined);
  } finally {
    await worker.dispose();
  }
});
test("wait_for validates explicit conditions, targets and bounded polling options", async () => {
  const worker = new WorkerClient({ launch });
  try {
    for (const args of [
      { condition: "invalid" },
      { condition: "window" },
      { condition: "text", query: " " },
      { condition: "element", query: "needle", timeoutMs: 99 },
      { condition: "element", query: "needle", intervalMs: 49 },
      { condition: "element", query: "needle", maxNodes: 5001 },
      { condition: "element", query: "needle", maxDepth: 13 },
      { condition: "text", query: "needle", scope: "invented" },
      { condition: "window", processId: 1, extra: true },
    ]) {
      const result = await worker.execute("wait_for", args);
      assert.equal(result.ok, false);
      assert.match(String(result.error), /INVALID_ARGUMENTS/);
    }
    for (const args of [
      { milliseconds: 0 },
      { milliseconds: 30001 },
      { milliseconds: 1.5 },
      { milliseconds: "5" },
      { extra: true },
    ])
      assert.equal((await worker.execute("wait", args)).ok, false);
  } finally {
    await worker.dispose();
  }
});
test("an active wait cancels promptly without waiting for its full duration", async () => {
  const worker = new WorkerClient({ launch });
  try {
    const controller = new AbortController();
    const waiting = worker.execute(
      "wait",
      { milliseconds: 30000 },
      controller.signal,
    );
    setTimeout(() => controller.abort(), 200);
    const start = performance.now();
    await assert.rejects(waiting);
    assert.ok(performance.now() - start < 1500);
  } finally {
    await worker.dispose();
  }
});
test("valid conditional waits report unavailable native observations as inconclusive rather than absence", async () => {
  if (process.platform === "win32") return;
  const worker = new WorkerClient({ launch });
  try {
    const result = await worker.execute("wait_for", {
      condition: "window",
      windowTitle: "nonexistent fixture",
      appear: false,
      timeoutMs: 100,
      intervalMs: 50,
    });
    assert.equal(result.verification, "inconclusive");
    assert.equal(result.conclusive, false);
    assert.equal(result.timedOut, true);
    assert.match(String(result.observationError), /UNSUPPORTED_HOST/);
  } finally {
    await worker.dispose();
  }
});
