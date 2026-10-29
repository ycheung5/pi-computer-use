// Native Windows fixture only: an explicitly owned external Firefox process.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";
import { registerComputerUse } from "../dist/extension.js";
import { computerUseHost } from "./native-host.mjs";

assert.equal(process.platform, "win32", "run with Windows Node");
assert.ok(
  process.env.PI_CU_BROWSER_EXECUTABLE,
  "provide installed Firefox executable",
);
const directory = await mkdtemp(join(tmpdir(), "pi-firefox-endpoint-"));
let browser;
let child;
const host = computerUseHost();
try {
  browser = await puppeteer.launch({
    browser: "firefox",
    executablePath: process.env.PI_CU_BROWSER_EXECUTABLE,
    headless: true,
    userDataDir: join(directory, "profile"),
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
  });
  child = browser.process();
  const endpoint = browser.wsEndpoint();
  await browser.disconnect();
  process.env.PI_CU_SETTINGS_FILE = join(directory, "settings.json");
  await writeFile(
    process.env.PI_CU_SETTINGS_FILE,
    JSON.stringify({ browserApp: "firefox", browserSignIn: false }),
  );
  const denied = computerUseHost();
  process.env.PI_CU_BROWSER_BIDI_URL = "ws://example.com/session";
  registerComputerUse(denied.api);
  try {
    const invalid = await denied.tools
      .get("windows_computer_use_set_value")
      .execute(
        "invalid-endpoint",
        { elementId: "new-tab", value: "about:blank" },
        undefined,
        undefined,
        {},
      );
    assert.match(invalid.details.error, /BROWSER_ENDPOINT/);
  } finally {
    for (const close of denied.shutdown) await close();
  }
  process.env.PI_CU_BROWSER_BIDI_URL = endpoint;
  registerComputerUse(host.api);
  const result = await host.tools.get("windows_computer_use_set_value").execute(
    "external",
    {
      elementId: "new-tab",
      value: "data:text/html,<h1>External isolated Firefox</h1>",
    },
    undefined,
    undefined,
    {},
  );
  assert.equal(result.details.ok, true, JSON.stringify(result.details));
  assert.match(result.details.text, /External isolated Firefox/);
  for (const close of host.shutdown) await close();
  host.shutdown.length = 0;
  assert.equal(
    child.exitCode,
    null,
    "disconnect must not close externally owned Firefox",
  );
  process.kill(child.pid, 0);
  console.log(
    JSON.stringify({
      ok: true,
      check: "explicit loopback Firefox endpoint; process preserved",
    }),
  );
} finally {
  for (const close of host.shutdown) await close();
  if (child && child.exitCode === null) child.kill();
  await rm(directory, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  });
}
