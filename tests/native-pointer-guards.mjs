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
  const button = (await find("Background action", "Button"))[0];
  const quiet = await call("click", { elementId: button.id });
  assert.equal(quiet.ok, true, JSON.stringify(quiet));
  assert.equal(quiet.method, "native_button");
  const implicit = await host.tools
    .get("windows_computer_use_snapshot")
    .execute(
      "implicit",
      { includeScreenshot: false },
      undefined,
      undefined,
      {},
    );
  assert.equal(
    implicit.details.nativeWindowHandle,
    target.nativeWindowHandle,
    JSON.stringify(implicit.details),
  );
  const background = await call("double_click", {
    elementId: button.id,
    dispatch: "background",
  });
  assert.equal(background.ok, true, JSON.stringify(background));
  const shifted = once(fixture.stdout, "data");
  fixture.stdin.write("shift\n");
  await shifted;
  const homed = await call("click", {
    x: Math.round(button.boundingBox.centerX),
    y: Math.round(button.boundingBox.centerY),
    dispatch: "background",
  });
  assert.equal(homed.ok, true, JSON.stringify(homed));
  assert.deepEqual(homed.homed, { dx: 20, dy: 15 });
  const outside = await call("click", { x: -2147483647, y: -2147483647 });
  assert.equal(outside.ok, false);
  assert.match(outside.error, /POINT_OUTSIDE_TARGET|POINT_OUTSIDE_DESKTOP/);
  const badDrag = await call("drag", {
    path: [
      { x: -2147483647, y: -2147483647 },
      { x: -2147483646, y: -2147483646 },
    ],
  });
  assert.equal(badDrag.ok, false, JSON.stringify(badDrag));
  assert.match(badDrag.error, /POINT_OUTSIDE_TARGET|POINT_OUTSIDE_DESKTOP/);
  const wrong = await call("move", { x: 0, y: 0, processId: fixture.pid + 1 });
  assert.equal(wrong.ok, false);
  assert.match(wrong.error, /IDENTITY/);
  const label = (await find("Unsupported label", "Text"))[0];
  assert.ok(label);
  const popupReply = once(fixture.stdout, "data");
  fixture.stdin.write("popup\n");
  const [, popupX, popupY] = (await popupReply)[0]
    .toString()
    .trim()
    .split(":")
    .map(Number);
  const popupClick = await call("click", {
    x: popupX,
    y: popupY,
    dispatch: "background",
  });
  assert.equal(popupClick.ok, true, JSON.stringify(popupClick));
  assert.ok(
    (await find("Popup clicked", "Text")).length,
    "source target can address its owned popup outside its frame",
  );
  const covered = once(fixture.stdout, "data");
  fixture.stdin.write("cover\n");
  await covered;
  const refused = await call("move", { elementId: label.id });
  assert.equal(refused.ok, false, JSON.stringify(refused));
  assert.match(refused.error, /POINT_OCCLUDED/);
  assert.equal(refused.pointer, "unchanged");
  const removed = once(fixture.stdout, "data");
  fixture.stdin.write("remove\n");
  await removed;
  const stale = await call("click", { elementId: button.id });
  assert.equal(stale.ok, false);
  assert.match(stale.error, /STALE/);
  console.log(
    JSON.stringify({
      ok: true,
      quietClick: true,
      backgroundDoubleClick: true,
      lastTarget: true,
      movedWindowHoming: true,
      outsidePoint: true,
      coveredPoint: true,
      sameProcessPopupOutsideFrame: true,
      wrongOwner: true,
      stale: true,
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
