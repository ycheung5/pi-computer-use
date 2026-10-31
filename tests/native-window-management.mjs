// Launch/move/activate/close only dedicated fixtures, without mouse/keyboard input.
import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { registerComputerUse } from "../dist/extension.js";
import { computerUseHost } from "./native-host.mjs";

assert.equal(process.platform, "win32");
const run = promisify(execFile),
  folder = await mkdtemp(join(tmpdir(), "pi-cu-window-management-")),
  executable = join(folder, "Fixture app.exe"),
  preferences = join(folder, "settings.json"),
  compiler = join(
    process.env.WINDIR,
    "Microsoft.NET",
    "Framework64",
    "v4.0.30319",
    "csc.exe",
  );
const compiled = spawnSync(
  compiler,
  [
    "/nologo",
    "/target:exe",
    `/out:${executable}`,
    "/r:System.Windows.Forms.dll",
    fileURLToPath(new URL("./window-management-fixture.cs", import.meta.url)),
  ],
  { encoding: "utf8", windowsHide: true, cwd: folder },
);
assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
const create = () => {
  const host = computerUseHost();
  registerComputerUse(host.api, {
    launch: async () => ({
      executable: process.execPath,
      args: [
        "--input-type=module",
        "-e",
        `import{pathToFileURL}from'node:url';process.env.PI_CU_SETTINGS_FILE=${JSON.stringify(preferences)};await import(pathToFileURL(${JSON.stringify(fileURLToPath(new URL("../dist/worker.js", import.meta.url)))}).href);`,
      ],
      cwd: folder,
    }),
  });
  return host;
};
let host = create();
const owned = new Set();
const call = async (action, args = {}) => {
  const tool = host.tools.get(`windows_computer_use_${action}`);
  assert.ok(tool, `${action} registered`);
  return (
    await tool.execute(
      `${action}-${Date.now()}`,
      args,
      undefined,
      undefined,
      {},
    )
  ).details;
};
const find = async (title) => {
  const listed = await call("list_windows", {
    includeInvisible: true,
    maxWindows: 200,
  });
  assert.equal(listed.ok, true, JSON.stringify(listed));
  return listed.windows.find((window) => window.name === title);
};
const until = async (predicate) => {
  const start = performance.now();
  for (;;) {
    const result = await predicate();
    if (result) return result;
    if (performance.now() - start > 7000)
      throw new Error("fixture observation timed out");
    await delay(60);
  }
};
try {
  const title = `Pi CU managed ${Date.now()}`;
  const launched = await call("launch_app", {
    target: executable,
    arguments: `"${title}" veto-once`,
    workingDirectory: folder,
    waitMs: 150,
  });
  assert.equal(launched.ok, true, JSON.stringify(launched));
  assert.equal(launched.launchMethod, "explorer-shell");
  assert.equal(launched.verification, "dispatched");
  const target = await until(() => find(title));
  owned.add(target.processId);
  for (const close of host.shutdown) await close();
  host = create();
  const survived = await find(title);
  assert.equal(
    survived.processId,
    target.processId,
    "Explorer-owned app survives worker exit",
  );
  const identity = {
    nativeWindowHandle: target.nativeWindowHandle,
    processId: target.processId,
  };
  const wrong = await call("move_window", {
    ...identity,
    processId: target.processId + 99999,
    x: 240,
    y: 260,
  });
  assert.equal(wrong.ok, false);
  assert.match(wrong.error, /IDENTITY_CHANGED/);
  const moved = await call("move_window", { ...identity, x: 240, y: 260 });
  assert.equal(moved.ok, true, JSON.stringify(moved));
  assert.equal(moved.moved, true);
  await until(async () => {
    const window = await find(title);
    return window?.boundingBox.x === 240 && window?.boundingBox.y === 260;
  });
  const activated = await call("activate_window", identity);
  assert.equal(activated.ok, true, JSON.stringify(activated));
  assert.equal(typeof activated.activated, "boolean");
  assert.equal(
    activated.verification,
    activated.activated ? "sent" : "unconfirmed",
  );
  if (!activated.activated) assert.ok(activated.warning);
  const firstClose = await call("close_window", identity);
  assert.equal(firstClose.posted, true);
  assert.equal(firstClose.verification, "sent");
  await delay(100);
  assert.ok(
    await find(title),
    "posted close is not proof of closure when fixture vetoes it",
  );
  assert.equal((await call("close_window", identity)).posted, true);
  await until(async () => !(await find(title)));
  owned.delete(target.processId);
  const stale = await call("activate_window", identity);
  assert.equal(stale.ok, false);
  assert.match(stale.error, /IDENTITY_CHANGED/);
  const script = join(folder, "refused.lnk"),
    payload = Buffer.from(
      JSON.stringify({
        path: script,
        target: join(process.env.WINDIR, "System32", "cmd.exe"),
      }),
      "utf8",
    ).toString("base64");
  const make = `$data=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}'))|ConvertFrom-Json;$shell=New-Object -ComObject WScript.Shell;$link=$shell.CreateShortcut($data.path);$link.TargetPath=$data.target;$link.Arguments='/c exit';$link.Save()`;
  await run(
    "powershell.exe",
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(make, "utf16le").toString("base64"),
    ],
    { cwd: folder, windowsHide: true },
  );
  const shortcut = await call("launch_app", { target: script, waitMs: 0 });
  assert.equal(shortcut.ok, false);
  assert.match(shortcut.error, /LAUNCH_COMMAND_REFUSED/);
  const invalidDir = await call("launch_app", {
    target: executable,
    workingDirectory: "relative-folder",
    waitMs: 0,
  });
  assert.equal(invalidDir.ok, false);
  assert.match(invalidDir.error, /LAUNCH_INVALID_DIRECTORY/);
  const blockedTitle = `Pi CU blocked ${Date.now()}`;
  assert.equal(
    (
      await call("launch_app", {
        target: executable,
        arguments: `"${blockedTitle}" unresponsive`,
        waitMs: 100,
      })
    ).ok,
    true,
  );
  const blocked = await until(() => find(blockedTitle));
  owned.add(blocked.processId);
  const refused = await call("activate_window", {
    nativeWindowHandle: blocked.nativeWindowHandle,
    processId: blocked.processId,
  });
  assert.equal(refused.ok, true);
  assert.equal(refused.activated, false);
  assert.equal(refused.verification, "unconfirmed");
  assert.match(refused.warning, /unresponsive|inaccessible/);
  assert.equal(
    (
      await call("close_window", {
        nativeWindowHandle: blocked.nativeWindowHandle,
        processId: blocked.processId,
      })
    ).posted,
    true,
  );
  await until(async () => !(await find(blockedTitle)));
  owned.delete(blocked.processId);
  const cancelledTitle = `Pi CU cancelled ${Date.now()}`;
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(
    host.tools
      .get("windows_computer_use_launch_app")
      .execute(
        "cancelled",
        { target: executable, arguments: `"${cancelledTitle}"` },
        cancelled.signal,
        undefined,
        {},
      ),
  );
  await host.emit("before_agent_start", { messageType: "user" }, {});
  assert.equal(
    await find(cancelledTitle),
    undefined,
    "a pre-cancelled launch never starts a fixture",
  );
  console.log(
    JSON.stringify({
      ok: true,
      check: "native window management",
      explorerLaunch: true,
      survivesWorker: true,
      movedObserved: true,
      closeVeto: true,
      staleOwnerRefused: true,
      shortcutCommandsRefused: true,
      unresponsiveHonest: true,
      activation: activated.activated,
      physicalInput: false,
    }),
  );
} finally {
  for (const close of host.shutdown) await close();
  for (const pid of owned)
    await run("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
      windowsHide: true,
    }).catch(() => {});
  await rm(folder, { recursive: true, force: true });
}
