import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const run = (...args: string[]) =>
  spawnSync(process.execPath, ["tests/native-notepad-unicode.mjs", ...args], {
    encoding: "utf8",
    env: { ...process.env, PI_CU_NOTEPAD_INPUT_TEST: "" },
  });
test("Unicode comparison lists cases without desktop opt-in or a built worker", () => {
  const result = run("--list", "--engine=reference");
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.engine, "reference");
  assert.equal(plan.executed, false);
  assert.equal(plan.cases.length, 6);
  assert.equal(
    plan.cases[2].expected,
    "Reuse test\n中文測試 café 😀\nSendInput check: 中文測試 café 😀",
  );
});
test("Unicode comparison refuses execution before backend startup", () => {
  const result = run("--engine=reference", "--reference=/does/not/exist");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /PI_CU_NOTEPAD_INPUT_TEST=1/);
  assert.doesNotMatch(
    result.stderr,
    /MODULE_NOT_FOUND|ENOENT|Run with Windows/,
  );
});
