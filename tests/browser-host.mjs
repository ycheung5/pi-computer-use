// Isolated installed-browser fixtures only. No physical input/daily profiles.
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { registerComputerUse } from "../dist/extension.js";
import { nativeWorkerLaunch } from "../dist/launcher.js";
import { computerUseHost } from "./native-host.mjs";

const run = promisify(execFile);
const app = process.argv[2] ?? "edge";
process.env.PI_CU_BROWSER_APP = app;
process.env.PI_CU_BROWSER_VISIBLE = process.argv.includes("--headless")
  ? "false"
  : "true";
const launch = await nativeWorkerLaunch();
let serverPath = fileURLToPath(
  new URL("./browser-server.mjs", import.meta.url),
);
if (process.platform !== "win32")
  serverPath = (await run("wslpath", ["-w", serverPath])).stdout.trim();
const server = spawn(
  launch.executable,
  [serverPath, app, process.env.PI_CU_BROWSER_VISIBLE],
  {
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  },
);
const lines = createInterface({ input: server.stdout });
const source = await new Promise((resolve, reject) => {
  const timer = setTimeout(
    () => reject(new Error("Fixture server startup timeout")),
    10000,
  );
  lines.once("line", (line) => {
    clearTimeout(timer);
    resolve(JSON.parse(line));
  });
  server.once("error", reject);
});
const url = source.url;
process.env.PI_CU_SETTINGS_FILE = source.settings;
process.env.WSLENV = `${process.env.WSLENV ?? ""}:PI_CU_SETTINGS_FILE:PI_CU_BROWSER_EXECUTABLE`;
const host = computerUseHost();
registerComputerUse(host.api);
const client = {
  async execute(action, args, signal) {
    const tool = host.tools.get(`windows_computer_use_${action}`);
    assert.ok(tool, `${action} is registered through Pi`);
    const result = await tool.execute(
      `fixture-${action}`,
      args,
      signal,
      undefined,
      {},
    );
    const image = result.content.find((block) => block.type === "image");
    if (image) {
      assert.ok(
        !result.content
          .filter((block) => block.type === "text")
          .some((block) => block.text.includes(image.data)),
        "PNG payload stays out of text",
      );
      return {
        ...result.details,
        screenshot: { ...result.details.screenshot, base64: image.data },
      };
    }
    return result.details;
  },
  async dispose() {
    for (const handler of host.shutdown) await handler();
  },
};
const foreground = async () => {
  const script =
    "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class PiBrowserProbe { [DllImport(\"user32.dll\")] public static extern IntPtr GetForegroundWindow(); }'; [Console]::Write([PiBrowserProbe]::GetForegroundWindow().ToInt64())";
  return (
    await run("powershell.exe", [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(script, "utf16le").toString("base64"),
    ])
  ).stdout.trim();
};
try {
  const before = await foreground();
  const opened = await client.execute("set_value", {
    elementId: "new-tab",
    value: url,
  });
  assert.equal(opened.ok, true, JSON.stringify(opened));
  const tab = opened.tab.id;
  const launched = (await client.execute("list_windows", {})).browserLane
    .browsers[0];
  assert.equal(launched.app, process.env.PI_CU_BROWSER_APP);
  assert.match(launched.version, /\d+\./);
  assert.match(
    launched.executable,
    process.env.PI_CU_BROWSER_APP === "firefox"
      ? /firefox\.exe$/i
      : process.env.PI_CU_BROWSER_APP === "edge"
        ? /msedge\.exe$/i
        : /chrome\.exe$/i,
  );
  assert.equal(
    launched.headless,
    process.env.PI_CU_BROWSER_APP === "firefox" ||
      process.env.PI_CU_BROWSER_VISIBLE === "false",
  );

  const tree = await client.execute("accessibility_tree", { browserTab: tab });
  assert.equal(tree.ok, true, JSON.stringify(tree));
  assert.match(tree.text, /Fixture heading/);
  const listing = await client.execute("list_windows", {});
  assert.equal(listing.browserLane.browsers[0].tabs[0].id, tab);
  assert.equal(listing.browserLane.browsers[0].app, app);
  const found = await client.execute("find", {
    browserTab: tab,
    query: "Fixture editor",
  });
  assert.equal(found.ok, true, JSON.stringify(found));
  const input = found.results.find((entry) => entry.role === "textbox");
  assert.ok(input?.id, JSON.stringify(found));
  const info = await client.execute("element_info", { elementId: input.id });
  assert.equal(info.ok, true, JSON.stringify(info));
  assert.equal(info.element.value, "fixture text");
  assert.equal(info.element.disabled, false);
  assert.equal(info.element.readonly, false);
  for (const [query, property] of [
    ["Disabled editor", "disabled"],
    ["Read-only editor", "readonly"],
    ["ARIA disabled editor", "disabled"],
    ["ARIA read-only editor", "readonly"],
  ]) {
    const matches = await client.execute("find", { browserTab: tab, query });
    const target = matches.results.find((entry) => entry.role === "textbox");
    assert.ok(target?.id, JSON.stringify(matches));
    const detail = await client.execute("element_info", {
      elementId: target.id,
    });
    assert.equal(detail.ok, true, JSON.stringify(detail));
    assert.equal(
      detail.element[property],
      true,
      `${query} exposes ${property}`,
    );
  }
  const checkboxMatches = await client.execute("find", {
    browserTab: tab,
    query: "Checkbox with ignored readonly",
  });
  const checkbox = checkboxMatches.results.find(
    (entry) => entry.role === "checkbox",
  );
  assert.ok(checkbox?.id, JSON.stringify(checkboxMatches));
  const checkboxInfo = await client.execute("element_info", {
    elementId: checkbox.id,
  });
  assert.equal(checkboxInfo.ok, true, JSON.stringify(checkboxInfo));
  assert.equal(
    "readonly" in checkboxInfo.element,
    false,
    "HTML readonly does not apply to checkbox inputs",
  );
  const shot = await client.execute("screenshot", {
    browserTab: tab,
    maxWidth: 300,
  });
  assert.equal(shot.ok, true, JSON.stringify(shot));
  const png = Buffer.from(shot.screenshot.base64, "base64");
  assert.equal(png.readUInt32BE(16), shot.screenshot.width);
  if (app === "firefox") {
    assert.match(shot.screenshot.limitation, /ignores maxWidth/);
    assert.equal(tree.source, "browser-dom-heuristic");
    assert.equal(listing.browserLane.browsers[0].visible, false);
  } else
    assert.ok(shot.screenshot.width <= 300, "browser image respects maxWidth");
  assert.equal(shot.screenshot.coordinateSpace, "page");
  const after = await foreground();
  assert.equal(
    after,
    before,
    "visible browser reading does not steal the foreground",
  );
  const changed = await client.execute("set_value", {
    elementId: `${tab}:address`,
    value: `${url}second`,
  });
  assert.equal(changed.ok, true, JSON.stringify(changed));
  const stale = await client.execute("element_info", { elementId: input.id });
  assert.equal(stale.ok, false);
  assert.match(stale.error, /STALE_BROWSER_REFERENCE/);
  const browserPid = listing.browserLane.browsers[0].processId;
  assert.ok(browserPid);
  await run("taskkill.exe", ["/PID", String(browserPid), "/T", "/F"]);
  const deadline = Date.now() + 5000;
  let disconnected;
  do {
    disconnected = await client.execute("list_windows", {});
    if (disconnected.browserLane.browsers.length === 0) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  assert.equal(
    disconnected.browserLane.browsers.length,
    0,
    "disconnected tabs withdrawn",
  );
  const missing = await client.execute("accessibility_tree", {
    browserTab: tab,
  });
  assert.match(missing.error, /STALE_BROWSER_REFERENCE/);
  const reopened = await client.execute("set_value", {
    elementId: "new-tab",
    value: url,
  });
  assert.equal(reopened.ok, true, JSON.stringify(reopened));
  assert.notEqual(
    reopened.tab.id,
    tab,
    "reconnect never aliases old tab identity",
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    client.execute(
      "accessibility_tree",
      { browserTab: tab },
      controller.signal,
    ),
  );
  console.log(
    JSON.stringify({
      ok: true,
      app,
      host: process.platform,
      visible: process.env.PI_CU_BROWSER_VISIBLE !== "false",
      reading: true,
      screenshots: true,
      foregroundPreserved: true,
      staleRejected: true,
      reconnect: true,
      piTools: true,
      isolated: true,
    }),
  );
} finally {
  await client.dispose();
  lines.close();
  server.stdin.end();
  const timer = setTimeout(() => server.kill(), 3000);
  await once(server, "close").catch(() => undefined);
  clearTimeout(timer);
}
