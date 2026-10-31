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

test("saved monitor report rejects translated origin and incorrect frame size", () => {
  const folder = mkdtempSync(join(tmpdir(), "pi-cu-frame-report-"));
  try {
    const script = join(folder, "reference-capture.mjs"),
      path = join(folder, "report.json");
    writeFileSync(
      script,
      readFileSync(
        fileURLToPath(new URL("./reference-capture.mjs", import.meta.url)),
      ),
    );
    const valid = {
      engine: "pi",
      scenario: "monitor-negative-x-scaled",
      status: "pass",
      observation: {
        method: "printwindow",
        maxWidth: 80,
        oracle: { frame: { x: -1833, y: 80, width: 306, height: 193 } },
        bounds: { x: -1833, y: 80, width: 306, height: 193 },
        origin: { x: -1833, y: 80 },
        width: 80,
        height: 50,
        scale: 80 / 306,
        scaleY: 50 / 193,
      },
    };
    const call = (row: unknown) => {
      writeFileSync(path, JSON.stringify({ cases: [row] }));
      return spawnSync(
        process.execPath,
        [script, `--verify-monitor-report=${path}`],
        { encoding: "utf8" },
      );
    };
    const result = call(valid);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).verified, 1);
    for (const mutation of [
      "translated",
      "origin-only",
      "size",
      "height",
      "y-scale",
    ]) {
      const shifted = structuredClone(valid);
      if (mutation === "translated") {
        shifted.observation.origin.x += 10;
        shifted.observation.bounds.x += 10;
      }
      if (mutation === "origin-only") shifted.observation.origin.y += 10;
      if (mutation === "size") shifted.observation.bounds.width += 1;
      if (mutation === "height") shifted.observation.height += 1;
      if (mutation === "y-scale") shifted.observation.scaleY = 80 / 306;
      const invalid = call(shifted);
      assert.notEqual(invalid.status, 0, mutation);
    }
    const reference = structuredClone(valid);
    reference.engine = "reference";
    reference.observation.scale = 0.2614;
    reference.observation.scaleY = 0.2614;
    assert.equal(
      call(reference).status,
      0,
      "Reference uniform scale allows only the measured resized-height rounding",
    );
    reference.status = "fail";
    const replay = call(reference);
    assert.equal(replay.status, 0, replay.stderr);
    assert.equal(
      JSON.parse(replay.stdout).checks[0].originalStatus,
      "fail",
      "Rechecking frame assertions never rewrites the collected status",
    );
    reference.status = "blocked";
    assert.notEqual(
      call(reference).status,
      0,
      "Blocked setup is not collected coordinate evidence",
    );
    reference.status = "pass";
    reference.observation.scale = reference.observation.scaleY = 0.2613;
    assert.notEqual(
      call(reference).status,
      0,
      "Reference precision does not permit a larger scale mismatch",
    );
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
