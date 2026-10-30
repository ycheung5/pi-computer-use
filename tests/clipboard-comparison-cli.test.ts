import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const run = (...args: string[]) =>
  spawnSync(process.execPath, ["tests/native-ole-clipboard.mjs", ...args], {
    encoding: "utf8",
    env: { ...process.env, PI_CU_CLIPBOARD_INPUT_TEST: "" },
  });

test("clipboard cases are independently selectable without importing a backend", () => {
  for (const id of ["ole-preservation", "indexed-refusal", "newer-copy"]) {
    const result = run("--plan", "--case", id, "--engine", "reference");
    assert.equal(result.status, 0, result.stderr);
    const plan = JSON.parse(result.stdout);
    assert.deepEqual(
      plan.cases.map((item: { id: string }) => item.id),
      [id],
    );
    assert.equal(plan.execution, "not-run");
  }
  const invalid = run("--plan", "--case", "missing");
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /Unknown clipboard case/);
});

test("indexed fixture probe requires opt-in and never imports a backend before the gate", () => {
  const plan = run("--plan", "--probe-indexed");
  assert.equal(plan.status, 0, plan.stderr);
  assert.equal(JSON.parse(plan.stdout).probe, "indexed-fixture");
  const blocked = run(
    "--probe-indexed",
    "--engine",
    "reference",
    "--reference",
    "/missing",
  );
  assert.notEqual(blocked.status, 0);
  assert.match(blocked.stderr, /PI_CU_CLIPBOARD_INPUT_TEST=1/);
  assert.doesNotMatch(
    blocked.stderr,
    /MODULE_NOT_FOUND|ENOENT|requires Windows Node/,
  );
});

test("standard virtual-file fixture probe remains separately selected and gated", () => {
  const plan = run("--plan", "--probe-virtual-file");
  assert.equal(plan.status, 0, plan.stderr);
  assert.equal(JSON.parse(plan.stdout).probe, "virtual-file-fixture");
  assert.deepEqual(JSON.parse(plan.stdout).observations, [
    "directContentQuery",
    "directContentGet",
    "clipboardContentQuery",
    "clipboardContentGet",
  ]);
  const blocked = run("--probe-virtual-file");
  assert.notEqual(blocked.status, 0);
  assert.match(blocked.stderr, /PI_CU_CLIPBOARD_INPUT_TEST=1/);
  assert.doesNotMatch(
    blocked.stderr,
    /MODULE_NOT_FOUND|ENOENT|requires Windows Node/,
  );
  const conflict = run("--plan", "--probe-indexed", "--probe-virtual-file");
  assert.notEqual(conflict.status, 0);
});
