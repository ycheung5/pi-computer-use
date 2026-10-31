// Windows-only, read-only automation against dedicated passive fixture windows.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { WorkerClient } from "../dist/client.js";

assert.equal(process.platform, "win32", "Run with Windows Node after build");
const folder = await mkdtemp(join(tmpdir(), "pi-cu-window-fixture-"));
const executable = join(folder, "fixture.exe");
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
    "/target:exe",
    `/out:${executable}`,
    "/r:System.Windows.Forms.dll",
    "/r:System.Drawing.dll",
    fileURLToPath(new URL("./window-fixture.cs", import.meta.url)),
  ],
  { encoding: "utf8", windowsHide: true },
);
assert.equal(compile.status, 0, compile.stdout + compile.stderr);
const title = `Pi CU fixture ${Date.now()}`;
const fixture = spawn(executable, [title], {
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
});
await once(fixture.stdout, "data");
const worker = new WorkerClient({
  launch: async () => ({
    executable: process.execPath,
    args: [fileURLToPath(new URL("../dist/worker.js", import.meta.url))],
  }),
});
try {
  const result = await worker.execute("list_windows", { maxWindows: 200 });
  assert.equal(result.ok, true, JSON.stringify(result));
  const visible = result.windows.find((window) => window.name === title);
  assert.ok(visible, "visible fixture is listed");
  assert.equal(visible.processId, fixture.pid);
  assert.equal(visible.source, "win32");
  assert.equal(visible.responsive, true);
  assert.ok(visible.nativeWindowHandle > 0);
  assert.ok(visible.boundingBox.width > 0 && visible.boundingBox.height > 0);
  assert.equal(
    result.windows.some((window) => window.name === `${title} hidden`),
    false,
  );
  const all = await worker.execute("list_windows", {
    includeInvisible: true,
    maxWindows: 200,
  });
  const hidden = all.windows.find(
    (window) => window.name === `${title} hidden`,
  );
  assert.ok(hidden, "includeInvisible returns hidden fixture");
  assert.equal(hidden.isOffscreen, true);
  const again = all.windows.find((window) => window.name === title);
  assert.equal(again.nativeWindowHandle, visible.nativeWindowHandle);
  assert.equal(again.processId, visible.processId);
  const limited = await worker.execute("list_windows", { maxWindows: 1 });
  assert.equal(limited.windows.length, 1);
  assert.equal(limited.truncated, true);
  fixture.stdin.end("stop\n");
  await once(fixture, "close");
  const after = await worker.execute("list_windows", {
    includeInvisible: true,
    maxWindows: 200,
  });
  assert.equal(
    after.windows.some((window) => window.processId === visible.processId),
    false,
  );
  console.log(
    JSON.stringify({
      ok: true,
      check: "native window enumeration",
      visible: true,
      hidden: true,
      identity: true,
      disappearance: true,
      physicalInput: false,
    }),
  );
} finally {
  fixture.stdin.end();
  if (fixture.exitCode === null) fixture.kill();
  await worker.dispose();
  await rm(folder, { recursive: true, force: true });
}
