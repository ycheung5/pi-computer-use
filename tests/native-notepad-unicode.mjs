// Opt-in real input, scoped to newly created, uniquely named Notepad files.
// Never uses the clipboard, existing tabs' contents, or background-input fallback.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createComparisonClient } from "./comparison-client.mjs";

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
const normalize = (text) => text.replace(/\r\n?|\n/g, "\n");
const cases = [
  { seed: "x", text: "\n" },
  { seed: "", text: " \t " },
  {
    seed: "Reuse test\n中文測試 café 😀",
    text: "\nSendInput check: 中文測試 café 😀",
  },
  { seed: "", text: "Pi input check 中文 😀" },
  { seed: "", text: "Abc 123 中文測試 café 😀 ".repeat(5) },
  { seed: "", text: "LF\nCR\rCRLF\r\nTab\tend 😀" },
];
const option = (name) =>
  process.argv
    .slice(2)
    .find((arg) => arg.startsWith(`--${name}=`))
    ?.slice(name.length + 3);
const engine = option("engine") ?? "pi";
assert.ok(
  ["pi", "reference"].includes(engine),
  "engine must be pi or reference",
);
if (process.argv.includes("--list")) {
  console.log(
    JSON.stringify({
      engine,
      executed: false,
      requestedMethod: "sendinput",
      cases: cases.map(({ seed, text }, index) => ({
        id: index + 1,
        seed,
        text,
        expected: normalize(seed + text),
      })),
    }),
  );
  process.exit(0);
}
assert.equal(
  process.env.PI_CU_NOTEPAD_INPUT_TEST,
  "1",
  "Opt in on a dedicated idle desktop with PI_CU_NOTEPAD_INPUT_TEST=1; physical runs are currently deferred",
);
assert.equal(process.platform, "win32", "Run with Windows Node after building");
const folder = await mkdtemp(join(tmpdir(), "pi-cu-notepad-unicode-"));
let client;
const retained = new Set();
try {
  client = await createComparisonClient({
    engine,
    referencePath: option("reference"),
    cwd: folder,
  });
  for (const [caseIndex, { seed, text }] of cases.entries()) {
    const started = performance.now();
    let typed;
    let dispatchMs;
    let actual;
    let disk;
    let failure;
    const expected = normalize(seed + text);
    try {
      const path = join(folder, `pi-unicode-${randomUUID()}.txt`);
      const stem = basename(path, ".txt");
      await writeFile(path, seed);
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
      assert.equal(
        normalize(editors[0].value ?? ""),
        normalize(seed),
        "test file must contain only its known seed",
      );
      const activated = await client.execute("activate_window", target);
      assert.equal(activated.activated, true, JSON.stringify(activated));
      const focused = await client.execute("focus", {
        ...target,
        elementId: editors[0].id,
      });
      assert.equal(focused.ok, true, JSON.stringify(focused));
      if (seed) {
        const end = await client.execute("keypress", {
          ...target,
          keys: ["Ctrl", "End"],
        });
        assert.equal(end.ok, true, JSON.stringify(end));
      }
      const dispatchStarted = performance.now();
      typed = await client.execute("type_text", {
        ...target,
        text,
        method: "sendinput",
        activate: true,
      });
      dispatchMs = performance.now() - dispatchStarted;
      assert.equal(typed.ok, true, JSON.stringify(typed));
      if (typed.cleanupConfirmed !== undefined)
        assert.equal(typed.cleanupConfirmed, true);
      // Let the application process its queued character messages before reading.
      await delay(1000);
      const after = await client.execute("element_info", {
        ...target,
        elementId: editors[0].id,
        detailLevel: "full",
      });
      assert.equal(after.ok, true, JSON.stringify(after));
      actual = normalize(after.element.value);
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
      for (let attempt = 0; attempt < 30; attempt++) {
        disk = await readFile(path, "utf8");
        if (normalize(disk) === actual) break;
        await delay(100);
      }
      assert.equal(
        normalize(disk),
        actual,
        "saved bytes must independently agree with UIA",
      );
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
        expected,
        "Notepad must receive every requested Unicode character exactly once",
      );
      assert.equal(normalize(disk), expected);
    } catch (error) {
      failure = { message: error.message, rpcError: error.rpcError };
      throw error;
    } finally {
      console.log(
        JSON.stringify({
          engine,
          case: caseIndex + 1,
          ok: !failure,
          seed,
          text,
          expected,
          actual,
          savedText: disk === undefined ? undefined : normalize(disk),
          elapsedMs: performance.now() - started,
          requestedMethod: "sendinput",
          dispatch: typed,
          dispatchMs,
          ownedCleanupConfirmed: !retained.size,
          failure,
        }),
      );
    }
  }
} finally {
  await client?.dispose();
  if (retained.size === 0) await rm(folder, { recursive: true, force: true });
  else
    console.error(
      `Retained test files/tabs after an uncertain action: ${folder}`,
    );
}
