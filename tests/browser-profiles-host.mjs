// Pi tool/worker seam; disposable cookie origin and dedicated profile storage.
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const app = process.argv[2] ?? "edge";
const reconnect = process.argv.includes("--reconnect");
assert.ok(
  ["edge", "chrome", "firefox"].includes(app),
  "Use edge, chrome or firefox",
);
if (reconnect)
  assert.ok(
    ["edge", "chrome"].includes(app),
    "Reconnect fixture currently supports Chromium only",
  );
if (process.argv.includes("--plan")) {
  assert.ok(reconnect, "Use --plan with --reconnect");
  console.log(
    JSON.stringify({
      executed: false,
      mode: "same-worker-reconnect",
      app,
      physicalInput: false,
      dailyProfile: false,
    }),
  );
  process.exit(0);
}
const [{ registerComputerUse }, { nativeWorkerLaunch }, { computerUseHost }] =
  await Promise.all([
    import("../dist/extension.js"),
    import("../dist/launcher.js"),
    import("./native-host.mjs"),
  ]);
const launch = await nativeWorkerLaunch();
let serverPath = fileURLToPath(
  new URL("./browser-profiles-server.mjs", import.meta.url),
);
if (process.platform !== "win32")
  serverPath = (await run("wslpath", ["-w", serverPath])).stdout.trim();
