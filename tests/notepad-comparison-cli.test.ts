import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

test("Unicode comparison selects original case IDs and rejects invalid selection before input", () => {
  const listed = run("--list", "--engine=reference", "--case=3");
  assert.equal(listed.status, 0, listed.stderr);
  const plan = JSON.parse(listed.stdout);
  assert.equal(plan.cases.length, 1);
  assert.equal(plan.cases[0].id, 3);
  assert.equal(plan.cases[0].seed, "Reuse test\n中文測試 café 😀");
  for (const value of ["0", "7", "1.5", "abc", ""]) {
    const invalid = run("--list", `--case=${value}`);
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stderr, /case must be an integer from 1 to 6/);
  }
});

test("Unicode diagnostics select one labelled mechanism without starting a backend", () => {
  const variants = [
    ["pi", "pi-no-delay", "inter-character-delay"],
    ["reference", "reference-keyup-scan", "unicode-keyup-scan"],
    ["reference", "reference-pair-batches", "events-per-batch"],
  ];
  for (const [engine, diagnostic, variable] of variants) {
    const result = run(
      "--list",
      `--engine=${engine}`,
      `--diagnostic=${diagnostic}`,
      "--case=4",
    );
    assert.equal(result.status, 0, result.stderr);
    const plan = JSON.parse(result.stdout);
    assert.equal(plan.executed, false);
    assert.equal(plan.diagnostic.name, diagnostic);
    assert.equal(plan.diagnostic.variable, variable);
    assert.equal(plan.cases[0].id, 4);
    const refused = run(`--engine=${engine}`, `--diagnostic=${diagnostic}`);
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /PI_CU_NOTEPAD_INPUT_TEST=1/);
  }
  for (const args of [
    ["--diagnostic=unknown"],
    ["--diagnostic=constructor"],
    ["--diagnostic=toString"],
    ["--engine=pi", "--diagnostic=reference-keyup-scan"],
    ["--engine=reference", "--diagnostic=pi-no-delay"],
    ["--unexpected=true"],
  ]) {
    const result = run("--list", ...args);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Unknown option|diagnostic/);
  }
});

test("Unicode cleanup report retains case failure and separately reports cleanup failure", () => {
  const folder = mkdtempSync(join(tmpdir(), "pi-cu-unicode-report-"));
  try {
    const saved = join(folder, "result.json");
    writeFileSync(
      saved,
      JSON.stringify({
        caseFailure: { message: "text mismatch" },
        cleanupFailures: [{ stage: "folder", message: "EBUSY" }],
        retainedTabs: 0,
      }),
    );
    const result = run(`--report-cleanup=${saved}`);
    assert.notEqual(result.status, 0);
    const report = JSON.parse(result.stdout);
    assert.equal(report.caseFailure.message, "text mismatch");
    assert.equal(report.cleanupFailures[0].message, "EBUSY");
    assert.equal(report.cleanupConfirmed, false);
    assert.equal(readFileSync(saved, "utf8").includes("text mismatch"), true);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("Unicode cleanup reports retained tabs as incomplete and successful cleanup as complete", () => {
  const folder = mkdtempSync(join(tmpdir(), "pi-cu-unicode-report-"));
  try {
    const saved = join(folder, "result.json");
    writeFileSync(
      saved,
      JSON.stringify({
        caseFailure: null,
        cleanupFailures: [],
        retainedTabs: 1,
      }),
    );
    let result = run(`--report-cleanup=${saved}`);
    assert.notEqual(result.status, 0);
    assert.equal(JSON.parse(result.stdout).cleanupConfirmed, false);
    writeFileSync(
      saved,
      JSON.stringify({
        caseFailure: null,
        cleanupFailures: [],
        retainedTabs: 0,
      }),
    );
    result = run(`--report-cleanup=${saved}`);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).cleanupConfirmed, true);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
