// Exercise the public benchmark CLI against its owned passive Windows fixture.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const referencePath = process.argv
  .slice(2)
  .find((arg) => !arg.startsWith("--"));
assert.ok(referencePath, "Pass the reference checkout path");
const run = promisify(execFile);
const stopCase = process.argv.includes("--stop");
let result;
try {
  result = await run(
    process.execPath,
    [
      fileURLToPath(new URL("./benchmark-reference.mjs", import.meta.url)),
      referencePath,
      "3",
      stopCase ? "--verify-stop-collection" : "--verify-failure-collection",
    ],
    { timeout: 240000, maxBuffer: 8 * 1024 * 1024 },
  );
} catch (error) {
  result = error;
}
const line = result.stdout
  ?.split(/\r?\n/)
  .find((item) => item.startsWith('{"ok":'));
assert.ok(line, `Expected structured benchmark report: ${result.stderr}`);
const report = JSON.parse(line);
assert.equal(report.ok, false, "The injected mismatch must not be hidden");
assert.equal(Number(result.code), 1, "Failed comparison must fail the CLI");
assert.equal(report.cases.length, 6);
assert.equal(report.cases[0].status, "fail");
assert.equal(report.cases[0].cause, "test-defect");
if (stopCase) {
  assert.match(report.cases[0].error, /CANCELLED: deliberate reference stop/);
  assert.equal(report.cases[0].referenceResult.isError, true);
  assert.equal(
    report.cases[0].referenceResult.content[1].text,
    "Stop requested by test fixture",
  );
  assert.equal(report.cases[0].actual, "initial");
  assert.ok(report.cases.slice(1).every((item) => item.status === "blocked"));
  assert.ok(
    report.cases.slice(1).every((item) => !item.timings && !item.initial),
  );
} else {
  assert.equal(report.cases[0].expected, "deliberate verification mismatch");
  assert.equal(report.cases[0].actual, "workflow-0");
  assert.ok(report.cases.slice(1).every((item) => item.status === "pass"));
  assert.ok(report.cases.every((item) => item.initial === "initial"));
}
assert.equal(report.cases[0].cleanup.confirmed, true);
assert.deepEqual(
  report.cases.map((item) => item.engine),
  ["reference", "pi", "pi", "reference", "reference", "pi"],
);
assert.equal(report.cleanup.fixtureConfirmed, true);
assert.equal(report.cleanup.folderRemoved, true);
console.log(
  JSON.stringify({
    ok: true,
    check: stopCase
      ? "comparison stop collection"
      : "comparison failure collection",
    cases: 6,
  }),
);
