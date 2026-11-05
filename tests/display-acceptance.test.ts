import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

test("indicator display plans work without a backend or Windows access", async () => {
  const folder = await mkdtemp(join(tmpdir(), "pi-display-plan-"));
  try {
    const script = join(folder, "indicators-host.mjs");
    await cp(resolve("tests/indicators-host.mjs"), script);
    for (const { flag, mode } of [
      { flag: "--layout-only", mode: "layout" },
      { flag: "--lifecycle-only", mode: "lifecycle" },
    ]) {
      const plan = JSON.parse(
        execFileSync(process.execPath, [script, flag, "--plan"], {
          encoding: "utf8",
        }),
      );
      assert.equal(plan.executed, false);
      assert.equal(plan.mode, mode);
      assert.equal(plan.physicalInput, false);
      assert.equal(plan.globalDisplayChanges, false);
    }
    assert.throws(() =>
      execFileSync(
        process.execPath,
        [script, "--layout-only", "--lifecycle-only", "--plan"],
        { stdio: "pipe" },
      ),
    );
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
