// Pi tool/worker seam; all actions are within a dedicated disposable browser.
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { registerComputerUse } from "../dist/extension.js";
import { nativeWorkerLaunch } from "../dist/launcher.js";
import { computerUseHost } from "./native-host.mjs";

const run = promisify(execFile);
process.env.PI_CU_BROWSER_APP = process.argv[2] ?? "edge";
process.env.PI_CU_BROWSER_VISIBLE = process.argv.includes("--visible")
  ? "true"
  : "false";
const launch = await nativeWorkerLaunch();
let fixture = fileURLToPath(
  new URL("./browser-actions-server.mjs", import.meta.url),
);
if (process.platform !== "win32")
  fixture = (await run("wslpath", ["-w", fixture])).stdout.trim();
const server = spawn(
  launch.executable,
  [fixture, process.env.PI_CU_BROWSER_APP, process.env.PI_CU_BROWSER_VISIBLE],
  {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  },
);
const lines = createInterface({ input: server.stdout });
const source = await new Promise((resolve, reject) => {
  const timer = setTimeout(
    () => reject(new Error("fixture startup timeout")),
    10000,
  );
  lines.once("line", (line) => {
    clearTimeout(timer);
    resolve(JSON.parse(line));
  });
  server.once("error", reject);
});
process.env.PI_CU_SETTINGS_FILE = source.settings;
const host = computerUseHost();
registerComputerUse(host.api);
const call = async (action, args, signal) => {
  const tool = host.tools.get(`windows_computer_use_${action}`);
  assert.ok(tool, action);
  const result = await tool.execute(action, args, signal, undefined, {});
  return result.details;
};
try {
  const opened = await call("set_value", {
    elementId: "new-tab",
    value: source.url,
  });
  assert.equal(opened.ok, true, JSON.stringify(opened));
  const tab = opened.tab.id;
  const find = async (name, role) => {
    const found = await call("find", { browserTab: tab, query: name });
    assert.equal(found.ok, true, JSON.stringify(found));
    const entry = found.results.find(
      (node) => node.id && (!role || node.role === role),
    );
    assert.ok(entry, JSON.stringify(found));
    return entry.id;
  };
  const increment = await find("Increment", "button");
  const clicked = await call("click", { elementId: increment });
  assert.equal(clicked.ok, true, JSON.stringify(clicked));
  assert.match(clicked.text, /Count: 1/);
  assert.equal(clicked.verification, "sent");
  const covering = await find("Cover target", "button");
  assert.equal((await call("click", { elementId: covering })).ok, true);
  const covered = await call("click", { elementId: increment });
  assert.equal(covered.ok, false);
  assert.match(covered.error, /BROWSER_POINT_COVERED/);
  assert.equal(
    (await call("click", { elementId: await find("Remove cover", "button") }))
      .ok,
    true,
  );
  const editor = await find("Editor", "textbox");
  const written = await call("set_value", {
    elementId: editor,
    value: "Hello",
  });
  assert.equal(written.ok, true, JSON.stringify(written));
  assert.equal(
    (await call("element_info", { elementId: editor })).element.value,
    "Hello",
  );
  assert.equal((await call("focus", { elementId: editor })).ok, true);
  assert.equal(
    (await call("type_text", { browserTab: tab, text: " world" })).ok,
    true,
  );
  assert.equal(
    (await call("element_info", { elementId: editor })).element.value,
    "Hello world",
  );
  assert.equal(
    (await call("keypress", { browserTab: tab, keys: ["ctrl", "a"] })).ok,
    true,
  );
  assert.equal(
    (await call("type_text", { browserTab: tab, text: "Replacement" })).ok,
    true,
  );
  assert.equal(
    (await call("element_info", { elementId: editor })).element.value,
    "Replacement",
  );
  const readOnly = await call("set_value", {
    elementId: await find("Read only", "textbox"),
    value: "bad",
  });
  assert.match(readOnly.error, /BROWSER_NOT_EDITABLE/);
  const disabled = await call("click", {
    elementId: await find("Disabled action", "button"),
  });
  assert.match(disabled.error, /BROWSER_ELEMENT_DISABLED/);
  const prompted = await call("click", {
    elementId: await find("Prompt action", "button"),
  });
  assert.equal(prompted.ok, true, JSON.stringify(prompted));
  assert.equal(prompted.dialog.type, "prompt");
  assert.equal(
    (await call("type_text", { browserTab: tab, text: "fixture answer" })).ok,
    true,
  );
  const accepted = await call("keypress", { browserTab: tab, keys: ["enter"] });
  assert.equal(accepted.ok, true, JSON.stringify(accepted));
  assert.match(accepted.text, /Prompt: fixture answer/);
  const color = await find("Color", "combobox");
  assert.equal(
    (await call("set_value", { elementId: color, value: "Green" })).ok,
    true,
  );
  assert.equal(
    (await call("element_info", { elementId: color })).element.value,
    "green",
  );
  assert.match(
    (await call("set_value", { elementId: color, value: "Unavailable" })).error,
    /BROWSER_OPTION_DISABLED/,
  );
  const checkbox = await find("Accept checkbox", "checkbox");
  assert.equal(
    (await call("set_value", { elementId: checkbox, value: "true" })).ok,
    true,
  );
  const scrolled = await call("scroll", { browserTab: tab, deltaY: 600 });
  assert.equal(scrolled.ok, true, JSON.stringify(scrolled));
  assert.ok(scrolled.pageScroll.after[1] > scrolled.pageScroll.before[1]);
  assert.equal(
    (await call("invoke", { elementId: await find("Start delayed", "button") }))
      .ok,
    true,
  );
  const waited = await call("wait_for", {
    browserTab: tab,
    condition: "text",
    query: "Delayed result",
    timeoutMs: 3000,
  });
  assert.equal(waited.verification, "observed", JSON.stringify(waited));
  assert.equal((await call("move", { elementId: increment })).ok, true);
  const doubled = await call("double_click", { elementId: increment });
  assert.equal(doubled.ok, true, JSON.stringify(doubled));
  assert.match(doubled.text, /Count: 3/);
  const confirmed = await call("click", {
    elementId: await find("Confirm action", "button"),
  });
  assert.equal(confirmed.dialog.type, "confirm");
  const dismissed = await call("keypress", {
    browserTab: tab,
    keys: ["escape"],
  });
  assert.equal(dismissed.ok, true, JSON.stringify(dismissed));
  assert.match(dismissed.text, /Confirm: false/);
  const alert = await call("click", {
    elementId: await find("Alert action", "button"),
  });
  assert.equal(alert.dialog.type, "alert");
  assert.equal(
    (await call("keypress", { browserTab: tab, keys: ["enter"] })).ok,
    true,
  );
  const chooser = await call("click", {
    elementId: await find("Upload fixture", "button"),
  });
  assert.ok(chooser.fileChooser?.input, JSON.stringify(chooser));
  const uploaded = await call("set_value", {
    elementId: chooser.fileChooser.input,
    value: source.upload,
  });
  assert.equal(uploaded.ok, true, JSON.stringify(uploaded));
  assert.match(uploaded.text, /Uploaded: fixture-upload.txt/);
  const downloaded = await call("click", {
    elementId: await find("Download fixture", "link"),
  });
  assert.equal(downloaded.ok, true, JSON.stringify(downloaded));
  assert.equal(
    downloaded.downloads?.[0].state,
    "completed",
    JSON.stringify(downloaded),
  );
  assert.equal(downloaded.downloads[0].name, "fixture-download.txt");
  const popup = await call("click", {
    elementId: await find("Open child", "link"),
  });
  assert.equal(popup.ok, true, JSON.stringify(popup));
  assert.ok(popup.openedTabs?.[0].id, JSON.stringify(popup));
  const child = popup.openedTabs[0].id;
  assert.match(
    (await call("accessibility_tree", { browserTab: child })).text,
    /Child fixture/,
  );
  const closed = await call("close_window", { browserTab: child });
  assert.equal(closed.closed, true, JSON.stringify(closed));
  const refusedShortcut = await call("keypress", {
    browserTab: tab,
    keys: ["ctrl", "l"],
  });
  assert.match(refusedShortcut.error, /BROWSER_UI_SHORTCUT/);
  const timedOut = await call("wait_for", {
    browserTab: tab,
    condition: "text",
    query: "never present marker",
    timeoutMs: 100,
    intervalMs: 50,
  });
  assert.ok(
    ["timeout", "inconclusive"].includes(timedOut.verification),
    JSON.stringify(timedOut),
  );
  const cancelled = new AbortController();
  const pending = call(
    "wait_for",
    {
      browserTab: tab,
      condition: "text",
      query: "never present marker",
      timeoutMs: 10000,
    },
    cancelled.signal,
  );
  await new Promise((resolve) => setTimeout(resolve, 100));
  cancelled.abort();
  await assert.rejects(pending, /STOP|CANCEL|abort/i);
  await assert.rejects(call("accessibility_tree", { browserTab: tab }), /STOP/);
  await host.emit("before_agent_start", { messageType: "user" });
  assert.equal(
    (await call("accessibility_tree", { browserTab: tab })).ok,
    true,
  );
  console.log(
    JSON.stringify({
      ok: true,
      check: "Chromium actions/dialogs/transfers/waits",
      browser: process.env.PI_CU_BROWSER_APP,
      physicalInput: false,
      host: process.platform,
    }),
  );
} finally {
  for (const close of host.shutdown) await close();
  lines.close();
  server.stdin.end();
  const timer = setTimeout(() => server.kill(), 3000);
  await new Promise((resolve) => {
    server.once("close", resolve);
    if (server.exitCode !== null) resolve();
  });
  clearTimeout(timer);
}
