// Dedicated process preflight only: calls health, then tests job retirement.
// Never use this supervisor to terminate a possible physical-input owner.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ownerWorkspace } from "./owner-supervisor-workspace.mjs";

assert.equal(process.platform, "win32");
const referencePath = process.argv[2];
assert.ok(referencePath, "Pass the pinned DSH checkout path");
const workspace = ownerWorkspace("pi-cu-backend-owner-");
const { folder } = workspace;
try {
  const exe = join(folder, "supervisor.exe");
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
      fileURLToPath(new URL("./owner-supervisor.cs", import.meta.url)),
    ],
    { encoding: "utf8", windowsHide: true, timeout: 30000 },
  );
  assert.equal(compile.status, 0, compile.stdout + compile.stderr);
  for (const engine of ["pi", "reference"]) {
    const report = workspace.run(exe, [
      "15000",
      process.execPath,
      fileURLToPath(new URL("./owner-backend-health.mjs", import.meta.url)),
      engine,
      folder,
      referencePath,
    ]);
    assert.equal(report.reason, "timeout");
    assert.equal(report.activeProcesses, 0);
    assert.ok(
      report.totalProcesses >= 2,
      "health must start at least one owned backend child",
    );
    const health = JSON.parse(
      readFileSync(join(folder, "health.json"), "utf8"),
    );
    assert.deepEqual(health, { engine, ok: true });
    console.log(JSON.stringify({ ...report, health, physicalInput: false }));
  }
} finally {
  workspace.cleanup();
}
