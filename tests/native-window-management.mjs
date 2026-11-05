// Launch/move/activate/close only dedicated fixtures, without mouse/keyboard input.
import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { registerComputerUse } from "../dist/extension.js";
import { computerUseHost } from "./native-host.mjs";
import {
  documentWorkspaceEvidence,
  nativeDocumentText,
} from "./pi-workspace-host.mjs";

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
async function verifyWorkspace() {
  const token = randomUUID().replaceAll("-", "");
  const extension = `.picu${token}`;
  const progId = `PiCu.Workspace.${token}`;
  const title = `Pi CU workspace ${token}`;
  const document = join(folder, `original${extension}`);
  const journal = join(folder, "workspace.log");
  await writeFile(document, "original work");
  const registry = async (action) => {
    const data = Buffer.from(
      JSON.stringify({ extension, progId, executable, title, journal, action }),
    ).toString("base64");
    const script = `
$ErrorActionPreference='Stop'
$d=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${data}'))|ConvertFrom-Json
$root=[Microsoft.Win32.Registry]::CurrentUser
$paths=@(('Software\\Classes\\'+$d.extension),('Software\\Classes\\'+$d.progId))
if($d.action -eq 'remove') {foreach($path in $paths){$root.DeleteSubKeyTree($path,$false)};exit}
foreach($path in $paths){$existing=$root.OpenSubKey($path);if($existing){$existing.Close();throw 'fixture association already exists'}}
$created=@()
try {
  foreach($path in $paths){$key=$root.CreateSubKey($path);$created+=,$path;$key.Close()}
  $key=$root.OpenSubKey($paths[0],$true);try{$key.SetValue('',$d.progId)}finally{$key.Close()}
  $key=$root.CreateSubKey($paths[1]+'\\shell\\open\\command')
  try{$key.SetValue('','"'+$d.executable+'" "'+$d.title+'" workspace "'+$d.journal+'" "%1"')}finally{$key.Close()}
} catch {foreach($path in $created){$root.DeleteSubKeyTree($path,$false)};throw}
`;
    await run(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        Buffer.from(script, "utf16le").toString("base64"),
      ],
      { cwd: folder, windowsHide: true },
    );
  };
  let registered = false;
  try {
    await registry("create");
    registered = true;
    const defaultBrowser = await call("launch_app", {
      target: "https://example.invalid/",
      resolveOnly: true,
    });
    assert.equal(defaultBrowser.ok, true, JSON.stringify(defaultBrowser));
    assert.equal(defaultBrowser.verification, "resolved");
    assert.equal(defaultBrowser.launched, false);
    assert.equal(defaultBrowser.handler.association, "https");
    const blankBrowser = await call("launch_app", {
      target: "browser",
      resolveOnly: true,
    });
    assert.equal(blankBrowser.ok, true, JSON.stringify(blankBrowser));
    assert.equal(blankBrowser.handler.progId, defaultBrowser.handler.progId);
    assert.equal(blankBrowser.launched, false);
    const resolved = await call("launch_app", {
      target: document,
      resolveOnly: true,
    });
    assert.equal(resolved.ok, true, JSON.stringify(resolved));
    assert.equal(resolved.handler.progId, progId);
    assert.equal(
      resolved.handler.executable.toLowerCase(),
      executable.toLowerCase(),
    );
    assert.equal(
      await find(title),
      undefined,
      "resolution never launches the app",
    );
    const opened = await call("launch_app", { target: document, waitMs: 0 });
    assert.equal(opened.ok, true, JSON.stringify(opened));
    assert.equal(opened.targetKind, "document");
    const target = await until(() => find(title));
    owned.add(target.processId);
    const identity = {
      nativeWindowHandle: target.nativeWindowHandle,
      processId: target.processId,
    };
    const callerForeground = async () => {
      await writeFile(journal, "stage\n");
      await writeFile(`${journal}.caller`, "");
      await until(async () =>
        (await readFile(journal, "utf8")).includes("caller-front:True"),
      );
    };
    const activated = await call("activate_window", identity);
    assert.equal(activated.activated, true, JSON.stringify(activated));
    assert.equal(
      typeof activated.windowRef,
      "string",
      "confirmed activation preserves its lifetime witness",
    );
    await callerForeground();
    const implicit = await call("accessibility_tree", {
      maxDepth: 0,
      maxNodes: 1,
    });
    assert.equal(implicit.nativeWindowHandle, target.nativeWindowHandle);
    assert.equal(implicit.windowRef, activated.windowRef);
    const button = await call("find", {
      ...identity,
      query: "New task tab",
      controlType: "Button",
      ocrFallback: false,
    });
    assert.equal(button.matches.length, 1, JSON.stringify(button));
    assert.equal(
      (await find(title)).hasKeyboardFocus,
      false,
      "passive discovery does not steal foreground",
    );
    // No activate option: confirmed visible intent must persist at worker level.
    const added = await call("invoke", {
      elementId: button.matches[0].id,
      fallbackClick: false,
    });
    assert.equal(added.ok, true, JSON.stringify(added));
    await until(async () =>
      (await readFile(journal, "utf8").catch(() => "")).includes(
        "new-tab:2:True:original work",
      ),
    );
    const editor = await call("find", {
      ...identity,
      query: "Task editor",
      ocrFallback: false,
    });
    assert.equal(editor.matches.length, 1, JSON.stringify(editor));
    const changed = await call("set_value", {
      elementId: editor.matches[0].id,
      value: "task work",
      fallbackType: false,
    });
    assert.equal(changed.ok, true, JSON.stringify(changed));
    const observed = await call("element_info", {
      ...identity,
      elementId: editor.matches[0].id,
      detailLevel: "full",
    });
    assert.equal(observed.element.value, "task work");
    assert.equal(
      (await find(title)).hasKeyboardFocus,
      true,
      "visible workflow retains foreground after related steps",
    );
    assert.equal(await readFile(document, "utf8"), "original work");
    await callerForeground();
    const background = await call("set_value", {
      ...identity,
      elementId: editor.matches[0].id,
      value: "background task work",
      fallbackType: false,
      activate: false,
    });
    assert.equal(background.ok, true, JSON.stringify(background));
    assert.equal(
      (await find(`${title} caller`)).hasKeyboardFocus,
      true,
      "explicit background action preserves caller foreground",
    );
    const separateTitle = `${title} separate`;
    const separate = await call("launch_app", {
      target: executable,
      arguments: `"${separateTitle}" workspace "${journal}" "${document}"`,
      waitMs: 0,
    });
    assert.equal(separate.ok, true, JSON.stringify(separate));
    const separateWindow = await until(() => find(separateTitle));
    owned.add(separateWindow.processId);
    assert.notEqual(
      separateWindow.nativeWindowHandle,
      target.nativeWindowHandle,
    );
    await call("close_window", {
      nativeWindowHandle: separateWindow.nativeWindowHandle,
      processId: separateWindow.processId,
    });
    await until(async () => !(await find(separateTitle)));
    owned.delete(separateWindow.processId);
    // Passive observation and worker exit may not close this borrowed workspace.
    for (const close of host.shutdown) await close();
    host = create();
    assert.equal((await find(title)).processId, target.processId);
    await call("close_window", identity);
    await until(async () => !(await find(title)));
    owned.delete(target.processId);
    const unknown = join(folder, `unknown.picuunknown${token}`);
    await writeFile(unknown, "");
    const refused = await call("launch_app", {
      target: unknown,
      resolveOnly: true,
    });
    assert.equal(refused.ok, false);
    assert.match(refused.error, /DEFAULT_APP_UNAVAILABLE/);
    return {
      ok: true,
      check: "Windows default handler and reused workspace",
      defaultBrowserResolvedWithoutLaunch: true,
      privateDocumentHandler: true,
      newTaskTabOriginalUnchanged: true,
      visibleIntentRetained: true,
      borrowedWindowSurvivesWorker: true,
      explicitSeparateWindow: true,
      unknownAssociationRefused: true,
      physicalInput: false,
    };
  } catch (error) {
    console.error(error);
    throw error;
  } finally {
    for (const line of (await readFile(journal, "utf8").catch(() => "")).split(
      /\r?\n/,
    )) {
      if (/^started:\d+$/.test(line)) owned.add(Number(line.slice(8)));
    }
    if (registered) await registry("remove");
  }
}
// The same owned native app also supplies the two remaining agent decisions.
async function serveWorkspaceDecision(scenario) {
  assert.ok(
    ["ambiguous", "unsafe-workspace", "document", "document-recovery"].includes(
      scenario,
    ),
  );
  const titlePrefix = `Pi Workspace ${randomUUID()}`;
  const targets = [],
    journals = [],
    originals = [];
  const flatten = (node) =>
    node ? [node, ...(node.children ?? []).flatMap(flatten)] : [];
  const inspect = async (target, expected) => {
    const result = await call("accessibility_tree", {
      nativeWindowHandle: target.nativeWindowHandle,
      processId: target.processId,
      activate: false,
      detailLevel: "full",
      maxDepth: 10,
      maxNodes: 500,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(
      result.truncated,
      false,
      "complete owned app observation required",
    );
    const nodes = flatten(result.tree);
    assert.equal(
      nodes.filter((n) => n.controlType === "TabItem").length,
      1,
      "no new task was created",
    );
    const editors = nodes.filter(
      (n) => n.name === "Original editor" && n.controlType === "Edit",
    );
    assert.equal(editors.length, 1);
    assert.equal(
      editors[0].value,
      expected,
      "original unsaved editor preserved",
    );
    if (scenario === "unsafe-workspace")
      assert.equal(
        nodes.some((n) => n.name === "New task tab"),
        false,
        "fixture has no separate task creation control",
      );
  };
  try {
    for (let i = 0; i < (scenario === "ambiguous" ? 2 : 1); i++) {
      const title = `${titlePrefix} ${i + 1}`;
      const document = join(folder, `decision-${i}.txt`),
        journal = join(folder, `decision-${i}.log`),
        original = `original work ${i + 1}`;
      journals.push(journal);
      originals.push({ document, original });
      await writeFile(document, original);
      const opened = await call("launch_app", {
        target: executable,
        arguments: `"${title}" ${scenario === "unsafe-workspace" ? "workspace-unsafe" : scenario === "document-recovery" ? "workspace-document-recovery" : scenario === "document" ? "workspace-document" : "workspace"} "${journal}" "${document}" --no-expiry`,
        waitMs: 0,
      });
      assert.equal(opened.ok, true, JSON.stringify(opened));
      const row = await until(() => find(title));
      owned.add(row.processId);
      const target = {
        nativeWindowHandle: row.nativeWindowHandle,
        processId: row.processId,
        title,
      };
      targets.push(target);
      await inspect(target, original);
    }
    const listed = await call("list_windows", {
      includeInvisible: false,
      maxWindows: 200,
    });
    assert.equal(listed.ok, true);
    const visibleForDiscovery = targets.every((t) =>
      listed.windows.some(
        (w) =>
          w.nativeWindowHandle === t.nativeWindowHandle &&
          w.processId === t.processId,
      ),
    );
    for (const close of host.shutdown) await close();
    host = create();
    const commands = createInterface({ input: process.stdin });
    console.log(
      JSON.stringify({
        ready: true,
        scenario,
        titlePrefix,
        target: targets[0],
        targets,
        visibleForDiscovery,
        settings: preferences,
      }),
    );
    const [command] = await Promise.race([
      once(commands, "line"),
      once(commands, "close").then(() => ["stop"]),
    ]);
    commands.close();
    if (command === "stop") return { ok: true, stopped: true };
    if (["document", "document-recovery"].includes(scenario)) {
      assert.ok(["verify", "preflight"].includes(command));
      const target = targets[0],
        journal = journals[0];
      let recoveryPreflight;
      if (command === "preflight") {
        if (scenario === "document-recovery") {
          const partial = await call("accessibility_tree", {
            nativeWindowHandle: target.nativeWindowHandle,
            processId: target.processId,
            maxNodes: 1,
          });
          assert.equal(partial.truncated, true);
          assert.equal(partial.nodeCount, 1);
          recoveryPreflight = {
            partial: {
              truncated: partial.truncated,
              nodeCount: partial.nodeCount,
              truncationReason: partial.truncationReason,
            },
          };
        }
        const activated = await call("activate_window", {
          nativeWindowHandle: target.nativeWindowHandle,
          processId: target.processId,
        });
        assert.equal(activated.activated, true, JSON.stringify(activated));
        const lookup = async (query) => {
          const r = await call("find", {
            nativeWindowHandle: target.nativeWindowHandle,
            processId: target.processId,
            query,
            ocrFallback: false,
          });
          assert.equal(r.ok, true, JSON.stringify(r));
          assert.equal(r.matches.length, 1, JSON.stringify(r));
          return r.matches[0].id;
        };
        const invoke = async (query) => {
          const r = await call("invoke", {
            elementId: await lookup(query),
            fallbackClick: false,
          });
          assert.equal(r.ok, true, JSON.stringify(r));
        };
        await invoke("New task tab");
        for (const value of [
          nativeDocumentText.initial,
          nativeDocumentText.final,
        ]) {
          const editorId = await lookup("Task editor");
          const r = await call("set_value", {
            elementId: editorId,
            value,
            fallbackType: false,
          });
          assert.equal(r.ok, true, JSON.stringify(r));
          await invoke("Save task");
          if (
            scenario === "document-recovery" &&
            value === nativeDocumentText.initial
          ) {
            await until(async () =>
              (await readFile(journal, "utf8")).includes("editor-refreshed:"),
            );
            const stale = await call("element_info", { elementId: editorId });
            assert.equal(stale.ok, false, JSON.stringify(stale));
            assert.match(stale.error, /STALE_ELEMENT:/, JSON.stringify(stale));
            recoveryPreflight.staleError = stale.error;
          }
        }
      }
      // Read the application's actual controls on its UI thread, including the
      // unselected original tab; saved bytes and save chronology are separate.
      await writeFile(journal + ".observe", "");
      const raw = await until(() =>
        readFile(journal + ".state", "utf8").catch(() => undefined),
      );
      const fields = raw.split(":");
      assert.equal(fields.length, 7);
      assert.equal(Number(fields[3]), 1);
      const decode = (x) => Buffer.from(x, "base64").toString("utf8");
      const entries = (await readFile(journal, "utf8")).trim().split(/\r?\n/);
      assert.equal(entries.filter((x) => x.startsWith("started:")).length, 1);
      assert.equal(entries.filter((x) => x.startsWith("new-tab:")).length, 1);
      const current = await find(target.title);
      assert.equal(current?.nativeWindowHandle, target.nativeWindowHandle);
      assert.equal(current?.processId, target.processId);
      const documentOutcome = {
        taskVisible: fields[5] === "1",
        taskForeground: fields[6] === "1",
        tabs: Number(fields[0]),
        selected: Number(fields[1]),
        originalEditor: decode(fields[2]),
        taskEditor: decode(fields[4]),
        originalFile: await readFile(originals[0].document, "utf8"),
        taskFile: await readFile(journal + ".task.txt", "utf8"),
        savedValues: entries
          .filter((x) => x.startsWith("saved:"))
          .map((x) => decode(x.slice(6))),
      };
      assert.equal(
        documentWorkspaceEvidence(documentOutcome),
        true,
        JSON.stringify(documentOutcome),
      );
      let editorRefresh;
      if (scenario === "document-recovery") {
        const refresh = entries.filter((x) =>
          x.startsWith("editor-refreshed:"),
        );
        assert.equal(refresh.length, 1);
        const fields = refresh[0].split(":");
        assert.equal(fields.length, 3);
        editorRefresh = {
          oldHandle: Number(fields[1]),
          newHandle: Number(fields[2]),
        };
        assert.notEqual(editorRefresh.oldHandle, editorRefresh.newHandle);
      }
      return {
        ok: true,
        scenario,
        editorRefresh,
        recoveryPreflight,
        documentOutcome,
        documentTaskVerified: true,
        physicalInput: false,
      };
    }
    assert.equal(command, "verify");
    for (let i = 0; i < targets.length; i++) {
      await inspect(targets[i], originals[i].original);
      assert.equal(
        await readFile(originals[i].document, "utf8"),
        originals[i].original,
      );
      assert.match(
        (await readFile(journals[i], "utf8")).trim(),
        /^started:\d+$/,
        "no new tabs or close attempts",
      );
    }
    return {
      ok: true,
      scenario,
      refusalOriginalsPreserved: true,
      windows: targets.length,
      physicalInput: false,
    };
  } finally {
    for (const journal of journals)
      for (const line of (
        await readFile(journal, "utf8").catch(() => "")
      ).split(/\r?\n/))
        if (/^started:\d+$/.test(line)) owned.add(Number(line.slice(8)));
  }
}
async function verifyDefault() {
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
}
let workspaceReceipt;
try {
  if (process.argv.includes("--agent-server"))
    workspaceReceipt = await serveWorkspaceDecision(
      process.argv.find((a) => a.startsWith("--case="))?.slice(7),
    );
  else if (process.argv.includes("--workspace"))
    workspaceReceipt = await verifyWorkspace();
  else await verifyDefault();
} finally {
  for (const close of host.shutdown) await close();
  if (owned.size) {
    const payload = Buffer.from(
      JSON.stringify({ pids: [...owned], executable }),
    ).toString("base64");
    const cleanup = `$ErrorActionPreference='Stop';$d=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}'))|ConvertFrom-Json;foreach($fixturePid in $d.pids){$p=Get-Process -Id $fixturePid -ErrorAction SilentlyContinue;if($p){try{$handle=$p.Handle;if($p.MainModule.FileName -ieq $d.executable){$p.Kill();if(!$p.WaitForExit(5000)){throw 'fixture exit unconfirmed'}}}finally{$p.Dispose()}}};exit 0`;
    await run(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        Buffer.from(cleanup, "utf16le").toString("base64"),
      ],
      { windowsHide: true, cwd: folder },
    );
  }
  await rm(folder, {
    recursive: true,
    force: true,
    maxRetries: 20,
    retryDelay: 100,
  });
}

if (workspaceReceipt)
  console.log(
    JSON.stringify({ ...workspaceReceipt, fixtureCleanupConfirmed: true }),
  );
