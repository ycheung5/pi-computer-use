// Public worker seam; targets only the independently identified owned fixture.

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { WorkerClient } from "../dist/client.js";

assert.equal(process.platform, "win32");
const folder = await mkdtemp(join(tmpdir(), "pi-cu-lifetime-"));
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
    fileURLToPath(new URL("./accessibility-fixture.cs", import.meta.url)),
  ],
  { encoding: "utf8", windowsHide: true },
);
assert.equal(built.status, 0, built.stdout + built.stderr);
const fixture = spawn(
  executable,
  [`Owned lifetime ${Date.now()}`, "--lifetime"],
  { stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
);
const lines = createInterface({ input: fixture.stdout })[
  Symbol.asyncIterator
]();
const next = async () => JSON.parse((await lines.next()).value);
const receipts = [];
const output = process.argv
  .find((value) => value.startsWith("--output="))
  ?.slice(9);
const client = () =>
  new WorkerClient({
    launch: async () => ({
      executable: process.execPath,
      args: [fileURLToPath(new URL("../dist/worker.js", import.meta.url))],
    }),
  });
let worker = client();
const authorities = [];
const call = async (action, args) => {
  const start = performance.now();
  const result = await worker.execute(action, args);
  receipts.push({
    action,
    args,
    durationMs: performance.now() - start,
    result,
  });
  return result;
};
let ok = false;
try {
  const identity = await next();
  receipts.push({ fixture: identity });
  const target = { nativeWindowHandle: identity.hwnd, processId: identity.pid };
  const tree = await call("accessibility_tree", {
    ...target,
    maxDepth: 2,
    maxNodes: 30,
    activate: false,
  });
  assert.equal(tree.ok, true, JSON.stringify(tree));
  assert.equal(
    typeof tree.windowRef,
    "string",
    "owned observation must issue a lifetime reference",
  );
  assert.ok(tree.windowRef.length > 0);
  const again = await call("accessibility_tree", {
    windowRef: tree.windowRef,
    maxDepth: 0,
    activate: false,
  });
  assert.equal(again.ok, true, JSON.stringify(again));
  assert.equal(again.windowRef, tree.windowRef);
  const first = await call("find", {
    ...target,
    query: "Fixture action",
    ocrFallback: false,
  });
  assert.equal(first.matches.length, 1, JSON.stringify(first));
  const oldElement = first.matches[0].id;
  fixture.stdin.write("strip-markers\n");
  const removal = await next();
  receipts.push({ removal });
  assert.ok(removal.removed >= 1);
  for (const [action, extra] of [
    ["accessibility_tree", {}],
    ["screenshot", {}],
    ["snapshot", { includeScreenshot: false }],
    ["ocr", { query: "Fixture" }],
    ["move_window", { x: 40, y: 40 }],
    ["type_text", { text: "must not dispatch", method: "background" }],
    ["click", { x: 20, y: 20, dispatch: "background" }],
  ]) {
    const lost = await call(action, { windowRef: tree.windowRef, ...extra });
    assert.equal(lost.ok, false, action);
    assert.match(lost.error, /WINDOW_REFERENCE_LOST/, action);
  }
  const waiting = await call("wait_for", {
    windowRef: tree.windowRef,
    condition: "window",
    appear: false,
    timeoutMs: 100,
    intervalMs: 50,
  });
  assert.equal(
    waiting.verification,
    "inconclusive",
    "missing marker is not disappearance",
  );
  const fresh = await call("find", {
    ...target,
    query: "Fixture action",
    ocrFallback: false,
  });
  assert.equal(fresh.ok, true, JSON.stringify(fresh));
  const stale = await call("invoke", {
    elementId: oldElement,
    fallbackClick: false,
  });
  assert.equal(
    stale.ok,
    false,
    "a fresh observation must not overwrite an old element's lost root binding",
  );
  assert.match(
    stale.error,
    /STALE_ELEMENT|WINDOW_REFERENCE_LOST|STALE_WINDOW_REFERENCE/,
  );
  const conflict = await call("screenshot", {
    windowRef: fresh.windowRef,
    processId: identity.pid + 1,
  });
  assert.equal(conflict.ok, false);
  assert.match(conflict.error, /WINDOW_REFERENCE_CONFLICT/);
  assert.equal((await call("operation_end", {})).ok, true);
  const other = client();
  authorities.push(other);
  const foreign = await other.execute("accessibility_tree", {
    windowRef: fresh.windowRef,
    maxDepth: 0,
  });
  receipts.push({ foreign });
  assert.equal(foreign.ok, false);
  assert.match(foreign.error, /STALE_WINDOW_REFERENCE/);
  const second = await other.execute("accessibility_tree", {
    ...target,
    maxDepth: 0,
  });
  receipts.push({ second });
  assert.equal(second.ok, true);
  assert.notEqual(second.windowRef, fresh.windowRef);
  await other.dispose();
  const still = await call("accessibility_tree", {
    windowRef: fresh.windowRef,
    maxDepth: 0,
  });
  assert.equal(still.ok, true);
  const warm = [];
  for (let index = 0; index < 10; index++) {
    const start = performance.now();
    const result = await call("accessibility_tree", {
      windowRef: fresh.windowRef,
      maxDepth: 0,
    });
    assert.equal(result.ok, true);
    warm.push(performance.now() - start);
  }
  receipts.push({ warmMs: warm });
  fixture.stdin.write("replace\n");
  const replacement = await next();
  receipts.push({
    replacement,
    genuineReuse:
      replacement.hwnd === identity.hwnd && replacement.pid === identity.pid,
  });
  assert.equal(replacement.lifetime, 2);
  const ended = await call("accessibility_tree", {
    windowRef: fresh.windowRef,
    maxDepth: 0,
  });
  assert.equal(ended.ok, false);
  assert.match(ended.error, /WINDOW_REFERENCE_LOST|STALE_WINDOW_REFERENCE/);
  const current = await call("find", {
    nativeWindowHandle: replacement.hwnd,
    processId: replacement.pid,
    query: "Fixture action",
    ocrFallback: false,
  });
  assert.equal(current.ok, true);
  const oldIdAgain = await call("invoke", {
    elementId: fresh.matches[0].id,
    fallbackClick: false,
  });
  assert.equal(oldIdAgain.ok, false);
  await worker.dispose();
  worker = client();
  const restarted = await call("accessibility_tree", {
    windowRef: current.windowRef,
    maxDepth: 0,
  });
  assert.equal(restarted.ok, false);
  assert.match(restarted.error, /STALE_WINDOW_REFERENCE/);
  const renewed = await call("accessibility_tree", {
    nativeWindowHandle: replacement.hwnd,
    processId: replacement.pid,
    maxDepth: 0,
  });
  assert.equal(renewed.ok, true);
  assert.notEqual(renewed.windowRef, current.windowRef);
  ok = true;
} finally {
  await worker.dispose();
  for (const authority of authorities) await authority.dispose();
  if (fixture.exitCode === null) {
    fixture.stdin.end("stop\n");
    await once(fixture, "close");
  }
  await writeFile(
    join(folder, "receipts.json"),
    JSON.stringify({ ok, receipts }, null, 2),
  );
  console.log(JSON.stringify({ ok, folder }));
  if (output) {
    const hashes = await Promise.all(
      [
        "assets/window-marker.cs",
        "assets/window-references.cs",
        "assets/accessibility.cs",
        "src/worker.ts",
        "tests/native-window-lifetime.mjs",
      ].map(async (file) => [
        file,
        createHash("sha256")
          .update(await readFile(new URL(`../${file}`, import.meta.url)))
          .digest("hex"),
      ]),
    );
    await writeFile(
      output,
      JSON.stringify(
        { ok, receipts, sourceHashes: Object.fromEntries(hashes) },
        null,
        2,
      ),
    );
  }
  if (ok) await rm(folder, { recursive: true, force: true });
}
