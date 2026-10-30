// No desktop or clipboard APIs: verify timeout settlement of synthetic descendants.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

if (process.argv[2] === "--synthetic") {
  const folder = process.argv[3];
  if (process.argv[4] !== "descendant") {
    spawn(
      process.execPath,
      [fileURLToPath(import.meta.url), "--synthetic", folder, "descendant"],
      { stdio: "ignore", windowsHide: true },
    );
  } else writeFileSync(join(folder, "ready"), "ready");
  setTimeout(
    () =>
      writeFileSync(
        join(
          folder,
          process.argv[4] === "descendant" ? "late-descendant" : "late-parent",
        ),
        "late",
      ),
    4000,
  );
} else {
  assert.equal(process.platform, "win32");
  const folder = mkdtempSync(join(tmpdir(), "pi-cu-owner-supervisor-"));
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
    const run = spawnSync(
      exe,
      [
        "2000",
        process.execPath,
        fileURLToPath(import.meta.url),
        "--synthetic",
        folder,
      ],
      { encoding: "utf8", windowsHide: true, timeout: 12000 },
    );
    assert.equal(
      run.status,
      0,
      run.stdout + run.stderr + String(run.error ?? ""),
    );
    const result = JSON.parse(run.stdout.trim());
    assert.equal(result.reason, "timeout");
    assert.equal(result.activeProcesses, 0);
    assert.ok(
      result.totalProcesses >= 2,
      "job accounted for both synthetic processes",
    );
    assert.equal(
      existsSync(join(folder, "ready")),
      true,
      "descendant started before timeout",
    );
    await new Promise((resolve) => setTimeout(resolve, 4500));
    assert.equal(existsSync(join(folder, "late-parent")), false);
    assert.equal(existsSync(join(folder, "late-descendant")), false);
    console.log(
      JSON.stringify({ ...result, descendantStarted: true, lateWrites: false }),
    );
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}
