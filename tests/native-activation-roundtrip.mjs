// Opt-in activation and one native hover, confined to disposable fixture windows.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { WorkerClient } from "../dist/client.js";

assert.equal(process.platform, "win32");
assert.equal(
  process.env.PI_CU_ACTIVATION_TEST,
  "1",
  "Opt in with PI_CU_ACTIVATION_TEST=1 on an unlocked desktop; activates its own windows and moves the pointer once. Do not interact during the test.",
);
const folder = await mkdtemp(join(tmpdir(), "pi-cu-activation-roundtrip-"));
process.env.PI_CU_SETTINGS_FILE = join(folder, "settings.json");
await writeFile(
  process.env.PI_CU_SETTINGS_FILE,
  JSON.stringify({
    browserApp: "chrome",
    browserVisible: true,
    browserSignIn: false,
  }),
);
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
const fixture = spawn(executable, ["Pi activation roundtrip fixture"], {
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
  cwd: folder,
});
const closed = once(fixture, "close");
const [ready] = await once(fixture.stdout, "data");
const native = {
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
let prior, browserPid;
const listed = () => client.execute("list_windows", { maxWindows: 200 });
const identity = (window) => ({
  nativeWindowHandle: window.nativeWindowHandle,
  processId: window.processId,
});
const verifyForeground = async (target) => {
  const r = await listed();
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(
    r.windows.some(
      (w) =>
        w.nativeWindowHandle === target.nativeWindowHandle &&
        w.processId === target.processId &&
        w.hasKeyboardFocus,
    ),
    "independent enumeration must confirm foreground",
  );
};
try {
  const before = await listed();
  assert.equal(before.ok, true, JSON.stringify(before));
  prior = before.windows.find((w) => w.hasKeyboardFocus);
  const html =
    '<!doctype html><title>Pi activation Chrome fixture</title><script>window.moves=0</script><body style="margin:0;min-height:100vh" onmousemove="document.getElementById(\'status\').textContent=\'Moves: \'+(++window.moves)"><h1>Activation fixture</h1><p id="status">Moves: 0</p></body>';
  const opened = await client.execute("set_value", {
    elementId: "new-tab",
    value: `data:text/html,${encodeURIComponent(html)}`,
  });
  assert.equal(opened.ok, true, JSON.stringify(opened));
  const tab = opened.tab.id;
  const windows = await listed();
  assert.equal(windows.ok, true, JSON.stringify(windows));
  const browser = windows.browserLane.browsers.find((b) =>
    b.tabs.some((t) => t.id === tab),
  );
  assert.ok(browser);
  assert.equal(browser.app, "chrome");
  assert.equal(browser.headless, false);
  browserPid = browser.processId;
  const candidates = windows.windows.filter(
    (w) =>
      w.processId === browserPid &&
      w.name.includes("Pi activation Chrome fixture"),
  );
  assert.equal(candidates.length, 1);
  const chrome = identity(candidates[0]);
  let transitions = 0;
  for (let round = 0; round < 3; round++)
    for (const target of [native, chrome]) {
      const activated = await client.execute("activate_window", target);
      assert.equal(activated.activated, true, JSON.stringify(activated));
      await verifyForeground(target);
      transitions++;
    }
  const source = await client.execute("activate_window", native);
  assert.equal(source.activated, true, JSON.stringify(source));
  await verifyForeground(native);
  const snapshot = await client.execute("snapshot", {
    ...chrome,
    includeScreenshot: false,
    activate: false,
    maxDepth: 0,
  });
  assert.equal(snapshot.ok, true, JSON.stringify(snapshot));
  const box = snapshot.tree.boundingBox;
  const counter = async () => {
    const read = await client.execute("find", {
      browserTab: tab,
      query: "Moves:",
    });
    assert.equal(read.ok, true, JSON.stringify(read));
    const node = read.results.find((n) => /^Moves: \d+$/.test(n.name ?? ""));
    assert.ok(node, JSON.stringify(read));
    return Number(node.name.split(":")[1]);
  };
  const movesBefore = await counter();
  const cursorReply = once(fixture.stdout, "data");
  fixture.stdin.write("cursor-position\n");
  const cursor = (await cursorReply)[0]
    .toString()
    .trim()
    .split(",")
    .map(Number);
  assert.equal(cursor.length, 2);
  assert.ok(cursor.every(Number.isFinite));
  let point = {
    x: Math.round(box.x + box.width / 2),
    y: Math.round(box.y + box.height / 2),
  };
  if (Math.abs(cursor[0] - point.x) < 20 && Math.abs(cursor[1] - point.y) < 20)
    point = { x: point.x + 80, y: point.y + 50 };
  const moved = await client.execute("move", {
    ...chrome,
    x: point.x,
    y: point.y,
    activate: true,
  });
  assert.equal(moved.ok, true, JSON.stringify(moved));
  assert.equal(moved.cleanupConfirmed, true);
  await verifyForeground(chrome);
  const finalCursorReply = once(fixture.stdout, "data");
  fixture.stdin.write("cursor-position\n");
  const finalCursor = (await finalCursorReply)[0]
    .toString()
    .trim()
    .split(",")
    .map(Number);
  assert.deepEqual(
    finalCursor,
    [point.x, point.y],
    "native cursor must reach the requested physical point",
  );
  let movesAfter = movesBefore;
  for (let attempt = 0; attempt < 30; attempt++) {
    movesAfter = await counter();
    if (movesAfter > movesBefore) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(
    movesAfter > movesBefore,
    "native hover must produce an independently observed mouse movement",
  );
  console.log(
    JSON.stringify({
      ok: true,
      transitions: transitions,
      nativeHoverActivated: true,
      hoverObserved: true,
      movesBefore: movesBefore,
      movesAfter: movesAfter,
      noKeyboardOrClipboard: true,
    }),
  );
} finally {
  try {
    const current = await listed();
    const front = current.windows?.find((w) => w.hasKeyboardFocus);
    if (
      prior &&
      front &&
      (front.processId === fixture.pid || front.processId === browserPid)
    ) {
      const restored = await client.execute("activate_window", identity(prior));
      console.log(
        JSON.stringify({
          priorForegroundRestored: restored.activated === true,
        }),
      );
    }
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
}
