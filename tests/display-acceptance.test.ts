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

test("display capture plan has no backend dependency or display-setting effects", async () => {
  const folder = await mkdtemp(join(tmpdir(), "pi-capture-plan-"));
  try {
    for (const file of ["native-capture.mjs", "native-host.mjs"])
      await cp(resolve("tests", file), join(folder, file));
    const plan = JSON.parse(
      execFileSync(
        process.execPath,
        [join(folder, "native-capture.mjs"), "--display", "--plan"],
        { encoding: "utf8" },
      ),
    );
    assert.equal(plan.executed, false);
    assert.equal(plan.physicalInput, false);
    assert.equal(plan.globalDisplayChanges, false);
    assert.equal(plan.ownedWindowOnly, true);
    const control = JSON.parse(
      execFileSync(
        process.execPath,
        [join(folder, "native-capture.mjs"), "--control-capture", "--plan"],
        { encoding: "utf8" },
      ),
    );
    assert.equal(control.ownedWindowOnly, true);
    assert.equal(control.mode, "control-capture");
    assert.throws(() =>
      execFileSync(
        process.execPath,
        [
          join(folder, "native-capture.mjs"),
          "--display",
          "--control-capture",
          "--plan",
        ],
        { stdio: "pipe" },
      ),
    );
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
