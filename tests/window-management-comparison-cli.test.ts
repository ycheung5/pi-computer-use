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
  new URL("./window-management-comparison.mjs", import.meta.url),
);

test("paired window-management planning and refusal need no backend or Windows access", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-window-plan-"));
  try {
    const script = join(dir, "window-management-comparison.mjs");
    writeFileSync(script, readFileSync(source));
    const env = { ...process.env, PI_CU_WINDOW_MANAGEMENT_TEST: "" };
    for (const engine of ["pi", "reference"]) {
      const plan = spawnSync(
        process.execPath,
        [script, "--plan", `--engine=${engine}`],
        { env, encoding: "utf8" },
      );
      assert.equal(plan.status, 0, plan.stderr);
      const report = JSON.parse(plan.stdout);
      assert.equal(report.executed, false);
      assert.equal(report.engine, engine);
      assert.equal(report.physicalInput, false);
      assert.equal(report.foregroundChangesPossible, true);
      const refusal = spawnSync(
        process.execPath,
        [script, `--engine=${engine}`],
        { env, encoding: "utf8" },
      );
      assert.notEqual(refusal.status, 0);
      assert.match(refusal.stderr, /PI_CU_WINDOW_MANAGEMENT_TEST/);
      assert.doesNotMatch(
        refusal.stderr,
        /MODULE_NOT_FOUND|ENOENT|Windows Node/,
      );
    }
    for (const invalid of ["--engine=unknown", "--unexpected"]) {
      const rejected = spawnSync(
        process.execPath,
        [script, "--plan", invalid],
        { env, encoding: "utf8" },
      );
      assert.notEqual(
        rejected.status,
        0,
        `invalid option must be rejected: ${invalid}`,
      );
    }
    assert.deepEqual(readdirSync(dir), ["window-management-comparison.mjs"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("extended window cases are listed without loading a backend or using Windows", () => {
  const env = { ...process.env, PI_CU_WINDOW_MANAGEMENT_TEST: "" };
  for (const engine of ["pi", "reference"]) {
    const result = spawnSync(
      process.execPath,
      [source, "--plan", "--extended", `--engine=${engine}`],
      { env, encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.executed, false);
    assert.equal(report.foregroundChangesPossible, true);
    assert.ok(report.cases.includes("same-process-distractor"));
    assert.ok(report.cases.includes("replacement-identity"));
    assert.ok(report.cases.includes("foreground-restoration"));
  }
});

test("cross-process focus diagnostic is opt-in and plans without touching Windows", () => {
  const script = fileURLToPath(
    new URL("./foreground-focus-comparison.mjs", import.meta.url),
  );
  const env = { ...process.env, PI_CU_WINDOW_MANAGEMENT_TEST: "" };
  const plan = spawnSync(
    process.execPath,
    [script, "--plan", "--engine=reference"],
    { env, encoding: "utf8" },
  );
  assert.equal(plan.status, 0, plan.stderr);
  const report = JSON.parse(plan.stdout);
  assert.equal(report.physicalInput, false);
  assert.equal(report.foregroundChangesPossible, true);
  assert.deepEqual(report.cases, ["cross-process-prior-foreground"]);
  const refusal = spawnSync(process.execPath, [script, "--engine=reference"], {
    env,
    encoding: "utf8",
  });
  assert.notEqual(refusal.status, 0);
  assert.match(refusal.stderr, /PI_CU_WINDOW_MANAGEMENT_TEST/);
});

test("focus evidence distinguishes interference, restoration failure and changed owner", () => {
  const script = fileURLToPath(
    new URL("./foreground-focus-comparison.mjs", import.meta.url),
  );
  const dir = mkdtempSync(join(tmpdir(), "pi-focus-report-"));
  try {
    const path = join(dir, "evidence.json");
    const prior = { nativeWindowHandle: 10, processId: 20 };
    const before = {
      foregroundHandle: 10,
      foregroundPid: 20,
      lastInputTick: 2,
    };
    const sample = { ...before, activeEditor: true };
    const base = {
      prior,
      before,
      pre: before,
      focus: { ok: true },
      samples: [sample],
    };
    for (const [evidence, status] of [
      [base, "pass"],
      [{ ...base, pre: { ...before, lastInputTick: 3 } }, "inconclusive"],
      [{ ...base, samples: [{ ...sample, lastInputTick: 3 }] }, "inconclusive"],
      [{ ...base, pre: { ...before, foregroundPid: 99 } }, "inconclusive"],
      [{ ...base, samples: [{ ...sample, foregroundHandle: 99 }] }, "fail"],
    ] as const) {
      writeFileSync(path, JSON.stringify(evidence));
      const actual = spawnSync(process.execPath, [script, `--report=${path}`], {
        encoding: "utf8",
      });
      assert.equal(JSON.parse(actual.stdout).status, status, actual.stderr);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
