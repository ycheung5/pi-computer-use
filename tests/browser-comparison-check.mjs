// Verify public paired-runner failure or post-action preservation evidence in both engines.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

assert.ok(process.argv[2], "Pass the reference checkout path");
const profiles = process.argv.includes("--profiles");
const advanced = process.argv.includes("--advanced");
const filled = process.argv.includes("--filled");
if (process.argv.includes("--verify-profile-interruptions")) {
  const reports = [];
  for (const kind of ["stop", "cancel", "cleanup", "abort", "cleanup-result"]) {
    let execution;
    try {
      execution = await promisify(execFile)(
        process.execPath,
        [
          fileURLToPath(new URL("./browser-comparison.mjs", import.meta.url)),
          process.argv[2],
          process.argv[3] ?? "edge",
          "1",
          "--profiles",
          "--profile-interruption",
          kind,
        ],
        { timeout: 240000, maxBuffer: 8 * 1024 * 1024 },
      );
    } catch (error) {
      execution = error;
    }
    assert.equal(execution.code, 1);
    const line = execution.stdout
      ?.split(/\r?\n/)
      .find((x) => x.startsWith('{"diagnosticInjection":'));
    assert.ok(line, execution.stderr);
    const report = JSON.parse(line);
    assert.equal(report.diagnosticInjection, true);
    assert.equal(report.ok, false);
    assert.equal(report.cases[0].diagnosticInterruption.kind, kind);
    assert.equal(
      report.cases[0].diagnosticInterruption.postFaultControllerAttempts,
      0,
      JSON.stringify(report),
    );
    if (kind === "cleanup-result")
      assert.equal(report.cases[0].toolResult.cleanupConfirmed, false);
    else
      assert.match(
        report.cases[0].error,
        /COMPUTER_USE_(?:STOPPED|CANCELLED)|INPUT_CLEANUP_UNCONFIRMED|AbortError/,
      );
    assert.equal(report.cases[0].halted, true);
    assert.ok(report.cases[0].profile.restart.interrupted);
    assert.equal(report.cases[0].profile.temporary, undefined);
    assert.equal(report.cases[1].status, "blocked", JSON.stringify(report));
    assert.equal(report.cleanup.folderRemoved, true);
    reports.push({ kind, report });
  }
  console.log(
    JSON.stringify({
      ok: true,
      diagnosticInjection: true,
      check: "profile interruptions block later browser work",
      reports,
    }),
  );
  process.exit(0);
}
if (process.argv.includes("--verify-restart-gaps")) {
  const reportIndex = process.argv.indexOf("--report");
  assert.ok(
    reportIndex >= 0,
    "Pass a saved paired profile report with --report",
  );
  const source = JSON.parse(
    await readFile(process.argv[reportIndex + 1], "utf8"),
  );
  const folder = await mkdtemp(
    join(tmpdir(), "pi-profile-restart-diagnostic-"),
  );
  const rejected = [];
  try {
    for (const mutation of [
      "alive-root",
      "same-root",
      "inconsistent-root-flag",
    ]) {
      const fixture = structuredClone(source);
      fixture.diagnosticInjection = true;
      for (const row of fixture.cases) {
        row.profile.cookiePersisted = true;
        row.profile.restart.oldRootExitedBeforeReconnect =
          mutation !== "alive-root";
        if (mutation !== "alive-root")
          row.profile.restart.newProcessId = row.profile.restart.oldProcessId;
        row.profile.restart.differentRoot = mutation !== "same-root";
      }
      const path = join(folder, `${mutation}.json`);
      await writeFile(path, JSON.stringify(fixture));
      let output;
      try {
        output = await promisify(execFile)(process.execPath, [
          fileURLToPath(import.meta.url),
          "stored-profile-report",
          "edge",
          "--profiles",
          "--report",
          path,
          "--exit-code",
          fixture.ok ? "0" : "1",
        ]);
      } catch (error) {
        output = error;
      }
      assert.equal(
        output.code,
        1,
        `${mutation} must not pass the public report checker`,
      );
      assert.match(
        output.stderr,
        /Durable browser restart|restarted browser cannot reuse/,
      );
      rejected.push(mutation);
    }
    const truthful = structuredClone(source);
    truthful.ok = false;
    truthful.diagnosticInjection = true;
    for (const row of truthful.cases) {
      row.profile.cookiePersisted = false;
      row.profile.restart.oldRootExitedBeforeReconnect = false;
      row.profile.restart.differentRoot = false;
      row.profile.restart.newProcessId = row.profile.restart.oldProcessId;
      row.findings ??= [];
      row.findings.push({
        phase: "kept profile restart",
        error: "Diagnostic unmet restart prerequisite",
      });
      row.status = "fail";
      for (const step of row.steps)
        if (step.phase === "kept synthetic cookie restart and live ownership")
          step.status = "fail";
    }
    const truthfulPath = join(folder, "truthful-restart-finding.json");
    await writeFile(truthfulPath, JSON.stringify(truthful));
    await promisify(execFile)(process.execPath, [
      fileURLToPath(import.meta.url),
      "stored-profile-report",
      "edge",
      "--profiles",
      "--report",
      truthfulPath,
      "--exit-code",
      "1",
    ]);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
  console.log(
    JSON.stringify({
      ok: true,
      diagnosticInjection: true,
      check: "profile restart false claims rejected",
      rejected,
      truthfulNonpassingFindingRetained: true,
    }),
  );
  process.exit(0);
}
let result;
try {
  const reportIndex = process.argv.indexOf("--report");
  if (reportIndex >= 0) {
    const exitIndex = process.argv.indexOf("--exit-code");
    assert.ok(
      exitIndex >= 0,
      "Stored report replay requires the recorded --exit-code",
    );
    const code = Number(process.argv[exitIndex + 1]);
    assert.ok(code === 0 || code === 1);
    result = {
      stdout: await readFile(process.argv[reportIndex + 1], "utf8"),
      code,
    };
  } else
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
    assert.ok(Number.isSafeInteger(row.profile.restart.oldProcessId));
    assert.equal(row.profile.ownershipAfterDetach.originalTabReadable, true);
    assert.equal(row.profile.ownershipAfterDetach.rootAlive, true);
    assert.equal(
      row.profile.ownershipAfterDetach.processId,
      row.profile.restart.oldProcessId,
    );
    if (row.profile.cookiePersisted) {
      assert.equal(row.profile.cookiePersisted, true);
      assert.ok(Number.isSafeInteger(row.profile.restart.newProcessId));
      assert.equal(
        row.profile.restart.oldRootExitedBeforeReconnect,
        true,
        "Durable browser restart requires observed exit before reconnect",
      );
      assert.equal(
        row.profile.restart.differentRoot,
        true,
        "Durable browser restart requires a different root",
      );
      assert.notEqual(
        row.profile.restart.newProcessId,
        row.profile.restart.oldProcessId,
        "A restarted browser cannot reuse the observed old root PID",
      );
    } else {
      assert.equal(row.profile.cookiePersisted, false);
      assert.ok(row.findings?.some((x) => x.phase === "kept profile restart"));
      assert.equal(row.status, "fail");
      assert.ok(
        !row.steps.some(
          (x) =>
            x.phase === "kept synthetic cookie restart and live ownership" &&
            x.status === "pass",
        ),
      );
    }
    assert.equal(row.profile.temporary.cookieInitiallyMissing, true);
    assert.equal(row.profile.temporary.cookieIsolatedOnRestart, true);
    assert.equal(row.profile.temporary.browserAliveAfterControllerExit, false);
    assert.equal(row.cleanupConfirmed, true);
    if (!row.profile.temporary.removedBeforeRunnerCleanup)
      assert.ok(row.findings.some((x) => x.phase === "temporary cleanup"));
    assert.equal(row.status, row.findings?.length ? "fail" : "pass");
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
