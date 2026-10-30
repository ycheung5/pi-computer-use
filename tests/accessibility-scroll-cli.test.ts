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
  new URL("./accessibility-comparison.mjs", import.meta.url),
);

test("native scroll plan and refusal need no backend, build or Windows access", () => {
  const folder = mkdtempSync(join(tmpdir(), "pi-scroll-plan-"));
  try {
    const script = join(folder, "accessibility-comparison.mjs");
    writeFileSync(script, readFileSync(source));
    const env = {
      ...process.env,
      PI_CU_DEDICATED_INPUT_DESKTOP: "",
      PI_CU_RELEASE_OUTPUT: join(folder, "must-not-exist"),
    };
    const plan = spawnSync(
      process.execPath,
      [script, "--native-scroll-only", "--plan"],
      { env, encoding: "utf8" },
    );
    assert.equal(plan.status, 0, plan.stderr);
    const report = JSON.parse(plan.stdout);
    assert.equal(report.executed, false);
    assert.equal(report.physicalInput, "possible");
    assert.deepEqual(report.engines, ["reference", "pi"]);
    const refusal = spawnSync(
      process.execPath,
      [script, "--native-scroll-only"],
      { env, encoding: "utf8" },
    );
    assert.notEqual(refusal.status, 0);
    assert.match(refusal.stderr, /PI_CU_DEDICATED_INPUT_DESKTOP/);
    assert.deepEqual(readdirSync(folder), ["accessibility-comparison.mjs"]);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
