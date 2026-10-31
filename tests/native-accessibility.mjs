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
    fileURLToPath(new URL("./accessibility-fixture.cs", import.meta.url)),
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
const alternate = spawn(executable, [`${title} alternate`], {
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
});
await once(alternate.stdout, "data");
const worker = new WorkerClient({
  launch: async () => ({
    executable: process.execPath,
    args: [fileURLToPath(new URL("../dist/worker.js", import.meta.url))],
  }),
});
try {
  const windows = await worker.execute("list_windows", { maxWindows: 200 });
  assert.equal(windows.ok, true, JSON.stringify(windows));
  const target = windows.windows.find((window) => window.name === title);
  assert.ok(target);
  const args = {
    nativeWindowHandle: target.nativeWindowHandle,
    processId: target.processId,
  };
  const ambiguous = await worker.execute("accessibility_tree", {
    windowTitle: title,
  });
  assert.equal(ambiguous.ok, false);
  assert.match(ambiguous.error, /AMBIGUOUS_TARGET/);
  const missing = await worker.execute("accessibility_tree", {
    windowTitle: `absent-${title}`,
  });
  assert.equal(missing.ok, false);
  assert.match(missing.error, /TARGET_NOT_FOUND/);
  const tree = await worker.execute("accessibility_tree", {
    ...args,
    detailLevel: "full",
  });
  assert.equal(tree.ok, true, JSON.stringify(tree));
  assert.ok(tree.tree);
  const text = JSON.stringify(tree);
  assert.match(text, /Fixture editor/);
  assert.match(text, /hello accessible world/);
  assert.doesNotMatch(text, /must-not-leak/);
  const found = await worker.execute("find", {
    ...args,
    query: "Fixture action",
    ocrFallback: false,
  });
  assert.equal(found.ok, true, JSON.stringify(found));
  assert.equal(found.matches.length, 1);
  const id = found.matches[0].id;
  const info = await worker.execute("element_info", {
    ...args,
    elementId: id,
    detailLevel: "full",
  });
  assert.equal(info.ok, true, JSON.stringify(info));
  assert.equal(info.element.name, "Fixture action");
  const bounded = await worker.execute("accessibility_tree", {
    ...args,
    maxNodes: 1,
  });
  assert.equal(bounded.truncated, true);
  assert.equal(bounded.truncationReason, "maxNodes");
  const depth = await worker.execute("accessibility_tree", {
    ...args,
    maxDepth: 0,
  });
  assert.equal(depth.truncated, true);
  const wrong = await worker.execute("element_info", {
    ...args,
    processId: target.processId + 1,
    elementId: id,
  });
  assert.equal(wrong.ok, false);
  assert.match(wrong.error, /identity|owner|target/i);
  const unseen = await worker.execute("element_info", {
    ...args,
    elementId: "uia:rt:999-888-777",
  });
  assert.equal(unseen.ok, false);
  assert.match(unseen.error, /stale|observ/i);
  const removed = once(fixture.stdout, "data");
  fixture.stdin.write("remove\n");
  await removed;
  const stale = await worker.execute("element_info", {
    ...args,
    elementId: id,
  });
  assert.equal(stale.ok, false, JSON.stringify(stale));
  console.log(
    JSON.stringify({
      ok: true,
      check: "native accessibility",
      tree: true,
      find: true,
      identity: true,
      passwordProtected: true,
      truncation: true,
      stale: true,
      physicalInput: false,
    }),
  );
} finally {
  alternate.stdin.end("stop\n");
  if (alternate.exitCode === null) alternate.kill();
  fixture.stdin.end();
  if (fixture.exitCode === null) fixture.kill();
  await worker.dispose();
  await rm(folder, { recursive: true, force: true });
}
