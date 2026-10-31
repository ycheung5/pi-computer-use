// Windows-only process fixture; never accesses desktop input or clipboard.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

assert.equal(process.platform, "win32");
const folder = mkdtempSync(join(tmpdir(), "pi-cu-owner-crash-"));
let dispatched = false,
  settled = false;
try {
  const exe = join(folder, "crash-check.exe");
  const compiler = join(
    process.env.WINDIR,
    "Microsoft.NET",
    "Framework64",
    "v4.0.30319",
    "csc.exe",
  );
  const compile = spawnSync(
    compiler,
    [
      "/nologo",
      `/out:${exe}`,
      fileURLToPath(
        new URL("./owner-crash-boundary-fixture.cs", import.meta.url),
      ),
    ],
    { encoding: "utf8", windowsHide: true, timeout: 30000 },
  );
  assert.equal(compile.status, 0, compile.stdout + compile.stderr);
  dispatched = true;
  const run = spawnSync(exe, [folder], { encoding: "utf8", windowsHide: true });
  assert.equal(
    run.status,
    0,
    run.stdout + run.stderr + String(run.error ?? ""),
  );
  const report = JSON.parse(run.stdout.trim());
  assert.equal(report.supervisorCrashed, true);
  assert.equal(report.jobDescendantsExited, true);
  assert.equal(report.normalFinallyRan, true);
  assert.equal(report.workerFinallyRan, false);
  assert.equal(report.brokerOutsideJob, true);
  assert.equal(report.brokerSurvivedJobClosure, true);
  assert.equal(report.brokerCleanupConfirmed, true);
  assert.equal(report.lateWrites, false);
  settled = true;
  console.log(JSON.stringify(report));
} finally {
  if (!dispatched || settled) rmSync(folder, { recursive: true, force: true });
  else console.error(`Cleanup unconfirmed; workspace retained: ${folder}`);
}
