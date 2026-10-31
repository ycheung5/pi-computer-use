// Locked-session refusal check, scoped only to its disposable fixture.
// Does not lock or unlock Windows; aborts if the initial lock refusal is absent.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { WorkerClient } from "../dist/client.js";

assert.equal(process.platform, "win32");
assert.equal(
  process.env.PI_CU_EXPECT_LOCKED_SESSION,
  "1",
  "Run only while Windows is deliberately locked, with PI_CU_EXPECT_LOCKED_SESSION=1",
);
const folder = await mkdtemp(join(tmpdir(), "pi-cu-locked-session-"));
const executable = join(folder, "fixture.exe");
const compiled = spawnSync(
  join(
    process.env.WINDIR,
    "Microsoft.NET",
    "Framework64",
    "v4.0.30319",
    "csc.exe",
  ),
  [
    "/nologo",
    `/out:${executable}`,
    "/r:System.Windows.Forms.dll",
    "/r:System.Drawing.dll",
    fileURLToPath(new URL("./text-fixture.cs", import.meta.url)),
  ],
  { encoding: "utf8", windowsHide: true },
);
assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
const fixture = spawn(executable, ["Pi locked-session disposable fixture"], {
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
  cwd: folder,
});
const closed = once(fixture, "close");
const [ready] = await once(fixture.stdout, "data");
const target = {
  nativeWindowHandle: Number(ready.toString().trim()),
  processId: fixture.pid,
};
const client = new WorkerClient({
  launch: async () => ({
    executable: process.execPath,
    args: [fileURLToPath(new URL("../dist/worker.js", import.meta.url))],
    cwd: folder,
  }),
});
try {
  const activated = await client.execute("activate_window", target);
  assert.equal(activated.ok, false, JSON.stringify(activated));
  assert.match(activated.error, /DESKTOP_SESSION_LOCKED/);
  const observed = await client.execute("snapshot", {
    ...target,
    activate: false,
    includeScreenshot: false,
    maxDepth: 0,
  });
  assert.equal(observed.ok, true, JSON.stringify(observed));
  const bounds = observed.tree.boundingBox;
  const moved = await client.execute("move", {
    ...target,
    x: Math.round(bounds.x + bounds.width / 2),
    y: Math.round(bounds.y + bounds.height / 2),
    activate: true,
  });
  assert.equal(moved.ok, false);
  assert.match(moved.error, /DESKTOP_SESSION_LOCKED/);
  assert.equal(moved.cleanupConfirmed, true);
  assert.equal(moved.pointer, "unchanged");
  const typed = await client.execute("type_text", {
    ...target,
    text: "MUST NOT APPEAR",
    method: "sendinput",
    activate: true,
  });
  assert.equal(typed.ok, false);
  assert.match(typed.error, /DESKTOP_SESSION_LOCKED/);
  assert.equal(typed.cleanupConfirmed, true);
  console.log(
    JSON.stringify({
      ok: true,
      lockedSession: true,
      activationRefused: true,
      pointerRefused: true,
      textRefused: true,
      quietObservation: true,
    }),
  );
} finally {
  await client.dispose();
  fixture.stdin.end("stop\n");
  await closed;
  await rm(folder, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}
