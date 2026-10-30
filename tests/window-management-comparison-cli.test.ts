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
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const source = fileURLToPath(
  new URL("./window-management-comparison.mjs", import.meta.url),
);

test("paired window-management planning and refusal need no backend or Windows access", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-window-plan-"));
  try {
    const script = join(dir, "window-management-comparison.mjs");
    writeFileSync(script, readFileSync(source));
    const env = { ...process.env, PI_CU_WINDOW_MANAGEMENT_TEST: "" };
    for (const engine of ["pi", "reference"]) {
      const plan = spawnSync(
        process.execPath,
        [script, "--plan", `--engine=${engine}`],
        { env, encoding: "utf8" },
      );
      assert.equal(plan.status, 0, plan.stderr);
      const report = JSON.parse(plan.stdout);
      assert.equal(report.executed, false);
      assert.equal(report.engine, engine);
      assert.equal(report.physicalInput, false);
      assert.equal(report.foregroundChangesPossible, true);
      const refusal = spawnSync(
        process.execPath,
        [script, `--engine=${engine}`],
        { env, encoding: "utf8" },
      );
      assert.notEqual(refusal.status, 0);
      assert.match(refusal.stderr, /PI_CU_WINDOW_MANAGEMENT_TEST/);
      assert.doesNotMatch(
        refusal.stderr,
        /MODULE_NOT_FOUND|ENOENT|Windows Node/,
      );
    }
    for (const invalid of ["--engine=unknown", "--unexpected"]) {
      const rejected = spawnSync(
        process.execPath,
        [script, "--plan", invalid],
        { env, encoding: "utf8" },
      );
      assert.notEqual(
        rejected.status,
        0,
        `invalid option must be rejected: ${invalid}`,
      );
    }
    assert.deepEqual(readdirSync(dir), ["window-management-comparison.mjs"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
