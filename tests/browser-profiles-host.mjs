// Pi tool/worker seam; disposable cookie origin and dedicated profile storage.
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const app = process.argv[2] ?? "edge";
const reconnect = process.argv.includes("--reconnect");
const disposeOnly = process.argv.includes("--dispose-only");
const cleanupControlMode = process.argv.includes("--cleanup-control");
assert.ok(
  ["edge", "chrome", "firefox"].includes(app),
  "Use edge, chrome or firefox",
);
if (disposeOnly)
  assert.ok(
    app === "firefox" &&
      !reconnect &&
      !cleanupControlMode &&
      !process.argv.includes("--temporary-crash"),
    "Disposal mode requires firefox and no other scenario",
  );
if (reconnect)
  assert.ok(
    ["edge", "chrome"].includes(app),
    "Reconnect fixture currently supports Chromium only",
  );
if (process.argv.includes("--plan")) {
  assert.ok(
    reconnect || cleanupControlMode || disposeOnly,
    "Use --plan with --reconnect, --cleanup-control or --dispose-only",
  );
  console.log(
    JSON.stringify({
      executed: false,
      mode: disposeOnly
        ? "temporary-profile-disposal"
        : cleanupControlMode
          ? "missing-lease-cleanup-control"
          : "same-worker-reconnect",
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
const server = spawn(
  launch.executable,
  [serverPath, app, ...(disposeOnly ? ["--dispose-only"] : [])],
  {
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  },
);
let serverErrors = "";
server.stderr.setEncoding("utf8");
server.stderr.on("data", (chunk) => {
  serverErrors += chunk;
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
if (disposeOnly) {
  console.log(JSON.stringify({ phase: "fixture-ready", source }));
  await verifyDisposal();
  process.exit(0);
}
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
      40000,
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
let cleanupControl;
try {
  if (cleanupControlMode) {
    cleanupControl = await fixture({ action: "arm-cleanup-control" });
  } else if (reconnect) {
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
    assert.match(String(stale.error), /STALE_BROWSER_REFERENCE/);
    assert.equal(next.profile.path, first.profile.path);
    assert.equal((await call(host, "health")).processId, workerPid);
    await close(host);
    const cleanup = await run(launch.executable, [
      "--input-type=module",
      "-e",
      `import{access}from'node:fs/promises';for(const id of process.argv.slice(2).map(Number)){try{process.kill(id,0)}catch(error){if(error.code==='ESRCH')continue;throw error}throw new Error('OWNED_BROWSER_STILL_ALIVE:'+id)}try{await access(process.argv[1]+'.lock');throw new Error('PROFILE_LOCK_RETAINED')}catch(error){if(error.code!=='ENOENT')throw error}await access(process.argv[1]);console.log(JSON.stringify({browserAndWorkerRootsAbsent:true,keptProfilePresent:true,lockAbsent:true}))`,
      next.profile.path,
      String(first.processId),
      String(next.processId),
      String(workerPid),
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
  const timer =
    reconnect || cleanupControlMode
      ? undefined
      : setTimeout(() => server.kill(), 5000);
  await new Promise((resolve) => {
    server.once("close", resolve);
    if (server.exitCode !== null) resolve();
  });
  clearTimeout(timer);
  if (cleanupControlMode) {
    console.log(
      JSON.stringify({
        cleanupControl,
        fixtureExit: server.exitCode,
        fixtureErrors: serverErrors,
      }),
    );
    assert.equal(
      server.exitCode,
      1,
      "live recorded root must block missing-lease deletion",
    );
    assert.match(serverErrors, /PROFILE_CLEANUP_BLOCKED/);
  }
  if (reconnect)
    assert.equal(
      server.exitCode,
      0,
      `fixture must confirm owned storage cleanup: ${serverErrors}`,
    );
}

if (reconnectReport)
  console.log(
    JSON.stringify({ ...reconnectReport, fixtureStorageRemoved: true }),
  );

if (cleanupControlMode) {
  const verified = await run(launch.executable, [
    "--input-type=module",
    "-e",
    `import{readFile,rm}from'node:fs/promises';import{join}from'node:path';const text=await readFile(join(process.argv[1],'canary.txt'),'utf8');if(text!=='owned cleanup canary')throw new Error('CANARY_CHANGED');try{process.kill(Number(process.argv[3]),0);throw new Error('CONTROL_CHILD_ALIVE')}catch(error){if(error.code!=='ESRCH')throw error}await rm(process.argv[2],{recursive:true,force:true});console.log(JSON.stringify({retainedCanary:true,childExitedAfterRefusal:true,storageRemovedAfterChildExit:true}))`,
    cleanupControl.profile,
    cleanupControl.directory,
    String(cleanupControl.processId),
  ]);
  console.log(
    JSON.stringify({
      ok: true,
      mode: "missing-lease-cleanup-control",
      ...JSON.parse(verified.stdout),
    }),
  );
}

async function verifyDisposal() {
  const { WorkerClient } = await import("../dist/client.js");
  const client = new WorkerClient({ launch: nativeWorkerLaunch });
  try {
    console.log(JSON.stringify({ phase: "before-health" }));
    const health = await client.execute("health", {});
    console.log(
      JSON.stringify({ phase: "health", processId: health.processId }),
    );
    assert.equal(health.ok, true, JSON.stringify(health));
    console.log(JSON.stringify({ phase: "before-open" }));
    const opened = await client.execute("set_value", {
      elementId: "new-tab",
      value: source.url + "/read",
    });
    assert.equal(opened.ok, true, JSON.stringify(opened));
    assert.ok(opened.tab?.id);
    console.log(JSON.stringify({ phase: "before-read" }));
    const read = await client.execute("accessibility_tree", {
      browserTab: opened.tab.id,
    });
    assert.equal(read.ok, true, JSON.stringify(read));
    assert.match(read.text, /Profile fixture/);
    console.log(JSON.stringify({ phase: "before-inspection" }));
    const before = await fixture({
      action: "inspect-disposal",
      workerPid: health.processId,
    });
    console.log(JSON.stringify({ phase: "owned-before-disposal", before }));
    await client.dispose();
    console.log(JSON.stringify({ phase: "before-cleanup-verification" }));
    const after = await fixture({ action: "verify-disposal" });
    lines.close();
    const exited = new Promise((resolve) => server.once("close", resolve));
    server.stdin.end();
    await exited;
    assert.equal(server.exitCode, 0, serverErrors);
    const retired = await run(launch.executable, [
      "--input-type=module",
      "-e",
      `import {execFileSync} from "node:child_process"; import {access} from "node:fs/promises"; import {dirname} from "node:path"; const pid=Number(process.argv[1]); if(!Number.isSafeInteger(pid)||pid<1)throw Error("INVALID_FIXTURE_PID");const ps="$ErrorActionPreference='Stop';$rows=@(Get-CimInstance Win32_Process -Filter 'ProcessId="+pid+"' -ErrorAction Stop);ConvertTo-Json -Compress -InputObject @($rows|ForEach-Object{$_.ProcessId})";const rows=JSON.parse(execFileSync("powershell.exe",["-NoProfile","-NonInteractive","-Command",ps],{encoding:"utf8",windowsHide:true,timeout:10000}));if(rows.length)throw Error("FIXTURE_PID_STILL_PRESENT_OR_REUSED");try{await access(dirname(process.argv[2]));throw Error("FIXTURE_STORAGE_RETAINED")}catch(error){if(error.code!=="ENOENT")throw error}console.log(JSON.stringify({fixtureProcessAbsent:true,fixtureStorageAbsent:true}))`,
      String(source.server.processId),
      source.root,
    ]);
    const fixtureCleanup = JSON.parse(retired.stdout);
    console.log(
      JSON.stringify({
        ok: true,
        mode: "temporary-profile-disposal",
        app,
        before,
        after,
        fixtureStorageRemoved: true,
        physicalInput: false,
      }),
    );
  } catch (error) {
    console.error(
      "PROFILE_DISPOSAL_UNCONFIRMED: owned fixture retained",
      error,
    );
    // Keep the owned worker/fixture pipes and storage until ownership is resolved.
    // Never inherit the full-suite finally block's close/kill behavior here.
    setInterval(() => {}, 60_000);
    await new Promise(() => {});
  }
}
