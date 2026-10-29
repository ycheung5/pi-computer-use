// Read-only UIA against an isolated Chromium fixture. No daily profile/input.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { WorkerClient } from "../dist/client.js";

assert.equal(process.platform, "win32", "Run with Windows Node after build");
const folder = await mkdtemp(join(tmpdir(), "pi-cu-chromium-uia-"));
const title = `Pi Chromium fixture ${Date.now()}`;
const html = join(folder, "page.html");
await writeFile(
  html,
  `<!doctype html><title>${title}</title><h1>Fixture page heading</h1><label>Fixture browser editor<input value="browser fixture text"></label><button>Fixture browser action</button>`,
);
const candidates = [
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
const browser = spawn(
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
    `--app=${pathToFileURL(html).href}`,
  ],
  { stdio: ["ignore", "ignore", "pipe"], windowsHide: true, cwd: folder },
);
const worker = new WorkerClient({
  launch: async () => ({
    executable: process.execPath,
    args: [fileURLToPath(new URL("../dist/worker.js", import.meta.url))],
    cwd: folder,
  }),
});
try {
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
  console.log(
    JSON.stringify({
      ok: true,
      check: "Chromium accessibility lazy warm-up",
      browser: executable.includes("msedge") ? "edge" : "chrome",
      state: result.webContent.state,
      physicalInput: false,
    }),
  );
} finally {
  await worker.dispose();
  if (browser.pid)
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
