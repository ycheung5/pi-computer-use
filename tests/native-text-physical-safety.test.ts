import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
