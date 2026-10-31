// Dedicated cookie origin and storage root; no daily profiles or real sign-ins.

import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

// Fixture ownership seam: unknown query facts never authorize browser closure.
function orphanProof(expected, current, writerPresent, lease, originalLease) {
  if (
    writerPresent !== false ||
    !Number.isSafeInteger(expected?.processId) ||
    expected.processId < 1 ||
    typeof expected.creationDate !== "string" ||
    !expected.creationDate ||
    typeof expected.executable !== "string" ||
    !expected.executable ||
    typeof expected.profile?.path !== "string" ||
    !expected.profile.path ||
    typeof lease !== "string" ||
    !lease ||
    !current ||
    current.processId !== expected.processId ||
    current.creationDate !== expected.creationDate ||
    current.executable?.toLowerCase() !== expected.executable?.toLowerCase() ||
    current.profile?.path !== expected.profile?.path ||
    lease !== originalLease
  )
    throw new Error("LIVE_ORPHAN_OWNERSHIP_UNCONFIRMED");
}
if (process.argv.includes("--orphan-proof-check")) {
  try {
    const f = JSON.parse(process.argv.at(-1));
    orphanProof(
      f.expected,
      f.current,
      f.writerPresent,
      f.lease,
      f.originalLease,
    );
    console.log(JSON.stringify({ ok: true }));
  } catch {
    console.log(JSON.stringify({ ok: false }));
  }
  process.exit(0);
}
const directory = await mkdtemp(join(tmpdir(), "pi-browser-profiles-"));
const root = join(directory, "profiles");
const settings = join(directory, "settings.json");
await writeFile(
  settings,
  JSON.stringify({
    browserApp: process.argv[2] ?? "edge",
    browserVisible: false,
    browserSignIn: !process.argv.includes("--dispose-only"),
  }),
);
const server = createServer(async (request, response) => {
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  if (request.url === "/set")
    response.setHeader(
      "Set-Cookie",
      "pi_profile_fixture=remembered; Path=/; Max-Age=3600; HttpOnly; SameSite=Lax",
    );
  const remembered = request.headers.cookie?.includes(
    "pi_profile_fixture=remembered",
  );
  if (request.url === "/storage") {
    const entries = await readdir(root).catch(() => []);
    response.end(`<h1>Profile storage</h1><p>${entries.join(" ")}</p>`);
  } else
    response.end(
      `<h1>Profile fixture</h1><p>Cookie: ${remembered ? "remembered" : "missing"}</p>`,
    );
});
server.listen(0, "127.0.0.1", () =>
  console.log(
    JSON.stringify({
      url: `http://127.0.0.1:${server.address().port}`,
      settings,
      root,
      ...(process.argv.includes("--dispose-only") ||
      process.argv.includes("--live-orphan")
        ? {
            server: (() => {
              const own = processAt(process.pid);
              return {
                processId: own.pid,
                creationDate: own.creationDate,
                executable: own.executable,
              };
            })(),
          }
        : {}),
    }),
  ),
);
const observedRoots = new Map();
let liveOrphan;
let cleanupControlChild;
let cleanupControlClosed;
function rememberRoot(row, profile) {
  observedRoots.set(`${row.pid}:${row.creationDate}`, {
    processId: row.pid,
    creationDate: row.creationDate,
    executable: row.executable,
    profile,
  });
}
// Fixture-only lifecycle control: no global desktop discovery or personal profile.
function processAt(pid) {
  assertPid(pid);
  const result = execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `$ErrorActionPreference='Stop';$rows=@(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}' -ErrorAction Stop);ConvertTo-Json -Compress -InputObject @($rows|ForEach-Object{@{pid=$_.ProcessId;creationDate=$_.CreationDate.ToUniversalTime().ToString('o');executable=$_.ExecutablePath;commandLine=$_.CommandLine}})`,
    ],
    { encoding: "utf8", windowsHide: true, timeout: 10000 },
  );
  const rows = JSON.parse(result);
  if (rows.length > 1) throw new Error("ambiguous process identity");
  return rows[0];
}
function assertPid(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1)
    throw new Error("invalid owned PID");
}
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
}
async function inspect(workerPid) {
  assertPid(workerPid);
  const dirs = (await readdir(root)).filter((name) =>
    /^kept-(edge|chrome)-[a-f0-9]{24}$/.test(name),
  );
  if (dirs.length !== 1)
    throw new Error("expected exactly one owned kept profile");
  const path = join(root, dirs[0]);
  const owner = JSON.parse(await readFile(path + ".lock/owner.json", "utf8"));
  if (owner.workerPid !== workerPid || owner.phase !== "running")
    throw new Error("profile lease owner mismatch");
  const row = processAt(owner.browserPid);
  if (!row) throw new Error("owned browser absent");
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const argument = new RegExp(
    '(?:^|\\s)(?:"--user-data-dir=' +
      escaped +
      '"|--user-data-dir="' +
      escaped +
      '"|--user-data-dir=' +
      escaped +
      ")(?=\\s|$)",
    "i",
  );
  const executable = process.argv[2] === "chrome" ? "chrome.exe" : "msedge.exe";
  if (
    !row.executable?.toLowerCase().endsWith("\\" + executable) ||
    !argument.test(row.commandLine)
  )
    throw new Error("owned profile/browser association unavailable");
  rememberRoot(row, path);
  return {
    ok: true,
    processId: row.pid,
    creationDate: row.creationDate,
    executable: row.executable,
    profile: { kept: true, path },
    ...(process.argv.includes("--live-orphan")
      ? {
          leaseOwner: {
            workerPid: owner.workerPid,
            tokenSha256: createHash("sha256").update(owner.token).digest("hex"),
          },
        }
      : {}),
  };
}
async function armCleanupControl() {
  if (cleanupControlChild) throw new Error("cleanup control already armed");
  const profile = join(root, "cleanup-control");
  await mkdir(profile, { recursive: true });
  await writeFile(join(profile, "canary.txt"), "owned cleanup canary");
  cleanupControlChild = spawn(
    process.execPath,
    ["-e", "process.stdin.resume()", profile],
    {
      stdio: ["pipe", "ignore", "ignore"],
      windowsHide: true,
    },
  );
  cleanupControlClosed = once(cleanupControlChild, "close");
  rememberRoot(
    {
      pid: cleanupControlChild.pid,
      creationDate: null,
      executable: process.execPath,
    },
    profile,
  );
  const row = processAt(cleanupControlChild.pid);
  if (!row || row.executable.toLowerCase() !== process.execPath.toLowerCase())
    throw new Error("owned cleanup control identity unavailable");
  observedRoots.delete(`${row.pid}:null`);
  rememberRoot(row, profile);
  return {
    ok: true,
    directory,
    profile,
    processId: row.pid,
    creationDate: row.creationDate,
  };
}
async function orphanState(request = {}) {
  if (!liveOrphan?.expected) throw new Error("orphan not recorded");
  const current = await inspect(liveOrphan.writerPid),
    lease = await readFile(liveOrphan.profile.lock + "/owner.json", "utf8");
  orphanProof(
    liveOrphan.expected,
    current,
    Boolean(processAt(liveOrphan.writerPid)),
    lease,
    liveOrphan.lease,
  );
  if (request.retiredWorkerPid && processAt(request.retiredWorkerPid))
    throw new Error("contender worker still alive");
  if (
    (await readdir(root)).some(
      (n) => n.endsWith(".recover") || n.includes(".abandoned-"),
    )
  )
    throw new Error("unexpected recovery artifact");
  const content = await liveOrphan.page.content();
  if (!content.includes("Cookie: remembered"))
    throw new Error("original page/cookie unavailable");
  return {
    ok: true,
    ...current,
    writerAbsent: true,
    writer: liveOrphan.writer,
    leaseUnchanged: true,
    cookieRemembered: true,
  };
}
async function armOrphan(request) {
  if (!process.argv.includes("--live-orphan") || liveOrphan)
    throw new Error("orphan mode unavailable");
  const previous = request.browser;
  if (
    !observedRoots.has(`${previous.processId}:${previous.creationDate}`) ||
    processAt(previous.processId) ||
    processAt(request.workerPid)
  )
    throw new Error("setup actor retirement unproved");
  liveOrphan = {};
  const ownerSource = `import {createInterface} from 'node:readline';const {acquireBrowserProfile,recordProfileBrowser}=await import(process.argv[1]);const p=await acquireBrowserProfile(process.argv[2],process.argv[3],true);console.log(JSON.stringify(p));for await(const line of createInterface({input:process.stdin})){const cmd=JSON.parse(line);if(cmd.browserPid){await recordProfileBrowser(p,cmd.browserPid);console.log('recorded')}else if(cmd.exit){process.exit(0)}else throw Error('unsupported owner command')}`;
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      ownerSource,
      new URL("../dist/browser-profiles.js", import.meta.url).href,
      process.argv[2],
      previous.executable,
    ],
    {
      env: { ...process.env, PI_CU_BROWSER_PROFILE_ROOT: root },
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  liveOrphan.child = child;
  liveOrphan.writerPid = child.pid;
  liveOrphan.closed = once(child, "close");
  child.stderr.resume();
  await writeFile(
    join(directory, "live-orphan.json"),
    JSON.stringify({ phase: "owner-started", writerPid: child.pid }),
  );
  const writer = processAt(child.pid);
  if (
    !writer ||
    writer.executable?.toLowerCase() !== process.execPath.toLowerCase()
  )
    throw new Error("writer identity unavailable");
  liveOrphan.writer = {
    processId: writer.pid,
    creationDate: writer.creationDate,
    executable: writer.executable,
  };
  await writeFile(
    join(directory, "live-orphan.json"),
    JSON.stringify({ phase: "writer-pinned", writer: liveOrphan.writer }),
  );
  const input = createInterface({ input: child.stdout });
  const nextOwner = () =>
    Promise.race([
      once(input, "line"),
      liveOrphan.closed.then(() => {
        throw new Error("writer closed before acknowledgement");
      }),
    ]);
  const ready = nextOwner();
  const profile = JSON.parse((await ready)[0]);
  liveOrphan.profile = profile;
  if (profile.path !== previous.profile.path || !profile.kept)
    throw new Error("unexpected owned lease path");
  const { default: puppeteer } = await import("puppeteer-core");
  const browser = await puppeteer.launch({
    executablePath: previous.executable,
    userDataDir: profile.path,
    headless: true,
    timeout: 20000,
    protocolTimeout: 20000,
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
  });
  liveOrphan.browser = browser;
  const browserPid = browser.process()?.pid;
  if (!browserPid) throw new Error("browser PID unavailable");
  await writeFile(
    join(directory, "live-orphan.json"),
    JSON.stringify({
      phase: "browser-started",
      writerPid: child.pid,
      browserPid,
      profile: profile.path,
    }),
  );
  const recorded = nextOwner();
  child.stdin.write(JSON.stringify({ browserPid }) + "\n");
  if ((await recorded)[0] !== "recorded")
    throw new Error("lease registration missing");
  liveOrphan.expected = await inspect(child.pid);
  liveOrphan.lease = await readFile(profile.lock + "/owner.json", "utf8");
  const currentWriter = processAt(child.pid);
  if (
    !currentWriter ||
    currentWriter.creationDate !== liveOrphan.writer.creationDate ||
    currentWriter.executable?.toLowerCase() !==
      liveOrphan.writer.executable.toLowerCase()
  )
    throw new Error("writer identity changed");
  await writeFile(
    join(directory, "live-orphan.json"),
    JSON.stringify({
      phase: "lease-recorded",
      writer: liveOrphan.writer,
      browser: liveOrphan.expected,
      leaseSha256: createHash("sha256").update(liveOrphan.lease).digest("hex"),
    }),
  );
  liveOrphan.page = await browser.newPage();
  const url = `http://127.0.0.1:${server.address().port}`;
  await liveOrphan.page.goto(url + "/set");
  await liveOrphan.page.goto(url + "/read");
  child.stdin.write(JSON.stringify({ exit: true }) + "\n");
  const [code] = await liveOrphan.closed;
  if (code !== 0) throw new Error("lease writer exit unconfirmed");
  input.close();
  const proof = await orphanState();
  await writeFile(
    join(directory, "live-orphan.json"),
    JSON.stringify({
      phase: "live-browser-dead-writer",
      writer: liveOrphan.writer,
      leaseSha256: createHash("sha256").update(liveOrphan.lease).digest("hex"),
      ...proof,
    }),
  );
  return proof;
}
async function closeOrphan() {
  const before = await orphanState();
  await liveOrphan.browser.close();
  if (processAt(before.processId)) throw new Error("orphan close unconfirmed");
  return {
    ok: true,
    browserAbsent: true,
    writerAbsent: true,
    writer: liveOrphan.writer,
    profile: before.profile,
  };
}
async function closeOwned(request) {
  const observed = await inspect(request.workerPid),
    expected = request.browser;
  if (
    observed.processId !== expected.processId ||
    observed.creationDate !== expected.creationDate ||
    observed.profile.path !== expected.profile.path
  )
    throw new Error("owned browser changed before close");
  const [port, path] = (
    await readFile(join(observed.profile.path, "DevToolsActivePort"), "utf8")
  )
    .trim()
    .split(/\r?\n/);
  if (
    !/^\d+$/.test(port) ||
    Number(port) < 1 ||
    Number(port) > 65535 ||
    !/^\/devtools\/browser\/[a-z0-9-]+$/i.test(path)
  )
    throw new Error("owned DevTools endpoint unavailable");
  await new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}${path}`);
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error("owned Browser.close timeout"));
    }, 8000);
    const finish = (error) => {
      clearTimeout(timer);
      socket.close();
      if (error) reject(error);
      else resolve();
    };
    socket.addEventListener(
      "open",
      () => socket.send(JSON.stringify({ id: 1, method: "Browser.close" })),
      { once: true },
    );
    socket.addEventListener("message", (event) => {
      try {
        const result = JSON.parse(event.data);
        if (result.id === 1)
          finish(
            result.error ? new Error(JSON.stringify(result.error)) : undefined,
          );
      } catch (error) {
        finish(error);
      }
    });
    socket.addEventListener(
      "close",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
    socket.addEventListener(
      "error",
      () => finish(new Error("owned Browser.close transport error")),
      { once: true },
    );
  });
  const deadline = Date.now() + 5000;
  while (alive(observed.processId) && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 50));
  if (processAt(observed.processId))
    throw new Error("owned root exit unavailable; stop without reconnect");
  return {
    ok: true,
    oldRootAbsent: true,
    processId: observed.processId,
    creationDate: observed.creationDate,
  };
}

let disposal;
function profileRoots(path) {
  const escaped = path.replaceAll("'", "''");
  const result = execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `$ErrorActionPreference='Stop';$prefix='${escaped}';$rows=@(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -and $_.CommandLine.Contains($prefix) });ConvertTo-Json -Compress -InputObject @($rows|ForEach-Object{@{pid=$_.ProcessId;creationDate=$_.CreationDate.ToUniversalTime().ToString('o');executable=$_.ExecutablePath}})`,
    ],
    { encoding: "utf8", windowsHide: true, timeout: 10000 },
  );
  return JSON.parse(result);
}
async function inspectDisposal(workerPid) {
  assertPid(workerPid);
  if (!process.argv.includes("--dispose-only") || disposal)
    throw new Error("disposal inspection unavailable");
  const dirs = (await readdir(root)).filter((name) =>
    /^temporary-[A-Za-z0-9_-]+$/.test(name),
  );
  if (dirs.length !== 1)
    throw new Error("expected exactly one temporary profile");
  const path = join(root, dirs[0]);
  const owner = JSON.parse(await readFile(path + ".lock/owner.json", "utf8"));
  if (owner.workerPid !== workerPid || owner.phase !== "running")
    throw new Error("owned temporary lease mismatch");
  const worker = processAt(workerPid);
  const browser = processAt(owner.browserPid);
  if (process.argv[2] !== "firefox")
    throw new Error("Firefox disposal mode required");
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const argument = new RegExp(
    '(?:^|\\s)--?profile\\s+(?:"' + escaped + '"|' + escaped + ")(?=\\s|$)",
    "i",
  );
  if (
    !worker?.executable?.toLowerCase().endsWith("\\node.exe") ||
    !worker.commandLine?.includes("worker.js") ||
    !browser?.executable?.toLowerCase().endsWith("\\firefox.exe") ||
    !argument.test(browser.commandLine) ||
    !/(?:^|\s)--?headless(?:=|\s|$)/i.test(browser.commandLine)
  )
    throw new Error("owned worker/browser/profile identity unavailable");
  const matching = profileRoots(path);
  if (
    !matching.some(
      (row) =>
        row.pid === browser.pid && row.creationDate === browser.creationDate,
    )
  )
    throw new Error("profile matcher positive control missing");
  rememberRoot(worker, path);
  rememberRoot(browser, path);
  for (const row of matching) rememberRoot(row, path);
  const clean = (row) => ({
    processId: row.pid,
    creationDate: row.creationDate,
    executable: row.executable,
  });
  disposal = {
    profile: path,
    worker: clean(worker),
    browser: clean(browser),
    matching,
  };
  return { ok: true, ...disposal, headless: true, kept: false };
}
async function verifyDisposal() {
  if (!disposal) throw new Error("disposal identity missing");
  for (const row of observedRoots.values())
    if (processAt(row.processId))
      throw new Error("recorded root live/reused; retain storage");
  if (profileRoots(disposal.profile).length)
    throw new Error("owned profile processes remain; retain storage");
  for (const path of [disposal.profile, disposal.profile + ".lock"]) {
    try {
      await access(path);
      throw new Error("profile/lock retained after disposal");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return {
    ok: true,
    recordedRootsAbsent: true,
    profileProcessesAbsent: true,
    profileAbsent: true,
    lockAbsent: true,
  };
}

const lines = createInterface({ input: process.stdin });
for await (const line of lines) {
  try {
    const request = JSON.parse(line);
    let response;
    if (request.action === "arm-live-orphan")
      response = await armOrphan(request);
    else if (request.action === "inspect-live-orphan")
      response = await orphanState(request);
    else if (request.action === "close-live-orphan")
      response = await closeOrphan();
    else if (request.action === "inspect-disposal")
      response = await inspectDisposal(request.workerPid);
    else if (request.action === "verify-disposal")
      response = await verifyDisposal();
    else if (request.action === "arm-cleanup-control")
      response = await armCleanupControl();
    else if (request.action === "inspect-profile")
      response = await inspect(request.workerPid);
    else if (request.action === "close-owned-browser")
      response = await closeOwned(request);
    else throw new Error("unsupported fixture action");
    console.log(JSON.stringify(response));
  } catch (error) {
    console.log(JSON.stringify({ ok: false, error: String(error) }));
  }
}
server.close(async () => {
  try {
    // A missing lease is not absence: retain every root already observed by this fixture.
    for (const observed of observedRoots.values()) {
      const current = processAt(observed.processId);
      if (current) {
        const same =
          current.creationDate === observed.creationDate &&
          current.executable?.toLowerCase() ===
            observed.executable?.toLowerCase();
        throw new Error(
          "PROFILE_CLEANUP_BLOCKED: " +
            (same
              ? "recorded root still live"
              : "recorded PID reused or identity uncertain") +
            "; retained " +
            directory,
        );
      }
    }
    // Refuse deletion if any recorded profile owner may still be alive/unknown.
    for (const name of await readdir(root).catch((error) => {
      if (error.code === "ENOENT") return [];
      throw error;
    })) {
      if (!name.endsWith(".lock")) continue;
      const owner = JSON.parse(
        await readFile(join(root, name, "owner.json"), "utf8"),
      );
      assertPid(owner.workerPid);
      assertPid(owner.browserPid);
      if (alive(owner.workerPid) || alive(owner.browserPid))
        throw new Error("profile cleanup unconfirmed; retained " + directory);
    }
    await rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  } catch (error) {
    console.error(String(error));
    process.exitCode = 1;
  } finally {
    if (cleanupControlChild) {
      // This harmless test child is owned by its retained handle, never an old lease.
      cleanupControlChild.stdin.end();
      await cleanupControlClosed;
    }
  }
});
