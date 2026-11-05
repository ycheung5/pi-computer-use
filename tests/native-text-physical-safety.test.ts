import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

test("legacy physical text runner refuses before loading a backend or touching the clipboard", () => {
  const env = { ...process.env, PI_CU_DEDICATED_INPUT_DESKTOP: "1" };
  const plan = spawnSync(
    process.execPath,
    ["tests/native-text-physical.mjs", "--plan"],
    { env, encoding: "utf8" },
  );
  assert.equal(plan.status, 0, plan.stderr);
  assert.deepEqual(JSON.parse(plan.stdout), {
    executed: false,
    blocked: true,
    reason: "clipboard-and-input-settlement-unverified",
  });
  const run = spawnSync(process.execPath, ["tests/native-text-physical.mjs"], {
    env,
    encoding: "utf8",
  });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /LEGACY_TEXT_PHYSICAL_UNSAFE/);
});

test("owned chord runner plans and refuses missing opt-in before loading a backend", async () => {
  const folder = await mkdtemp(join(tmpdir(), "text-chords-plan-"));
  try {
    for (const file of ["native-text.mjs", "native-host.mjs"])
      await cp(resolve("tests", file), join(folder, file));
    const runner = join(folder, "native-text.mjs"),
      env = { ...process.env, PI_CU_DEDICATED_INPUT_DESKTOP: "" };
    const plan = spawnSync(process.execPath, [runner, "--chords", "--plan"], {
      env,
      encoding: "utf8",
    });
    assert.equal(plan.status, 0, plan.stderr);
    assert.deepEqual(JSON.parse(plan.stdout), {
      executed: false,
      physicalInput: true,
      clipboard: false,
      case: "chords-and-editor-focus",
    });
    const denied = spawnSync(process.execPath, [runner, "--chords"], {
      env,
      encoding: "utf8",
    });
    assert.notEqual(denied.status, 0);
    assert.match(denied.stderr, /PI_CU_DEDICATED_INPUT_DESKTOP=1 required/);
    assert.doesNotMatch(denied.stderr, /MODULE_NOT_FOUND/);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
