import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

test("Pointer comparison plans without resources and refuses unapproved input", async () => {
  const folder = await mkdtemp(join(tmpdir(), "pointer-cli-"));
  try {
    const runner = join(folder, "runner.mjs");
    await cp(resolve("tests/native-pointer-physical.mjs"), runner);
    const run = (...args: string[]) =>
      spawnSync(process.execPath, [runner, ...args], {
        cwd: folder,
        encoding: "utf8",
        env: { ...process.env, PI_CU_DEDICATED_INPUT_DESKTOP: "" },
      });
    for (const engine of ["pi", "reference"]) {
      const listed = run("--list", `--engine=${engine}`);
      assert.equal(listed.status, 0, listed.stderr);
      const plan = JSON.parse(listed.stdout);
      assert.equal(plan.executed, false);
      assert.equal(plan.engine, engine);
      assert.ok(plan.cases.includes("scaled-click"));
      assert.ok(plan.pending.includes("foreground-restoration"));
      const refused = run(
        `--engine=${engine}`,
        "--reference=/absent/reference",
      );
      assert.notEqual(refused.status, 0);
      assert.match(refused.stderr, /PI_CU_DEDICATED_INPUT_DESKTOP=1/);
      assert.doesNotMatch(
        refused.stderr,
        /MODULE_NOT_FOUND|ENOENT|Windows Node/,
      );
    }
    const invalid = run("--list", "--engine=other");
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stderr, /engine must be pi or reference/);
    const unknown = run("--list", "--unknown");
    assert.notEqual(unknown.status, 0);
    assert.match(unknown.stderr, /Unknown option/);
    assert.deepEqual(await readdir(folder), ["runner.mjs"]);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
