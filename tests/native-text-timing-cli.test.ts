import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("owned text timing plan prepares only the new scoped keyboard cases without desktop access", () => {
  const plan = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL("./native-text.mjs", import.meta.url)),
      "--timing",
      "--plan",
    ],
    { encoding: "utf8" },
  );
  assert.equal(plan.status, 0, plan.stderr);
  const result = JSON.parse(plan.stdout);
  assert.equal(result.executed, false);
  assert.equal(result.physicalInput, true);
  assert.equal(result.clipboard, false);
  assert.equal(result.case, "keyboard-timing");
  assert.deepEqual(result.cases, [
    "modifier-aliases",
    "immediate-release",
    "timed-key-and-chord",
    "focus-error-release",
    "short-deadline-release",
    "cancel-disabled-deadline",
  ]);
});
