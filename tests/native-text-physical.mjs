// Opt-in dedicated-desktop checks: sends real keys and replaces clipboard content. Read docs/text.md first.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import computerUse from "../dist/extension.js";
import { nativeDesktop } from "../dist/native.js";
import { computerUseHost } from "./native-host.mjs";

assert.equal(process.platform, "win32");
assert.equal(
  process.env.PI_CU_DEDICATED_INPUT_DESKTOP,
  "1",
  "Dedicated interactive desktop required; this runner replaces clipboard content and sends keys.",
);
const folder = await mkdtemp(join(tmpdir(), "pi-cu-controls-"));
const executable = join(folder, "fixture.exe");
process.env.PI_CU_SETTINGS_FILE = join(folder, "settings.json");
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
    "/target:exe",
    `/out:${executable}`,
    "/r:System.Windows.Forms.dll",
    "/r:System.Drawing.dll",
    fileURLToPath(new URL("./text-fixture.cs", import.meta.url)),
  ],
  { encoding: "utf8", cwd: folder, windowsHide: true },
);
assert.equal(built.status, 0, built.stdout + built.stderr);
const fixture = spawn(executable, [`Pi CU Controls ${Date.now()}`], {
  stdio: ["pipe", "pipe", "pipe"],
  cwd: folder,
  windowsHide: true,
});
const [ready] = await once(fixture.stdout, "data");
const target = {
  nativeWindowHandle: Number(ready.toString().trim()),
  processId: fixture.pid,
};
const host = computerUseHost();
computerUse(host.api);
const call = async (action, args = {}) => {
  const tool = host.tools.get(`windows_computer_use_${action}`);
  assert.ok(tool, `Pi registers ${action}`);
  return (
    await tool.execute(action, { ...target, ...args }, undefined, undefined, {})
  ).details;
};
const find = async (query, controlType) => {
  const result = await call("find", { query, controlType, ocrFallback: false });
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.matches;
};
const command = async (text) => {
  const reply = once(fixture.stdout, "data");
  fixture.stdin.write(`${text}\n`);
  return (await reply)[0].toString().trim();
};
try {
  const edit = (await find("Background editor", "Edit"))[0];
  await call("set_value", { elementId: edit.id, value: "" });
  assert.equal(await command("clipboard-seed"), "clipboard-seeded");
  const pasted = await call("type_text", {
    text: "Clipboard Unicode 測試 🙂",
    method: "clipboard",
    focusMode: "main",
  });
  assert.equal(pasted.ok, true, JSON.stringify(pasted));
  assert.equal(pasted.clipboardCleanupConfirmed, true);
  assert.equal(
    await command("clipboard-check"),
    "clipboard-restored",
    "Unicode/HTML/DIB/custom bytes restored",
  );
  const afterPaste = await call("element_info", {
    elementId: edit.id,
    detailLevel: "full",
  });
  assert.match(afterPaste.element.value, /Clipboard Unicode 測試 🙂/);
  const chord = await call("keypress", { keys: ["Ctrl", "A"] });
  assert.equal(chord.ok, true, JSON.stringify(chord));
  const unicode = await call("type_text", {
    text: "Synthetic 測試 🙂",
    method: "sendinput",
  });
  assert.equal(unicode.ok, true, JSON.stringify(unicode));
  const afterUnicode = await call("element_info", {
    elementId: edit.id,
    detailLevel: "full",
  });
  assert.equal(afterUnicode.element.value, "Synthetic 測試 🙂");
  await call("set_value", { elementId: edit.id, value: "" });
  await call("focus", { elementId: edit.id });
  assert.equal(await command("notify-text"), "armed");
  const controller = new AbortController();
  let timer;
  const seen = new Promise((resolve, reject) => {
    const receive = (chunk) => {
      if (chunk.toString().includes("typed")) {
        fixture.stdout.off("data", receive);
        clearTimeout(timer);
        controller.abort();
        resolve();
      }
    };
    fixture.stdout.on("data", receive);
    timer = setTimeout(() => {
      fixture.stdout.off("data", receive);
      controller.abort();
      reject(new Error("no fixture text received"));
    }, 15000);
  });
  const typing = host.tools
    .get("windows_computer_use_type_text")
    .execute(
      "cancel-unicode",
      { ...target, text: "x".repeat(1000000), method: "sendinput" },
      controller.signal,
      undefined,
      {},
    );
  const cancelled = typing.then(
    () => {
      throw new Error("expected cancellation");
    },
    (error) => assert.match(String(error), /abort|STOPPED|CANCELLED/i),
  );
  await seen;
  await cancelled;
  await host.emit("before_agent_start", { messageType: "user" });
  assert.equal(await command("keys-check"), "keys-released");
  assert.equal(await command("clipboard-check"), "clipboard-restored");
  console.log(
    JSON.stringify({
      ok: true,
      physicalInput: true,
      clipboardMutation: true,
      clipboardSnapshotRestoration: true,
      unicode: true,
      chord: true,
      cancellation: true,
      physicalEsc: "manual pending",
      focusInterference: "manual pending",
      passwordAndHistoryCloudEffects: "manual pending",
    }),
  );
} finally {
  await nativeDesktop.dispose();
  for (const handler of host.shutdown) await handler();
  if (fixture.exitCode === null) {
    const closed = once(fixture, "close");
    fixture.stdin.end("stop\n");
    const timeout = setTimeout(() => fixture.kill(), 1000);
    await closed;
    clearTimeout(timeout);
  }
  await rm(folder, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  });
}
