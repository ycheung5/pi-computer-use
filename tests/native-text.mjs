// Background actions only, against dedicated disposable controls. No physical input.
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
    fileURLToPath(new URL("./controls-fixture.cs", import.meta.url)),
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
try {
  const edit = (await find("Background editor", "Edit"))[0];
  const initial = await call("set_value", {
    elementId: edit.id,
    value: "seed",
  });
  assert.equal(initial.ok, true, JSON.stringify(initial));
  // Exercise the native worker's ordinary quiet-attempt contract. A missing
  // focused edit can ONLY return WCU_NEEDS_INPUT, never physically escalate.
  const nativeCall = (action, args) =>
    nativeDesktop.execute(
      action,
      { ...target, ...args, _cancelEvent: "" },
      undefined,
      "passive-native-text",
    );
  const nativeFound = await nativeCall("find", {
    query: "Background editor",
    controlType: "Edit",
  });
  assert.equal(nativeFound.ok, true, JSON.stringify(nativeFound));
  const nativeEdit = nativeFound.matches[0];
  const focused = await nativeCall("focus", { elementId: nativeEdit.id });
  assert.equal(focused.ok, true, JSON.stringify(focused));
  const typed = await nativeCall("type_text", { text: " Unicode 測試 🙂" });
  assert.equal(typed.ok, true, JSON.stringify(typed));
  assert.equal(typed.method, "background:EM_REPLACESEL");
  assert.match(typed.verifyValue, /Unicode 測試 🙂/);
  const implicit = await host.tools
    .get("windows_computer_use_type_text")
    .execute(
      "implicit-type",
      { text: " remembered", method: "background" },
      undefined,
      undefined,
      {},
    );
  assert.equal(implicit.details.ok, true, JSON.stringify(implicit.details));
  assert.equal(implicit.details.method, "postmessage-wmchar");
  const posted = await call("type_text", { text: "!", method: "background" });
  assert.equal(posted.ok, true, JSON.stringify(posted));
  assert.equal(posted.verification, "unconfirmed");
  const character = await call("keypress", {
    keys: ["?"],
    dispatch: "background",
  });
  assert.equal(character.ok, true, JSON.stringify(character));
  const observed = await call("element_info", {
    elementId: edit.id,
    detailLevel: "full",
  });
  assert.match(observed.element.value, /remembered.*[!?]/);
  const nativeReadOnly = (
    await nativeCall("find", { query: "Read only editor", controlType: "Edit" })
  ).matches[0];
  await nativeCall("focus", { elementId: nativeReadOnly.id });
  const refused = await nativeCall("type_text", { text: "must not modify" });
  assert.equal(refused.ok, false);
  assert.match(refused.error, /READ_ONLY/);
  for (const [action, args] of [
    ["type_text", { text: "never typed", method: "sendinput" }],
    ["type_text", { text: "never clipboard", method: "clipboard" }],
    ["keypress", { keys: ["Ctrl", "A"] }],
  ]) {
    const invalid = await call(action, {
      ...args,
      nativeWindowHandle: 1,
      processId: 1,
    });
    assert.equal(invalid.ok, false, JSON.stringify(invalid));
    assert.match(invalid.error, /TARGET_IDENTITY_CHANGED/);
  }
  console.log(
    JSON.stringify({
      ok: true,
      backgroundUnicode: true,
      rememberedTarget: true,
      backgroundCharacter: true,
      readOnlyRefusal: true,
      physicalTargetRefusal: true,
      physicalInput: false,
      clipboardRead: false,
      clipboardMutation: false,
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
