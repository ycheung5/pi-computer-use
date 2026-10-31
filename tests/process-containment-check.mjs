// No desktop, clipboard, or input APIs. This tests the test-only containment prerequisite.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

assert.equal(
  process.platform,
  "win32",
  "Windows process containment requires Windows",
);
const folder = mkdtempSync(join(tmpdir(), "pi-cu-owner-check-"));
try {
  const exe = join(folder, "owner-check.exe");
  const compiler = join(
    process.env.WINDIR,
    "Microsoft.NET",
    "Framework64",
    "v4.0.30319",
    "csc.exe",
  );
  const compiled = spawnSync(
    compiler,
    [
      "/nologo",
      `/out:${exe}`,
      fileURLToPath(
        new URL("./process-containment-fixture.cs", import.meta.url),
      ),
    ],
    { encoding: "utf8", windowsHide: true, timeout: 30000 },
  );
  assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
  const run = spawnSync(exe, [folder], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 15000,
  });
  assert.equal(
    run.status,
    0,
    run.stdout + run.stderr + String(run.error ?? ""),
  );
  const result = JSON.parse(run.stdout.trim());
  assert.equal(result.descendantsObserved, true);
  assert.equal(result.processesExited, true);
  assert.equal(result.lateWrite, false);
  console.log(JSON.stringify(result));
} finally {
  rmSync(folder, { recursive: true, force: true });
}
