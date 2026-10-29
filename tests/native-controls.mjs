// Background actions only, against dedicated disposable controls. No physical input.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { cp, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
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
const fixtureCommand = async (command) => {
  const reply = once(fixture.stdout, "data");
  fixture.stdin.write(`${command}\n`);
  return (await reply)[0].toString().trim();
};
let siblingRestoration = { observed: false };
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
  const previous = (await call("list_windows", {})).windows.find(
    (window) => window.hasKeyboardFocus,
  );
  const sibling = Number((await fixtureCommand("sibling")).split(":")[1]);
  const activated = await call("activate_window", {});
  if (activated.ok) {
    const switcher = (await find("Switch sibling", "Hyperlink"))[0];
    const switched = await call("invoke", {
      elementId: switcher.id,
      fallbackClick: false,
    });
    const after = Number((await fixtureCommand("foreground")).split(":")[1]);
    const actual = (await find("Sibling selected", "Text")).length > 0;
    if (actual) {
      assert.ok(
        switched.foreground === "unchanged" ||
          switched.foreground.startsWith("left:"),
        JSON.stringify(switched),
      );
      assert.equal(
        after,
        sibling,
        "do not restore over another pre-existing root in the same PID",
      );
      siblingRestoration = { observed: true };
    } else
      siblingRestoration = {
        observed: false,
        reason: "Windows refused sibling activation",
      };
    if (previous && after === sibling)
      await call("activate_window", {
        nativeWindowHandle: previous.nativeWindowHandle,
        processId: previous.processId,
      });
  } else
    siblingRestoration = { observed: false, reason: String(activated.error) };
  // A damaged installed package must fail at the required resource, rather than
  // silently compile an obsolete subset and fail later in a different action.
  const staged = join(folder, "damaged-package");
  await cp(
    fileURLToPath(new URL("../dist/", import.meta.url)),
    join(staged, "dist"),
    { recursive: true },
  );
  await cp(
    fileURLToPath(new URL("../assets/", import.meta.url)),
    join(staged, "assets"),
    { recursive: true },
  );
  await writeFile(join(staged, "package.json"), '{"type":"module"}');
  await unlink(join(staged, "assets", "controls.cs"));
  const damaged = await import(
    pathToFileURL(join(staged, "dist", "native.js")).href
  );
  try {
    await assert.rejects(
      damaged.nativeDesktop.execute("list_windows", {
        maxWindows: 1,
        includeInvisible: false,
      }),
      /NATIVE_RESOURCE_MISSING.*controls.cs/,
    );
  } finally {
    await damaged.nativeDesktop.dispose();
  }
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
      siblingRestoration,
      requiredResourceFailure: true,
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
