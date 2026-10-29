// Opt-in real input, scoped to newly created, uniquely named Notepad files.
// Never uses the clipboard, existing tabs' contents, or background-input fallback.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { WorkerClient } from "../dist/client.js";

assert.equal(process.platform, "win32", "Run with Windows Node after building");
assert.equal(
  process.env.PI_CU_NOTEPAD_INPUT_TEST,
  "1",
  "Opt in to Notepad foreground input with PI_CU_NOTEPAD_INPUT_TEST=1; do not interact during the test",
);
const folder = await mkdtemp(join(tmpdir(), "pi-cu-notepad-unicode-"));
const client = new WorkerClient({
  launch: async () => ({
    executable: process.execPath,
    args: [fileURLToPath(new URL("../dist/worker.js", import.meta.url))],
    cwd: folder,
  }),
});
const flatten = (node) =>
  node ? [node, ...(node.children ?? []).flatMap(flatten)] : [];
const observe = (target) =>
  client.execute("snapshot", {
    ...target,
    includeScreenshot: false,
    activate: false,
    detailLevel: "full",
    maxDepth: 8,
  });
const cases = ["Pi input check 中文 😀", "Abc 123 中文測試 café 😀 ".repeat(5)];
const retained = new Set();
try {
  for (const text of cases) {
    const path = join(folder, `pi-unicode-${randomUUID()}.txt`);
    const stem = basename(path, ".txt");
    await writeFile(path, "");
    const launched = await client.execute("launch_app", {
      target: "notepad.exe",
      arguments: `"${path}"`,
      waitMs: 1500,
    });
    assert.equal(launched.ok, true, JSON.stringify(launched));
    retained.add(path);
    let window;
    for (let attempt = 0; attempt < 30; attempt++) {
      const result = await client.execute("list_windows", {});
      window = result.windows?.find((item) => item.name.includes(stem));
      if (window) break;
      await delay(100);
    }
    assert.ok(window, "uniquely named Notepad test file must be open");
    const target = {
      nativeWindowHandle: window.nativeWindowHandle,
      processId: window.processId,
    };
    const before = await observe(target);
    assert.equal(before.ok, true, JSON.stringify(before));
    const editors = flatten(before.tree).filter(
      (node) => node.controlType === "Document",
    );
    assert.equal(editors.length, 1, "require one unambiguous test editor");
    assert.ok(!editors[0].value, "new test file must be blank");
    const activated = await client.execute("activate_window", target);
    assert.equal(activated.activated, true, JSON.stringify(activated));
    const focused = await client.execute("focus", {
      ...target,
      elementId: editors[0].id,
    });
    assert.equal(focused.ok, true, JSON.stringify(focused));
    const typed = await client.execute("type_text", {
      ...target,
      text,
      method: "sendinput",
      activate: true,
    });
    assert.equal(typed.ok, true, JSON.stringify(typed));
    assert.equal(typed.cleanupConfirmed, true);
    assert.equal(typed.method, "sendinput-unicode");
    // Let the application process its queued character messages before reading.
    await delay(1000);
    const after = await client.execute("element_info", {
      ...target,
      elementId: editors[0].id,
      detailLevel: "full",
    });
    assert.equal(after.ok, true, JSON.stringify(after));
    const actual = after.element.value;
    // Save ONLY this uniquely named test file to independently verify actual bytes.
    const current = await observe(target);
    assert.ok(
      current.tree?.name.includes(stem),
      "tab identity must still match before save",
    );
    const saved = await client.execute("keypress", {
      ...target,
      keys: ["Ctrl", "s"],
    });
    assert.equal(saved.ok, true, JSON.stringify(saved));
    let disk;
    for (let attempt = 0; attempt < 30; attempt++) {
      disk = await readFile(path, "utf8");
      if (disk === actual) break;
      await delay(100);
    }
    assert.equal(disk, actual, "saved bytes must independently agree with UIA");
    const savedView = await observe(target);
    assert.ok(
      savedView.tree?.name.includes(stem),
      "tab identity must still match before close",
    );
    const closed = await client.execute("keypress", {
      ...target,
      keys: ["Ctrl", "w"],
    });
    assert.equal(closed.ok, true, JSON.stringify(closed));
    let remains = true;
    for (let attempt = 0; attempt < 30; attempt++) {
      const listed = await client.execute("list_windows", {});
      const original = listed.windows?.find(
        (item) =>
          item.nativeWindowHandle === target.nativeWindowHandle &&
          item.processId === target.processId,
      );
      if (!original) {
        remains = false;
        break;
      }
      const snapshot = await observe(target);
      if (
        snapshot.ok &&
        !snapshot.truncated &&
        !flatten(snapshot.tree).some((node) => node.name?.includes(stem))
      ) {
        remains = false;
        break;
      }
      await delay(100);
    }
    assert.equal(
      remains,
      false,
      "confirm test tab closure before deleting its file",
    );
    retained.delete(path);
    assert.equal(
      actual,
      text,
      "Notepad must receive every requested Unicode character exactly once",
    );
    assert.equal(disk, text);
    console.log(
      JSON.stringify({
        ok: true,
        check: "Notepad Unicode",
        utf16Units: text.length,
        accessibleValue: true,
        savedBytes: true,
      }),
    );
  }
} finally {
  await client.dispose();
  if (retained.size === 0) await rm(folder, { recursive: true, force: true });
  else
    console.error(
      `Retained test files/tabs after an uncertain action: ${folder}`,
    );
}
