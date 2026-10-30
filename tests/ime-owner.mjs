// No desktop input, clipboard, activation, or keyboard-layout changes.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

function report(observation) {
  assert.ok(
    Number.isSafeInteger(observation?.windowHwnd) && observation.windowHwnd > 0,
  );
  assert.ok(
    Number.isSafeInteger(observation.ownerThreadId) &&
      observation.ownerThreadId > 0,
  );
  assert.ok(
    Number.isSafeInteger(observation.observerThreadId) &&
      observation.observerThreadId > 0 &&
      observation.observerThreadId !== observation.ownerThreadId,
  );
  for (const sample of [observation.owner, observation.observer]) {
    assert.equal(typeof sample?.available, "boolean");
    assert.ok(sample.rawOpen === null || typeof sample.rawOpen === "boolean");
    assert.ok(sample.available || sample.rawOpen === null);
  }
  return {
    scope: "hidden-owned-window",
    inputSent: false,
    changesKeyboardLayout: false,
    focusedTargetImeState: "unknown",
    tsfState: "unknown",
    observation,
  };
}
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--list") {
  console.log(
    JSON.stringify({
      executed: false,
      scope: "hidden-owned-window",
      inputSent: false,
      changesKeyboardLayout: false,
    }),
  );
} else if (args.length === 1 && args[0].startsWith("--report=")) {
  const path = args[0].slice("--report=".length);
  assert.ok(path, "report path is required");
  console.log(JSON.stringify(report(JSON.parse(await readFile(path, "utf8")))));
} else {
  assert.deepEqual(
    args,
    ["--execute"],
    "Use --list, --report=PATH, or --execute",
  );
  assert.equal(process.platform, "win32", "Run --execute with Windows Node");
  const folder = await mkdtemp(join(tmpdir(), "pi-cu-ime-owner-"));
  try {
    const executable = join(folder, "fixture.exe");
    const compiler = join(
      process.env.WINDIR,
      "Microsoft.NET",
      "Framework64",
      "v4.0.30319",
      "csc.exe",
    );
    const built = spawnSync(
      compiler,
      [
        "/nologo",
        `/out:${executable}`,
        "/r:System.Windows.Forms.dll",
        "/r:System.Drawing.dll",
        "/r:System.Web.Extensions.dll",
        fileURLToPath(new URL("./ime-owner-fixture.cs", import.meta.url)),
      ],
      { encoding: "utf8", windowsHide: true, timeout: 10000, cwd: folder },
    );
    assert.equal(built.status, 0, built.stdout + built.stderr);
    const result = spawnSync(executable, [], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 15000,
      cwd: folder,
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    console.log(JSON.stringify(report(JSON.parse(result.stdout))));
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}
