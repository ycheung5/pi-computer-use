import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

test("monitor capture plan lists only owned placement captures without backend access", () => {
  const folder = mkdtempSync(join(tmpdir(), "pi-cu-monitor-plan-"));
  try {
    const script = join(folder, "reference-capture.mjs");
    writeFileSync(
      script,
      readFileSync(
        fileURLToPath(new URL("./reference-capture.mjs", import.meta.url)),
      ),
    );
    const result = spawnSync(
      process.execPath,
      [script, "--scenario", "monitor-placements", "--plan"],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.executed, false);
    assert.equal(report.physicalInput, false);
    assert.equal(report.ocr, false);
    assert.equal(report.globalDisplayChanges, false);
    assert.deepEqual(report.placements, ["primary", "negative-x", "boundary"]);
    assert.deepEqual(report.maxWidths, [0, 80]);
    assert.deepEqual(report.engines, ["reference", "pi"]);
    assert.deepEqual(readdirSync(folder), ["reference-capture.mjs"]);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
