// Dedicated cookie origin and storage root; no daily profiles or real sign-ins.

import { execFileSync } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

const directory = await mkdtemp(join(tmpdir(), "pi-browser-profiles-"));
const root = join(directory, "profiles");
const settings = join(directory, "settings.json");
await writeFile(
  settings,
  JSON.stringify({
    browserApp: process.argv[2] ?? "edge",
    browserVisible: false,
    browserSignIn: true,
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
    }),
  ),
);
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
  return {
    ok: true,
    processId: row.pid,
    creationDate: row.creationDate,
    executable: row.executable,
    profile: { kept: true, path },
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
const lines = createInterface({ input: process.stdin });
for await (const line of lines) {
  try {
    const request = JSON.parse(line);
    let response;
    if (request.action === "inspect-profile")
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
  }
});
