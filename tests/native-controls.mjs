// Background actions only, against dedicated disposable controls. No physical input.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import computerUse from "../dist/extension.js";
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
  assert.ok(edit);
  const value = await call("set_value", {
    elementId: edit.id,
    value: "Pi 測試",
  });
  assert.equal(value.ok, true, JSON.stringify(value));
  assert.equal(value.verification, "sent");
  const observed = await call("element_info", {
    elementId: edit.id,
    detailLevel: "full",
  });
  assert.equal(observed.element.value, "Pi 測試");
  const focus = await call("focus", { elementId: edit.id });
  assert.equal(focus.ok, true, JSON.stringify(focus));
  const button = (await find("Background action", "Button"))[0];
  assert.ok(button);
  const invoked = await call("invoke", { elementId: button.id });
  assert.equal(invoked.ok, true, JSON.stringify(invoked));
  assert.equal(invoked.verification, "sent");
  assert.equal((await find("Clicked 1")).length, 1);
  const panel = (await find("Background scroller"))[0];
  assert.ok(panel);
  const scrolled = await call("scroll", { elementId: panel.id, deltaY: 240 });
  assert.equal(scrolled.ok, true, JSON.stringify(scrolled));
  assert.equal(scrolled.verification, "sent");
  assert.notEqual(
    JSON.stringify(scrolled.before),
    JSON.stringify(scrolled.after),
    "native fixture scroll position changed",
  );
  const readOnly = (await find("Read only editor", "Edit"))[0];
  const refused = await call("set_value", {
    elementId: readOnly.id,
    value: "should not change",
  });
  assert.equal(refused.ok, false);
  assert.match(refused.error, /READ_ONLY/);
  const fallback = (await find("Unsupported label"))[0];
  const noFallback = await call("invoke", {
    elementId: fallback.id,
    fallbackClick: false,
  });
  assert.equal(noFallback.ok, false);
  assert.match(noFallback.error, /UNSUPPORTED_PATTERN/);
  const wrong = await call("set_value", {
    elementId: edit.id,
    value: "wrong owner",
    processId: fixture.pid + 1,
  });
  assert.equal(wrong.ok, false);
  assert.match(wrong.error, /identity|owner/i);
  const removed = once(fixture.stdout, "data");
  fixture.stdin.write("remove\n");
  await removed;
  const stale = await call("invoke", { elementId: button.id });
  assert.equal(stale.ok, false);
  assert.match(stale.error, /STALE/);
  console.log(
    JSON.stringify({
      ok: true,
      nativeEdit: true,
      buttonInvoke: true,
      focus: true,
      elementScroll: true,
      readOnly: true,
      stale: true,
      unsupportedFallbackDisabled: true,
      physicalInput: false,
    }),
  );
} finally {
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
