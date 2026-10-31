// Native Windows fixture only: an explicitly owned external Firefox process.
import assert from "node:assert/strict";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";
import { registerComputerUse } from "../dist/extension.js";
import { computerUseHost } from "./native-host.mjs";
import { ReferenceClient, referenceResult } from "./reference-client.mjs";

assert.equal(process.platform, "win32", "run with Windows Node");
assert.ok(
  process.env.PI_CU_BROWSER_EXECUTABLE,
  "provide installed Firefox executable",
);
const directory = await mkdtemp(join(tmpdir(), "pi-firefox-endpoint-"));
const server = createServer((request, response) => {
  if (request.url === "/set")
    response.setHeader(
      "Set-Cookie",
      "pi_external_fixture=remembered; Path=/; Max-Age=3600; HttpOnly; SameSite=Lax",
    );
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.end(
    `<title>${request.url === "/set" ? "Pre-existing external fixture" : request.url === "/reference" ? "Reference external fixture" : "New external fixture"}</title><h1>External Firefox fixture</h1><p>Cookie: ${request.headers.cookie?.includes("pi_external_fixture=remembered") ? "remembered" : "missing"}</p>`,
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
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
  const existing = await browser.newPage();
  await existing.goto(`${origin}/set`);
  await browser.disconnect();
  process.env.PI_CU_BROWSER_PROFILE_ROOT = join(directory, "worker-profiles");
  process.env.PI_CU_SETTINGS_FILE = join(directory, "settings.json");
  await writeFile(
    process.env.PI_CU_SETTINGS_FILE,
    JSON.stringify({ browserApp: "firefox", browserSignIn: true }),
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
  const listing = await host.tools
    .get("windows_computer_use_list_windows")
    .execute("discover", {}, undefined, undefined, {});
  assert.ok(
    listing.details.browserLane.browsers[0].tabs.some(
      (tab) => tab.title === "Pre-existing external fixture",
    ),
    JSON.stringify(listing.details),
  );
  assert.equal(listing.details.browserLane.browsers[0].profile.external, true);
  const result = await host.tools.get("windows_computer_use_set_value").execute(
    "external",
    {
      elementId: "new-tab",
      value: `${origin}/read`,
    },
    undefined,
    undefined,
    {},
  );
  assert.equal(result.details.ok, true, JSON.stringify(result.details));
  assert.match(result.details.text, /Cookie: remembered/);
  for (const close of host.shutdown) await close();
  host.shutdown.length = 0;
  assert.equal(
    child.exitCode,
    null,
    "disconnect must not close externally owned Firefox",
  );
  process.kill(child.pid, 0);
  browser = await puppeteer.connect({
    browserWSEndpoint: endpoint,
    protocol: "webDriverBiDi",
  });
  const titles = await Promise.all(
    (await browser.pages()).map((page) => page.title()),
  );
  assert.ok(
    titles.includes("Pre-existing external fixture"),
    JSON.stringify(titles),
  );
  assert.ok(titles.includes("New external fixture"), JSON.stringify(titles));
  await browser.disconnect();
  await assert.rejects(
    access(process.env.PI_CU_BROWSER_PROFILE_ROOT),
    { code: "ENOENT" },
    "external endpoint must not create or acquire an owned profile",
  );
  let referenceEvidence;
  if (process.argv[2]) {
    const referenceClient = new ReferenceClient(process.argv[2], {
      cwd: directory,
      env: {
        WCU_BROWSER_APP: "firefox",
        WCU_BROWSER_EXE: process.env.PI_CU_BROWSER_EXECUTABLE,
        WCU_BROWSER_HEADLESS: "1",
        WCU_BROWSER_SIGNIN: "0",
        WCU_BROWSER_BIDI_URL: endpoint,
        WCU_BROWSER_PROFILE: join(directory, "reference-profiles"),
      },
    });
    try {
      await referenceClient.init();
      const listing = referenceResult(
        await referenceClient.call("list_windows", { maxWindows: 1 }),
      );
      assert.equal(listing.ok, true, JSON.stringify(listing));
      assert.ok(
        listing.browserLane.browsers
          .flatMap((x) => x.tabs)
          .some((x) => x.url === `${origin}/set`),
        JSON.stringify(listing.browserLane),
      );
      const opened = referenceResult(
        await referenceClient.call("set_value", {
          elementId: "new-tab",
          value: `${origin}/reference`,
        }),
      );
      assert.equal(opened.ok, true, JSON.stringify(opened));
      const outlinedRaw = await referenceClient.call("accessibility_tree", {
        browserTab: (opened.tab ?? opened.opened).id,
      });
      assert.match(
        outlinedRaw.content
          .filter((x) => x.type === "text")
          .map((x) => x.text)
          .join("\n"),
        /Cookie: remembered/,
      );
      referenceEvidence = {
        existingTabDiscovered: true,
        cookieShared: true,
        listedTabs: listing.browserLane.browsers.flatMap((x) => x.tabs),
      };
    } finally {
      await referenceClient.close();
    }
    process.kill(child.pid, 0);
    browser = await puppeteer.connect({
      browserWSEndpoint: endpoint,
      protocol: "webDriverBiDi",
    });
    const preserved = await Promise.all(
      (await browser.pages()).map((page) => page.title()),
    );
    for (const expected of [
      "Pre-existing external fixture",
      "New external fixture",
      "Reference external fixture",
    ])
      assert.ok(preserved.includes(expected), JSON.stringify(preserved));
    referenceEvidence.tabsPreserved = preserved;
    referenceEvidence.externalProcessAlive = true;
    await browser.disconnect();
    await assert.rejects(access(join(directory, "reference-profiles")), {
      code: "ENOENT",
    });
    referenceEvidence.noOwnedProfileCreated = true;
  }
  console.log(
    JSON.stringify({
      ok: true,
      reference: referenceEvidence,
      check:
        "explicit loopback Firefox endpoint; existing/new tabs, cookies and process preserved",
    }),
  );
} finally {
  for (const close of host.shutdown) await close();
  if (browser?.connected) await browser.disconnect();
  if (child && child.exitCode === null) child.kill();
  await new Promise((resolve) => server.close(resolve));
  await rm(directory, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  });
}
