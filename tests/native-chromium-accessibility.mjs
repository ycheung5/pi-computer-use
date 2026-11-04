// Native UIA against a disposable Chromium fixture. No daily profile/input.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { WorkerClient } from "../dist/client.js";
import { blankWorkspaceEvidence } from "./pi-workspace-host.mjs";

assert.equal(process.platform, "win32", "Run with Windows Node after build");
const workspace = process.argv.includes("--workspace");
const agentServer = process.argv.includes("--agent-server");
const folder = await mkdtemp(join(tmpdir(), "pi-cu-chromium-uia-"));
const createWorker = () =>
  new WorkerClient({
    launch: async () => ({
      executable: process.execPath,
      args: [
        "--input-type=module",
        "-e",
        `process.env.PI_CU_SETTINGS_FILE=${JSON.stringify(join(folder, "settings.json"))};await import(${JSON.stringify(pathToFileURL(fileURLToPath(new URL("../dist/worker.js", import.meta.url))).href)});`,
      ],
      cwd: folder,
    }),
  });
let worker = createWorker();
const title = `Pi Chromium fixture ${Date.now()}`;
const html = join(folder, "page.html");
let browser;
let stopped = false;
try {
  await writeFile(
    html,
    `<!doctype html><title>${title}</title><h1>Fixture page heading</h1><label>Fixture browser editor<input value="browser fixture text"></label><button>Fixture browser action</button>`,
  );
  const defaultBrowser = workspace
    ? await worker.execute("launch_app", {
        target: "browser",
        resolveOnly: true,
      })
    : undefined;
  const candidates = workspace
    ? [defaultBrowser?.handler?.executable].filter(Boolean)
    : [
        join(
          process.env["ProgramFiles(x86)"] ?? "",
          "Microsoft",
          "Edge",
          "Application",
          "msedge.exe",
        ),
        join(
          process.env.ProgramFiles ?? "",
          "Google",
          "Chrome",
          "Application",
          "chrome.exe",
        ),
      ];
  let executable;
  for (const candidate of candidates) {
    try {
      await access(candidate);
      executable = candidate;
      break;
    } catch {}
  }
  assert.ok(
    executable,
    "Install a supported Chromium browser to run this live fixture",
  );
  if (workspace)
    assert.match(
      executable,
      /\\(?:chrome|msedge)\.exe$/i,
      "UNAVAILABLE: this native tab fixture supports Chromium defaults only",
    );
  browser = spawn(
    executable,
    [
      `--user-data-dir=${join(folder, "profile")}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-mode",
      "--disable-features=CalculateNativeWinOcclusion",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--window-position=100,100",
      workspace
        ? pathToFileURL(html).href
        : `--app=${pathToFileURL(html).href}`,
    ],
    {
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: !workspace,
      cwd: folder,
    },
  );
  let target;
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const listing = await worker.execute("list_windows", {
      maxWindows: 200,
      includeInvisible: true,
    });
    assert.equal(listing.ok, true, JSON.stringify(listing));
    target = listing.windows.find((window) => window.name.includes(title));
    if (target) break;
    await delay(100);
  }
  assert.ok(target, "isolated Chromium fixture window appears");
  await delay(500);
  let result;
  const observationDeadline = Date.now() + 10000;
  do {
    result = await worker.execute("find", {
      nativeWindowHandle: target.nativeWindowHandle,
      processId: target.processId,
      includeOffscreen: true,
      query: "Fixture browser action",
      ocrFallback: false,
    });
    if (result.matches?.length || result.ok === false) break;
    await delay(150);
  } while (Date.now() < observationDeadline);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok(
    result.matches.some((item) => item.name === "Fixture browser action"),
    JSON.stringify(result),
  );
  assert.ok(result.webContent, "Chromium warm-up readiness is explicit");
  const id = result.matches.find(
    (item) => item.name === "Fixture browser action",
  ).id;
  const info = await worker.execute("element_info", { elementId: id });
  assert.equal(info.ok, true, JSON.stringify(info));
  assert.equal(info.element.controlType, "Button");
  if (workspace) {
    let identity = { windowRef: result.windowRef };
    if (!agentServer) {
      const activated = await worker.execute("activate_window", identity);
      assert.equal(activated.activated, true, JSON.stringify(activated));
    }
    const flatten = (node) =>
      node ? [node, ...(node.children ?? []).flatMap(flatten)] : [];
    let rawTree;
    const tree = async () => {
      const observed = await worker.execute("accessibility_tree", {
        ...identity,
        maxDepth: 10,
        maxNodes: 500,
        detailLevel: "full",
      });
      assert.equal(observed.ok, true, JSON.stringify(observed));
      rawTree = observed.tree;
      return flatten(observed.tree);
    };
    const before = await tree();
    const originalTree = rawTree;
    const tabs = before.filter((node) => node.controlType === "TabItem");
    assert.ok(
      tabs.some((node) => node.name.includes(title)),
      "original task page has an observed tab",
    );
    if (agentServer) {
      const visibleListing = await worker.execute("list_windows", {
        maxWindows: 200,
        includeInvisible: false,
      });
      assert.equal(visibleListing.ok, true, JSON.stringify(visibleListing));
      const visible = visibleListing.windows.some(
        (window) =>
          window.nativeWindowHandle === target.nativeWindowHandle &&
          window.processId === target.processId,
      );
      await worker.dispose();
      const commands = createInterface({ input: process.stdin });
      console.log(
        JSON.stringify({
          ready: true,
          visibleForDiscovery: visible,
          initialVisibility: { isOffscreen: target.isOffscreen },
          target: {
            nativeWindowHandle: target.nativeWindowHandle,
            processId: target.processId,
            title,
          },
          settings: join(folder, "settings.json"),
          browser: defaultBrowser.handler,
          profile: join(folder, "profile"),
        }),
      );
      const [command] = await Promise.race([
        once(commands, "line"),
        once(commands, "close").then(() => ["stop"]),
      ]);
      commands.close();
      if (command === "stop") {
        stopped = true;
        throw Error("Fixture stopped before verification");
      }
      if (command !== "verify")
        throw Error("agent run did not authorize verification");
      worker = createWorker();
      identity = {
        nativeWindowHandle: target.nativeWindowHandle,
        processId: target.processId,
      };
    } else {
      const add = before.filter(
        (node) =>
          node.controlType === "Button" &&
          (/new.?tab/i.test(node.automationId ?? "") ||
            /new tab|新增分頁|新增索引標籤|新增标签页|新分頁|新标签页/i.test(
              node.name,
            )),
      );
      assert.equal(add.length, 1, JSON.stringify(add));
      const opened = await worker.execute("invoke", {
        elementId: add[0].id,
        fallbackClick: false,
      });
      assert.equal(opened.ok, true, JSON.stringify(opened));
    }
    let after;
    const tabDeadline = Date.now() + 10000;
    do {
      after = await tree();
      if (
        after.filter((node) => node.controlType === "TabItem").length ===
        tabs.length + 1
      )
        break;
      await delay(100);
    } while (Date.now() < tabDeadline);
    assert.equal(
      after.filter((node) => node.controlType === "TabItem").length,
      tabs.length + 1,
      "exactly one task tab in the same native window",
    );
    const original = after.find(
      (node) => node.controlType === "TabItem" && node.name.includes(title),
    );
    assert.ok(original, "original tab remains");
    assert.equal(
      blankWorkspaceEvidence(originalTree, rawTree),
      true,
      "new task tab must expose a blank/new-tab browser address, not a website",
    );
    const completed = await worker.execute("accessibility_tree", {
      ...identity,
      maxDepth: 0,
      maxNodes: 1,
    });
    assert.equal(
      completed.tree.hasKeyboardFocus,
      true,
      "agent leaves requested window foreground before independent verification",
    );
    if (agentServer) {
      const windows = await worker.execute("list_windows", { maxWindows: 200 });
      assert.equal(windows.ok, true, JSON.stringify(windows));
      assert.equal(
        windows.windows.filter(
          (w) =>
            w.processId === target.processId &&
            w.className === target.className &&
            w.boundingBox.width > 100 &&
            w.boundingBox.height > 100,
        ).length,
        1,
        "no extra browser window was created",
      );
    }
    if (agentServer)
      assert.equal(
        completed.tree.name.includes(title),
        false,
        "new task tab remains selected before verification",
      );
    assert.equal(
      (
        await worker.execute("invoke", {
          elementId: original.id,
          fallbackClick: false,
        })
      ).ok,
      true,
    );
    const editor = await worker.execute("find", {
      ...identity,
      query: "Fixture browser editor",
      controlType: "Edit",
      ocrFallback: false,
    });
    assert.equal(editor.matches.length, 1, JSON.stringify(editor));
    const preserved = await worker.execute("element_info", {
      elementId: editor.matches[0].id,
      detailLevel: "full",
    });
    assert.equal(preserved.element.value, "browser fixture text");
    const visible = await worker.execute("accessibility_tree", {
      ...identity,
      maxDepth: 0,
      maxNodes: 1,
    });
    assert.equal(visible.tree.hasKeyboardFocus, true);
  }
  console.log(
    JSON.stringify({
      ok: true,
      check: "Chromium accessibility lazy warm-up",
      browser: executable.includes("msedge") ? "edge" : "chrome",
      state: result.webContent.state,
      ...(workspace
        ? {
            nativeExistingWindowReuse: true,
            newTaskTabOriginalPreserved: true,
            selectedBlankTabVerified: true,
            defaultBrowser: defaultBrowser.handler.name,
          }
        : {}),
      physicalInput: false,
    }),
  );
} catch (error) {
  if (!stopped) throw error;
} finally {
  await worker.dispose();
  if (browser?.pid)
    spawnSync("taskkill.exe", ["/PID", String(browser.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
  await delay(500);
  await rm(folder, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 200,
  });
}
if (stopped)
  console.log(JSON.stringify({ stopped: true, fixtureCleanupConfirmed: true }));
