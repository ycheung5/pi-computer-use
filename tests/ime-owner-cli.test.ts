import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const run = (...args: string[]) =>
  spawnSync(process.execPath, ["tests/ime-owner.mjs", ...args], {
    encoding: "utf8",
  });
test("IME owner observation remains scoped to the hidden synthetic fixture", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-cu-ime-owner-report-"));
  try {
    const path = join(dir, "observation.json");
    for (const own of [true, false]) {
      const observation = {
        ownerThreadId: 123,
        observerThreadId: 456,
        windowHwnd: 100,
        owner: { available: own, rawOpen: own ? true : null },
        observer: { available: false, rawOpen: null },
      };
      writeFileSync(path, JSON.stringify(observation));
      const result = run(`--report=${path}`);
      assert.equal(result.status, 0, result.stderr);
      const report = JSON.parse(result.stdout);
      assert.deepEqual(report.observation, observation);
      assert.equal(report.scope, "hidden-owned-window");
      assert.equal(report.focusedTargetImeState, "unknown");
      assert.equal(report.tsfState, "unknown");
      assert.equal(report.inputSent, false);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("IME owner plan does not contact Windows or alter input state", () => {
  const result = run("--list");
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.executed, false);
  assert.equal(plan.inputSent, false);
  assert.equal(plan.changesKeyboardLayout, false);
});
