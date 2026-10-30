// Verify public paired-runner failure or post-action preservation evidence in both engines.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

assert.ok(process.argv[2], "Pass the reference checkout path");
const profiles = process.argv.includes("--profiles");
const advanced = process.argv.includes("--advanced");
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
      ...(profiles
        ? ["--profiles"]
        : advanced
          ? ["--advanced"]
          : filled
            ? []
            : ["--verify-unfilled"]),
    ],
    { timeout: 240000, maxBuffer: 8 * 1024 * 1024 },
  );
} catch (error) {
  result = error;
}
const line = result.stdout
  ?.split(/\r?\n/)
  .find((value) => value.startsWith('{"diagnosticInjection":'));
assert.ok(line, `Missing comparison report: ${result.stderr}`);
const report = JSON.parse(line);
assert.equal(
  result.code ?? 0,
  profiles ? (report.ok ? 0 : 1) : advanced || filled ? 0 : 1,
  "CLI status must match the outcome",
);
if (profiles) {
  assert.equal(report.mode, "profiles");
  assert.equal(report.cases.length, 2);
  for (const row of report.cases) {
    assert.equal(row.profile.cookiePersisted, true);
    assert.ok(Number.isSafeInteger(row.profile.restart.oldProcessId));
    assert.ok(Number.isSafeInteger(row.profile.restart.newProcessId));
    assert.equal(
      typeof row.profile.restart.oldRootExitedBeforeReconnect,
      "boolean",
    );
    assert.equal(row.profile.temporary.cookieInitiallyMissing, true);
    assert.equal(row.profile.temporary.cookieIsolatedOnRestart, true);
    assert.equal(row.profile.temporary.browserAliveAfterControllerExit, false);
    assert.equal(row.cleanupConfirmed, true);
    if (row.profile.temporary.removedBeforeRunnerCleanup) {
      assert.equal(row.status, "pass");
      assert.ok(!row.findings?.length);
    } else {
      assert.equal(row.status, "fail");
      assert.ok(row.findings.some((x) => x.phase === "temporary cleanup"));
    }
  }
  assert.equal(report.cleanup.folderRemoved, true);
  console.log(
    JSON.stringify({
      ok: true,
      check: "paired profile findings and outcomes retained",
      outcomes: report.cases.map((x) => ({
        engine: x.engine,
        status: x.status,
        findings: x.findings ?? [],
      })),
    }),
  );
  process.exit(0);
}
if (advanced) {
  assert.equal(report.mode, "advanced");
  assert.equal(report.cases.length, 2);
  for (const row of report.cases) {
    assert.equal(row.status, "pass", JSON.stringify(row));
    assert.equal(row.uploadRequests, 1);
    assert.equal(row.upload.content, "upload fixture only");
    assert.equal(row.download.content, "download fixture only");
    assert.equal(row.dialog.prompt, "fixture answer 中文");
    assert.equal(row.closedTabRejected, true);
    assert.equal(row.navigationStaleRejected, true);
    assert.equal(row.reconnect.oldTabRejected, true);
    assert.equal(row.cleanupConfirmed, true);
  }
  assert.equal(report.cleanup.folderRemoved, true);
  console.log(
    JSON.stringify({
      ok: true,
      check: "paired advanced browser public outcomes",
    }),
  );
  process.exit(0);
}
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