const server = spawn(launch.executable, [serverPath, app], {
  windowsHide: true,
  stdio: ["pipe", "pipe", "pipe"],
});
const lines = createInterface({ input: server.stdout });
const source = await new Promise((resolve, reject) => {
  const timeout = setTimeout(
    () => reject(new Error("fixture startup timeout")),
    10000,
  );
  lines.once("line", (line) => {
    clearTimeout(timeout);
    resolve(JSON.parse(line));
  });
  server.once("error", reject);
});
process.env.PI_CU_SETTINGS_FILE = source.settings;
process.env.PI_CU_BROWSER_PROFILE_ROOT = source.root;
process.env.WSLENV = `${process.env.WSLENV ?? ""}:PI_CU_SETTINGS_FILE:PI_CU_BROWSER_EXECUTABLE:PI_CU_BROWSER_PROFILE_ROOT:PI_CU_BROWSER_IDLE_MS`;
const hosts = [];
function create() {
  const host = computerUseHost();
  host.commands = new Map();
  host.api.registerCommand = (name, definition) =>
    host.commands.set(name, definition);
  registerComputerUse(host.api);
  hosts.push(host);
  return host;
}
async function call(host, action, args = {}) {
  const result = await host.tools
    .get(`windows_computer_use_${action}`)
    .execute(action, args, undefined, undefined, {});
  return result.details;
}
async function close(host) {
  for (const handler of host.shutdown) await handler();
  host.shutdown.length = 0;
}
async function fixture(request) {
  const response = await new Promise((resolve, reject) => {
    const deadline = setTimeout(
      () => reject(new Error("profile fixture timeout")),
      20000,
    );
    lines.once("line", (line) => {
      clearTimeout(deadline);
      try {
        resolve(JSON.parse(line));
      } catch (error) {
        reject(error);
      }
    });
    server.stdin.write(JSON.stringify(request) + "\n");
  });
  assert.equal(response.ok, true, JSON.stringify(response));
  return response;
}
async function open(host, path) {
  const result = await call(host, "set_value", {
    elementId: "new-tab",
    value: source.url + path,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  return result;
}
let reconnectReport;
try {
  if (reconnect) {
    const host = create();
    const original = await open(host, "/set");
    assert.match((await open(host, "/read")).text, /Cookie: remembered/);
    const workerPid = (await call(host, "health")).processId;
    const first = await fixture({ action: "inspect-profile", workerPid });
    assert.equal(first.profile.kept, true);
    await host.emit("agent_settled", { aborted: false });
    const closed = await fixture({
      action: "close-owned-browser",
      browser: first,
      workerPid,
    });
    assert.equal(closed.ok, true, JSON.stringify(closed));
    assert.equal(closed.oldRootAbsent, true);
    assert.equal(
      (await call(host, "health")).processId,
      workerPid,
      "worker remains alive after its browser closes",
    );
    const resumed = await open(host, "/read");
    assert.match(resumed.text, /Cookie: remembered/);
    const next = await fixture({ action: "inspect-profile", workerPid });
    assert.notEqual(next.processId, first.processId);
    assert.notEqual(next.creationDate, first.creationDate);
    assert.notEqual(resumed.tab.id, original.tab.id);
    const stale = await call(host, "accessibility_tree", {
      browserTab: original.tab.id,
    });
    assert.equal(
      stale.ok,
      false,
      "old tab must not silently target the replacement browser",
    );
    assert.equal(next.profile.path, first.profile.path);
    assert.equal((await call(host, "health")).processId, workerPid);
    await close(host);
    const cleanup = await run(launch.executable, [
      "--input-type=module",
      "-e",
      `import{readdir,access}from'node:fs/promises';for(const id of process.argv.slice(2).map(Number)){try{process.kill(id,0)}catch(error){if(error.code==='ESRCH')continue;throw error}throw new Error('OWNED_BROWSER_STILL_ALIVE:'+id)}try{await access(process.argv[1]+'.lock');throw new Error('PROFILE_LOCK_RETAINED')}catch(error){if(error.code!=='ENOENT')throw error}await access(process.argv[1]);console.log(JSON.stringify({oldAndNewRootsAbsent:true,keptProfilePresent:true,lockAbsent:true}))`,
      next.profile.path,
      String(first.processId),
      String(next.processId),
    ]);
    reconnectReport = {
      ok: true,
      app,
      mode: "same-worker-reconnect",
      workerPid,
      first,
      next,
      closeFixture: closed,
      staleError: stale.error,
      cookiePersisted: true,
      cleanup: JSON.parse(cleanup.stdout),
    };
  } else if (process.argv.includes("--temporary-crash")) {
    let host = create();
    const notifications = [];
    await host.commands
      .get("computer-settings")
      .handler('set {"browserSignIn":false}', {
        ui: {
          notify: (message, type) => notifications.push({ message, type }),
        },
      });
    assert.ok(
      notifications.length &&
        notifications.every((entry) => entry.type !== "error"),
      JSON.stringify(notifications),
    );
    await open(host, "/read");
    const previous = (await call(host, "list_windows")).browserLane.browsers[0];
    const workerPid = (await call(host, "health")).processId;
    await host.emit("agent_settled", { aborted: false });
    await run("taskkill.exe", ["/PID", String(workerPid), "/F"]);
    await close(host);
    const check = await run(launch.executable, [
      "--input-type=module",
      "-e",
      "try{process.kill(Number(process.argv[1]),0);console.log('alive')}catch{console.log('dead')}",
      String(previous.processId),
    ]);
    if (check.stdout.trim() === "alive")
      await run("taskkill.exe", [
        "/PID",
        String(previous.processId),
        "/T",
        "/F",
      ]);
    host = create();
    await open(host, "/read");
    await run(launch.executable, [
      "--input-type=module",
      "-e",
      "import {access} from 'node:fs/promises';try{await access(process.argv[1]);process.exitCode=1}catch(error){if(error.code!=='ENOENT')throw error}",
      previous.profile.path,
    ]);
    console.log(JSON.stringify({ ok: true, app, staleTemporaryCleaned: true }));
  } else {
    let host = create();
    await open(host, "/set");
    assert.match((await open(host, "/read")).text, /Cookie: remembered/);
    const first = (await call(host, "list_windows")).browserLane.browsers[0];
    assert.equal(first.app, app);
    assert.match(first.version, /\d+\./);
    assert.match(
      first.executable,
      app === "firefox"
        ? /firefox\.exe$/i
        : app === "edge"
          ? /msedge\.exe$/i
          : /chrome\.exe$/i,
    );
    assert.equal(first.headless, true);
    assert.equal(first.profile.kept, true);
    assert.ok(first.profile.path.startsWith(source.root));
    await close(host);
    host = create();
    assert.match(
      (await open(host, "/read")).text,
      /Cookie: remembered/,
      "opted-in cookies survive worker restart",
    );
    await host.emit("agent_settled", { aborted: false });
    const competitor = create();
    const busy = await call(competitor, "set_value", {
      elementId: "new-tab",
      value: `${source.url}/read`,
    });
    assert.match(
      busy.error,
      /BROWSER_PROFILE_BUSY/,
      "a second controller cannot take the live kept profile",
    );
    await close(competitor);
    assert.match((await open(host, "/read")).text, /Cookie: remembered/);
    await close(host);
    process.env.PI_CU_BROWSER_IDLE_MS = "3000";
    host = create();
    const beforeIdle = await open(host, "/read");
    assert.match(beforeIdle.text, /Cookie: remembered/);
    const activeWait = await call(host, "wait_for", {
      browserTab: beforeIdle.tab.id,
      condition: "text",
      query: "absent fixture marker",
      timeoutMs: 4000,
      intervalMs: 100,
    });
    assert.equal(
      activeWait.verification,
      "timeout",
      JSON.stringify(activeWait),
    );
    await new Promise((resolve) => setTimeout(resolve, 4200));
    const retired = await call(host, "list_windows");
    assert.equal(
      retired.browserLane.browsers.length,
      0,
      "idle browser retires without keeping a worker active forever",
    );
    const resumed = await open(host, "/read");
    assert.notEqual(resumed.tab.id, beforeIdle.tab.id);
    assert.match(
      resumed.text,
      /Cookie: remembered/,
      "idle close flushes kept cookies",
    );
    await close(host);
    process.env.PI_CU_BROWSER_IDLE_MS = "600000";
    host = create();
    await open(host, "/read");
    const crashing = (await call(host, "list_windows")).browserLane.browsers[0];
    const workerPid = (await call(host, "health")).processId;
    await host.emit("agent_settled", { aborted: false });
    await run("taskkill.exe", ["/PID", String(workerPid), "/F"]);
    await close(host);
    const aliveResult = await run(launch.executable, [
      "--input-type=module",
      "-e",
      "try{process.kill(Number(process.argv[1]),0);console.log('alive')}catch{console.log('dead')}",
      String(crashing.processId),
    ]);
    const liveOrphan = aliveResult.stdout.trim() === "alive";
    const orphanCheck = create();
    const orphan = await call(orphanCheck, "set_value", {
      elementId: "new-tab",
      value: `${source.url}/read`,
    });
    if (liveOrphan)
      assert.match(
        orphan.error,
        /BROWSER_PROFILE_BUSY.*still alive/,
        JSON.stringify(orphan),
      );
    else assert.equal(orphan.ok, true, JSON.stringify(orphan));
    await close(orphanCheck);
    if (liveOrphan)
      await run("taskkill.exe", [
        "/PID",
        String(crashing.processId),
        "/T",
        "/F",
      ]);
    host = create();
    await open(host, "/read");
    const recovered = (await call(host, "list_windows")).browserLane
      .browsers[0];
    assert.equal(
      recovered.profile.path,
      crashing.profile.path,
      "confirmed dead owner and browser can recover the dedicated profile",
    );
    await close(host);
    host = create();
    const notifications = [];
    await host.commands
      .get("computer-settings")
      .handler('set {"browserSignIn":false}', {
        ui: {
          notify: (message, type) => notifications.push({ message, type }),
        },
      });
    assert.ok(
      notifications.length &&
        notifications.every((entry) => entry.type !== "error"),
      JSON.stringify(notifications),
    );
    await open(host, "/set");
    assert.match((await open(host, "/read")).text, /Cookie: remembered/);
    const temporary = (await call(host, "list_windows")).browserLane
      .browsers[0];
    assert.equal(temporary.profile.kept, false);
    await close(host);
    await run(launch.executable, [
      "--input-type=module",
      "-e",
      "import {access} from 'node:fs/promises';try{await access(process.argv[1]);process.exitCode=1}catch(error){if(error.code!=='ENOENT')throw error}",
      temporary.profile.path,
    ]);
    host = create();
    assert.match(
      (await open(host, "/read")).text,
      /Cookie: missing/,
      "temporary context does not remember cookies",
    );
    await close(host);
    console.log(
      JSON.stringify({
        ok: true,
        app,
        keptCookie: true,
        temporaryCleaned: true,
        temporaryCookieIsolated: true,
        idleRetirement: true,
        activeWaitProtected: true,
        liveProfileRefused: true,
        liveOrphanRefused: liveOrphan,
        crashClosedBrowser: !liveOrphan,
        staleProfileRecovered: true,
      }),
    );
  }
} finally {
  for (const host of hosts) await close(host);
  lines.close();
  server.stdin.end();
  const timer = reconnect ? undefined : setTimeout(() => server.kill(), 5000);
  await new Promise((resolve) => {
    server.once("close", resolve);
    if (server.exitCode !== null) resolve();
  });
  clearTimeout(timer);
  if (reconnect)
    assert.equal(
      server.exitCode,
      0,
      "fixture must confirm owned storage cleanup",
    );
}

if (reconnectReport)
  console.log(
    JSON.stringify({ ...reconnectReport, fixtureStorageRemoved: true }),
  );
