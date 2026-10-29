// Isolated installed-browser fixtures only. No physical input/daily profiles.
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { WorkerClient } from "../dist/client.js";
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
const server = spawn(launch.executable, [serverPath], {
  windowsHide: true,
  stdio: ["pipe", "pipe", "pipe"],
});
const lines = createInterface({ input: server.stdout });
const url = await new Promise((resolve, reject) => {
  const timer = setTimeout(
    () => reject(new Error("Fixture server startup timeout")),
    10000,
  );
  lines.once("line", (line) => {
    clearTimeout(timer);
    resolve(line);
  });
  server.once("error", reject);
});
const client = new WorkerClient({ launch: nativeWorkerLaunch });
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
  const tree = await client.execute("accessibility_tree", { browserTab: tab });
  assert.equal(tree.ok, true, JSON.stringify(tree));
  assert.match(tree.text, /Fixture heading/);
  const listing = await client.execute("list_windows", {});
  assert.equal(listing.browserLane.browsers[0].tabs[0].id, tab);
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
  const shot = await client.execute("screenshot", {
    browserTab: tab,
    maxWidth: 300,
  });
  assert.equal(shot.ok, true, JSON.stringify(shot));
  const png = Buffer.from(shot.screenshot.base64, "base64");
  assert.equal(png.readUInt32BE(16), shot.screenshot.width);
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
