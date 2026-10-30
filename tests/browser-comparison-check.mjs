// Verify public paired-runner failure or post-action preservation evidence in both engines.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

assert.ok(process.argv[2], "Pass the reference checkout path");
const filled = process.argv.includes("--filled");
let result;
try {
  result = await promisify(execFile)(
    process.execPath,
    [
      fileURLToPath(new URL("./browser-comparison.mjs", import.meta.url)),
      process.argv[2],
      process.argv[3] ?? "edge",
      "1",
      ...(filled ? [] : ["--verify-unfilled"]),
    ],
    { timeout: 240000, maxBuffer: 8 * 1024 * 1024 },
  );
} catch (error) {
  result = error;
}
assert.equal(
  result.code ?? 0,
  filled ? 0 : 1,
  "CLI status must match the outcome",
);
const line = result.stdout
  ?.split(/\r?\n/)
  .find((value) => value.startsWith('{"diagnosticInjection":'));
assert.ok(line, `Missing comparison report: ${result.stderr}`);
const report = JSON.parse(line);
assert.equal(report.ok, filled);
assert.equal(report.diagnosticInjection, !filled);
assert.equal(report.cases.length, 2);
for (const row of report.cases) {
  if (filled) {
    assert.equal(row.status, "pass");
    assert.deepEqual(row.restrictedInspection.postActionValues, {
      disabled: "Disabled value",
      readonly: "Read-only value",
    });
    assert.equal(row.restrictedInspection.valuesPreserved, true);
    assert.ok(
      row.steps.some(
        (step) =>
          step.phase === "restricted values after actions" &&
          step.status === "pass",
      ),
    );
    assert.equal(row.cleanupConfirmed, true);
    continue;
  }
  assert.equal(row.status, "fail");
  assert.equal(row.phase, "submit");
  assert.equal(row.cause, "test-defect");
  assert.deepEqual(row.submitted, {
    name: "",
    notes: "",
    accepted: false,
    choice: "alpha",
  });
  assert.equal(row.cleanupConfirmed, true);
}
assert.equal(report.cleanup.fixtureConfirmed, true);
assert.equal(report.cleanup.folderRemoved, true);
console.log(
  JSON.stringify({
    ok: true,
    check: filled
      ? "paired browser form preserves restricted values after actions"
      : "paired browser form rejects unfilled controls",
    engines: 2,
  }),
);
