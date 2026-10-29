// Live host test; creates disposable package copies, never sends desktop input.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

assert.equal(process.platform, "linux", "Run this check from WSL2");
const run = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
const encoded = Buffer.from(
  "[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); [Console]::Write($env:TEMP)",
  "utf16le",
).toString("base64");
const windows = await run("powershell.exe", [
  "-NoLogo",
  "-NoProfile",
  "-NonInteractive",
  "-EncodedCommand",
  encoded,
]);
const mounted = (
  await run("wslpath", ["-u", windows.stdout.trim()])
).stdout.trim();
const roots = [];
try {
  for (const base of [tmpdir(), mounted]) {
    const directory = await mkdtemp(join(base, "pi-cu WSL 測試 ' "));
    roots.push(directory);
    await cp(join(root, "dist"), join(directory, "dist"), { recursive: true });
    await cp(join(root, "package.json"), join(directory, "package.json"));
    await mkdir(join(directory, "tests"));
    for (const name of ["wsl-host.mjs", "native-host.mjs"])
      await cp(join(root, "tests", name), join(directory, "tests", name));
    await symlink(
      join(root, "node_modules"),
      join(directory, "node_modules"),
      "dir",
    );
    const smoke = join(directory, "tests", "wsl-host.mjs");
    const result = await run(process.execPath, [smoke], {
      timeout: 180_000,
      maxBuffer: 1024 * 1024,
    });
    const evidence = JSON.parse(result.stdout.trim());
    assert.equal(evidence.ok, true);
    assert.equal(evidence.activeCancellation, true);
    assert.equal(evidence.timeoutCleanup, true);
    const exited = await run(process.execPath, [smoke, "--parent-exit"], {
      timeout: 30_000,
    });
    const workerPid = JSON.parse(exited.stdout.trim()).workerPid;
    const deadline = Date.now() + 5000;
    for (;;) {
      try {
        const script = `if(Get-Process -Id ${workerPid} -ErrorAction SilentlyContinue){exit 1}; exit 0`;
        await run("powershell.exe", [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-EncodedCommand",
          Buffer.from(script, "utf16le").toString("base64"),
        ]);
        break;
      } catch (error) {
        if (Date.now() >= deadline)
          throw new Error(`Worker ${workerPid} survived parent exit`, {
            cause: error,
          });
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    console.log(
      JSON.stringify({
        ok: true,
        install: base === tmpdir() ? "WSL filesystem" : "Windows filesystem",
        spacesUnicodeQuotes: true,
        parentExit: true,
        activeCancellation: true,
        timeoutCleanup: true,
      }),
    );
  }
} finally {
  for (const directory of roots)
    await rm(directory, { recursive: true, force: true });
}
