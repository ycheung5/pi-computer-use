// Passive provider fixture: no activation, screenshots, mouse or keyboard input.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { WorkerClient } from "../dist/client.js";

assert.equal(process.platform, "win32");
const folder = await mkdtemp(join(tmpdir(), "pi-null-uia-"));
const framework = join(
  process.env.WINDIR,
  "Microsoft.NET",
  "Framework64",
  "v4.0.30319",
);
const exe = join(folder, "fixture.exe");
const refs = [
  "UIAutomationClient.dll",
  "UIAutomationProvider.dll",
  "UIAutomationTypes.dll",
  "WindowsBase.dll",
].map((name) => `/r:${join(framework, "WPF", name)}`);
const built = spawnSync(
  join(framework, "csc.exe"),
  [
    "/nologo",
    `/out:${exe}`,
    "/r:System.Windows.Forms.dll",
    ...refs,
    fileURLToPath(new URL("./nullable-uia-fixture.cs", import.meta.url)),
  ],
  { encoding: "utf8", cwd: folder, windowsHide: true },
);
assert.equal(built.status, 0, built.stdout + built.stderr);
const fixture = spawn(exe, [], {
  stdio: ["pipe", "pipe", "pipe"],
  cwd: folder,
  windowsHide: true,
});
const fixtureClosed = new Promise((resolve) => fixture.once("close", resolve));
const lines = createInterface({ input: fixture.stdout });
const hwnd = await new Promise((resolve, reject) => {
  const timer = setTimeout(
    () => reject(Error("fixture startup timeout")),
    10000,
  );
  lines.once("line", (line) => {
    clearTimeout(timer);
    resolve(Number(line));
  });
  fixture.once("error", reject);
});
const client = new WorkerClient({
  launch: async () => ({
    executable: process.execPath,
    args: [fileURLToPath(new URL("../dist/worker.js", import.meta.url))],
    cwd: folder,
  }),
});
try {
  const r = await client.execute("snapshot", {
    nativeWindowHandle: hwnd,
    processId: fixture.pid,
    includeScreenshot: false,
    activate: false,
  });
  console.log(
    JSON.stringify({
      ok: r.ok,
      nodes: r.nodeCount,
      tree: r.tree != null,
      error: r.error,
    }),
  );
  assert.equal(
    r.ok,
    true,
    "a newer/unknown control type must not discard the tree",
  );
  assert.ok(r.tree);
  const text = JSON.stringify(r.tree);
  assert.match(text, /Before custom provider/);
  assert.match(text, /After custom provider/);
  assert.match(text, /Newer UIA control/);
  const visit = (node) =>
    node.name === "Newer UIA control"
      ? node
      : (node.children ?? []).map(visit).find(Boolean);
  assert.equal(visit(r.tree)?.controlType, "Unknown");
  assert.equal(
    r.conclusive,
    false,
    "unknown role metadata must not prove absence",
  );
  const unknown = visit(r.tree);
  const inspected = await client.execute("element_info", {
    nativeWindowHandle: hwnd,
    processId: fixture.pid,
    elementId: unknown.id,
    detailLevel: "full",
  });
  assert.equal(inspected.ok, true, "unknown metadata is not a stale element");
  assert.equal(inspected.element.controlType, "Unknown");
  assert.equal(inspected.conclusive, false);
  const found = await client.execute("find", {
    nativeWindowHandle: hwnd,
    processId: fixture.pid,
    query: "After custom provider",
    ocrFallback: false,
  });
  assert.equal(found.ok, true);
  assert.ok(
    found.matches.some((node) => node.name === "After custom provider"),
    "traversal continues after unknown role",
  );
  const absent = await client.execute("wait_for", {
    nativeWindowHandle: hwnd,
    processId: fixture.pid,
    condition: "element",
    query: "Definitely absent",
    appear: false,
    timeoutMs: 300,
    intervalMs: 50,
  });
  assert.equal(
    absent.ok,
    false,
    "incomplete role metadata must not prove disappearance",
  );
  assert.equal(absent.verification, "inconclusive");
  console.log(
    JSON.stringify({
      ok: true,
      check: "nullable UIA metadata",
      inspection: true,
      continuedTraversal: true,
      absenceInconclusive: true,
      physicalInput: false,
    }),
  );
} finally {
  await client.dispose();
  fixture.stdin.end("\n");
  if (fixture.exitCode === null) fixture.kill();
  await fixtureClosed;
  lines.close();
  await rm(folder, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}
