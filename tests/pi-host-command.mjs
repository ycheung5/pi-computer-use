// Concrete no-input companion of pi-host-stop.mjs; importing it starts no process.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { readFileSync, readlinkSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { release, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { keepVisualOwnership } from "./pi-visual-host.mjs";

export function commandObserver(file) {
  const source = `import {appendFileSync} from 'node:fs';import {StringDecoder} from 'node:string_decoder';
let sequence=0,fault=false;const file=${JSON.stringify(file)};
const record=row=>{try{appendFileSync(file,JSON.stringify({sequence:++sequence,pid:process.pid,time:Date.now(),monotonicMs:performance.now(),fault,...row})+'\\n',{mode:0o600});}catch{fault=true;}};
record({kind:'ready',executable:process.execPath,worker:process.argv[1],cwd:process.cwd(),settingsFile:process.env.PI_CU_SETTINGS_FILE});
const decoder={input:new StringDecoder('utf8'),output:new StringDecoder('utf8')},buffer={input:'',output:''};
const observe=(kind,chunk)=>{try{buffer[kind]+=typeof chunk==='string'?chunk:decoder[kind].write(chunk);let end;while((end=buffer[kind].indexOf('\\n'))>=0){const line=buffer[kind].slice(0,end);buffer[kind]=buffer[kind].slice(end+1);const r=JSON.parse(line),d=r.result;record({kind,id:r.id,action:r.action,operationId:r.operationId,milliseconds:r.args?.milliseconds,stop:r.stop,cancel:r.cancel,event:r.event,phase:r.phase,result:d?{ok:d.ok,action:d.action,error:d.error,processId:d.processId,released:d.released}:undefined});}if(buffer[kind].length>65536){fault=true;record({kind:'fault',error:'oversized protocol frame'});}}catch{fault=true;record({kind:'fault',error:'malformed protocol frame'});}};
const emit=process.stdin.emit;process.stdin.emit=function(...args){if(args[0]==='data')observe('input',args[1]);return Reflect.apply(emit,this,args);};
const write=process.stdout.write;process.stdout.write=function(...args){observe('output',args[0]);return Reflect.apply(write,this,args);};`;
  return (
    "data:text/javascript;base64," + Buffer.from(source).toString("base64")
  );
}

export function commandGuard(event, readOwner, record) {
  const deny = () => ({
    block: true,
    reason: "PASSIVE_COMMAND_SCOPE: owner or health/wait proof unavailable",
  });
  try {
    const owner = readOwner(),
      a = event.input;
    if (
      owner?.phase !== "running" ||
      !Number.isFinite(owner.expiresAt) ||
      owner.expiresAt <= Date.now()
    )
      return deny();
    if (!a || typeof a !== "object") return deny();
    const n = event.toolName;
    if (n === "windows_computer_use_health") {
      if (Object.keys(a).length) return deny();
    } else if (
      n !== "windows_computer_use_wait" ||
      Object.keys(a).length !== 1 ||
      !Number.isInteger(a.milliseconds) ||
      a.milliseconds < 1 ||
      a.milliseconds > 30000
    )
      return deny();
    record({ type: "tool_call", toolName: n, milliseconds: a.milliseconds });
  } catch {
    return deny();
  }
}

// Report/collector seam: command acceptance or SDK abort alone is not worker cancellation.
export function assessCommandSettlement(pending, rows) {
  const failed = (reason) => ({ status: "failed", reason });
  if (!Number.isFinite(pending.monotonicMs) || pending.milliseconds !== 30000)
    return failed("request clock/budget unavailable");
  const replies = rows.filter(
    (row) =>
      row.kind === "output" && row.pid === pending.pid && row.id === pending.id,
  );
  if (!replies.length)
    return { status: "pending", reason: "actual wait response absent" };
  if (replies.length !== 1) return failed("duplicate wait response");
  const response = replies[0],
    elapsedMs = response.monotonicMs - pending.monotonicMs;
  if (
    response.result?.ok !== false ||
    response.result.action !== "wait" ||
    response.result.error !== "COMPUTER_USE_STOPPED"
  )
    return failed("worker did not report stop-specific wait cancellation");
  if (
    !Number.isFinite(elapsedMs) ||
    elapsedMs < 0 ||
    elapsedMs >= pending.milliseconds
  )
    return failed(
      "worker cancellation was not before the original timer deadline",
    );
  const ends = rows.filter(
    (row) =>
      row.kind === "input" &&
      row.pid === pending.pid &&
      row.action === "operation_end" &&
      row.operationId === pending.operationId,
  );
  if (!ends.length)
    return { status: "pending", reason: "operation settlement request absent" };
  if (ends.length !== 1) return failed("ambiguous operation settlement");
  const acknowledgments = rows.filter(
    (row) =>
      row.kind === "output" && row.pid === pending.pid && row.id === ends[0].id,
  );
  if (!acknowledgments.length)
    return {
      status: "pending",
      reason: "released ownership acknowledgment absent",
    };
  const acknowledgment = acknowledgments[0];
  if (
    acknowledgments.length !== 1 ||
    acknowledgment.result?.ok !== true ||
    acknowledgment.result.action !== "operation_end" ||
    acknowledgment.result.released !== true ||
    acknowledgment.sequence <= response.sequence ||
    acknowledgment.sequence <= ends[0].sequence ||
    !Number.isFinite(acknowledgment.monotonicMs) ||
    acknowledgment.monotonicMs < response.monotonicMs
  )
    return failed(
      "operation ownership release failed or preceded cancellation",
    );
  return { status: "observed", elapsedMs, response, acknowledgment };
}

export function commandOptions(args) {
  let commandHost = "windows",
    plan = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--plan") plan = true;
    else if (args[i] === "--command-host") {
      commandHost = args[++i];
      assert.ok(
        ["windows", "wsl"].includes(commandHost),
        "command host must be windows or wsl",
      );
    } else throw Error("unknown passive command option");
  }
  return { commandHost, plan };
}
export function linuxOwner(pid) {
  assert.ok(Number.isSafeInteger(pid) && pid > 0);
  const stat = readFileSync(`/proc/${pid}/stat`, "utf8"),
    fields = stat.slice(stat.lastIndexOf(")") + 2).split(/\s+/);
  assert.match(fields[19] ?? "", /^\d+$/);
  return {
    domain: "linux",
    pid,
    parent: Number(fields[1]),
    startTicks: fields[19],
    executable: readlinkSync(`/proc/${pid}/exe`),
  };
}
export function linuxOwnerAbsent(identity) {
  try {
    readFileSync(`/proc/${identity.pid}/stat`, "utf8");
    return false;
  } catch (error) {
    if (error.code === "ENOENT") return true;
    throw error;
  }
}
function linuxDescendants(pin) {
  assert.deepEqual(linuxOwner(pin.pid), pin, "Linux host identity changed");
  const rows = [],
    pending = [pin.pid];
  for (const pid of pending) {
    let row;
    try {
      row = linuxOwner(pid);
    } catch (error) {
      if (
        error.code === "ENOENT" &&
        pid !== pin.pid &&
        linuxOwnerAbsent({ pid })
      )
        continue;
      throw error;
    }
    rows.push(row);
    const children = readFileSync(
      `/proc/${pid}/task/${pid}/children`,
      "utf8",
    ).trim();
    if (children)
      for (const child of children.split(/\s+/)) {
        const value = Number(child);
        assert.ok(Number.isSafeInteger(value) && value > 0);
        pending.push(value);
      }
  }
  return rows;
}
function mappedPath(path, mode) {
  const result = spawnSync("wslpath", [mode, path], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function ps(script) {
  const r = spawnSync(
    process.platform === "linux"
      ? "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe"
      : "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(
        "$ErrorActionPreference='Stop';" + script,
        "utf16le",
      ).toString("base64"),
    ],
    { encoding: "utf8", windowsHide: true, timeout: 15000 },
  );
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout.trim());
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runPassiveCommandStop(commandHost = "windows") {
  const wsl = commandHost === "wsl";
  assert.equal(
    process.platform,
    wsl ? "linux" : "win32",
    "command host selector/platform conflict",
  );
  if (wsl) assert.match(release(), /microsoft.*wsl2/i, "WSL2 required");
  const root = fileURLToPath(new URL("../", import.meta.url));
  const cli = join(
    dirname(
      fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")),
    ),
    "bundle",
    "cli.js",
  );
  const version = JSON.parse(
    await readFile(
      new URL(
        "../node_modules/@earendil-works/pi-coding-agent/package.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ).version;
  assert.equal(
    version,
    "1.4.0",
    "review a changed host before running this protocol fixture",
  );
  const dir = await mkdtemp(join(tmpdir(), "pi-cu-command-stop-"));
  const journal = join(dir, "owner.json"),
    trace = join(dir, "worker.jsonl"),
    fixtureTrace = join(dir, "fixture.jsonl");
  const write = (name, value) =>
    writeFileSync(join(dir, name), JSON.stringify(value, null, 2) + "\n", {
      mode: 0o600,
    });
  const owner = () =>
    write("owner.json", {
      phase: "running",
      expiresAt: Date.now() + 120000,
      keeperPid: process.pid,
    });
  const settings = join(dir, "settings.json");
  write("settings.json", {
    indicatorEnabled: false,
    cursorIndicatorEnabled: false,
    stopShortcut: "",
  });
  await mkdir(join(dir, "agent"));
  const windowsDir = wsl ? mappedPath(dir, "-w") : dir;
  let ownership, preflight;
  if (!wsl) {
    const { compileNative } = await import("../dist/native.js");
    ownership = await compileNative(["ownership.cs"], []);
  } else {
    const { nativeWorkerLaunch } = await import("../dist/launcher.js");
    const real = await nativeWorkerLaunch();
    assert.match(real.executable, /[\\/]node\.exe$/i);
    const module = mappedPath(
      fileURLToPath(new URL("../dist/native.js", import.meta.url)),
      "-w",
    );
    const code = `import{pathToFileURL}from'node:url';const{compileNative}=await import(pathToFileURL(${JSON.stringify(module)}).href);const launch=await compileNative(['ownership.cs'],[]);console.log(JSON.stringify({launch,pid:process.pid,executable:process.execPath}));`;
    const result = spawnSync(
      real.executable,
      ["--input-type", "module", "-e", code],
      { encoding: "utf8", timeout: 40000 },
    );
    assert.equal(result.status, 0, result.stderr);
    preflight = JSON.parse(result.stdout);
    ownership = preflight.launch;
    assert.equal(
      preflight.executable.toLowerCase(),
      mappedPath(real.executable, "-w").toLowerCase(),
    );
    assert.deepEqual(
      ps(
        `$p=Get-CimInstance Win32_Process -Filter 'ProcessId = ${preflight.pid}' -ErrorAction Stop;$rows=@();if($null -ne $p){$rows+=@(@{pid=$p.ProcessId;creation=$p.CreationDate.ToUniversalTime().ToString('o');executable=$p.ExecutablePath})};ConvertTo-Json -Compress -InputObject @($rows)`,
      ),
      [],
      "Windows compiler preflight must exit before Pi host starts",
    );
  }
  const windowsWorker = wsl
    ? mappedPath(
        fileURLToPath(new URL("../dist/worker.js", import.meta.url)),
        "-w",
      )
    : fileURLToPath(new URL("../dist/worker.js", import.meta.url));
  const hashes = {};
  for (const file of [
    "tests/pi-host-stop.mjs",
    "tests/pi-host-stop-provider.ts",
    "tests/pi-host-command.mjs",
    "tests/pi-visual-host.mjs",
    "src/extension.ts",
    "src/client.ts",
    "src/worker.ts",
    "src/waits.ts",
    "assets/ownership.cs",
    "dist/extension.js",
    "dist/client.js",
    "dist/worker.js",
  ])
    hashes[file] = createHash("sha256")
      .update(await readFile(join(root, file)))
      .digest("hex");
  hashes.installedCli = createHash("sha256")
    .update(await readFile(cli))
    .digest("hex");
  hashes.ownershipHelper = createHash("sha256")
    .update(
      await readFile(
        wsl ? mappedPath(ownership.executable, "-u") : ownership.executable,
      ),
    )
    .digest("hex");
  owner();
  const host = spawn(
    process.execPath,
    [
      cli,
      "--mode",
      "rpc",
      "--no-session",
      "--no-extensions",
      "--no-context-files",
      "--no-skills",
      "--no-prompt-templates",
      "--no-themes",
      "--no-mcp",
      "--offline",
      "--provider",
      "pi-cu-stop-host",
      "--model",
      "fixture",
      "--tools",
      "windows_computer_use_health,windows_computer_use_wait",
      "-e",
      fileURLToPath(new URL("./pi-host-stop-provider.ts", import.meta.url)),
    ],
    {
      cwd: dir,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        PI_OFFLINE: "1",
        PI_CODING_AGENT_DIR: join(dir, "agent"),
        PI_CU_SETTINGS_FILE: wsl ? "settings.json" : settings,
        ...(wsl
          ? {
              WSLENV: [
                ...(process.env.WSLENV ?? "")
                  .split(":")
                  .filter(
                    (value) =>
                      value && value.split("/")[0] !== "PI_CU_SETTINGS_FILE",
                  ),
                "PI_CU_SETTINGS_FILE",
              ].join(":"),
            }
          : {}),
        PI_CU_HOST_STOP_COMMAND: JSON.stringify({
          dir,
          journal,
          trace,
          fixtureTrace,
          ...(wsl
            ? { workerCwd: dir, workerTrace: mappedPath(trace, "-w") }
            : {}),
        }),
      },
    },
  );
  const closed = once(host, "close").catch(() => [null, "launch-error"]);
  host.stderr.resume();
  host.stdin.on("error", () => {});
  console.log(
    JSON.stringify({
      status: "passive-command-host-started",
      dir,
      hostPid: host.pid,
      physicalInput: false,
    }),
  );
  await keepVisualOwnership(
    host,
    async (assertActive) => {
      const events = [];
      let fatal;
      host.once("error", (error) => {
        fatal = error;
      });
      const lines = createInterface({ input: host.stdout });
      lines.on("line", (line) => {
        try {
          const e = JSON.parse(line);
          events.push(e);
          if (e.type === "extension_error") throw Error("extension error");
        } catch (error) {
          fatal = error;
        }
      });
      const observer = () => {
        const text = readFileSync(trace, "utf8");
        if (!text.endsWith("\n")) throw Error("incomplete observer record");
        const rows = text
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line));
        rows.forEach((r, i) => {
          assert.ok(
            r.sequence === i + 1 &&
              !r.fault &&
              ["ready", "input", "output"].includes(r.kind),
            "observer continuity/fault",
          );
        });
        return rows;
      };
      const send = (id, type, fields = {}) => {
        assertActive();
        const o = JSON.parse(readFileSync(journal, "utf8"));
        assert.equal(o.phase, "running");
        assert.ok(Number.isFinite(o.expiresAt) && o.expiresAt > Date.now());
        host.stdin.write(JSON.stringify({ id, type, ...fields }) + "\n");
      };
      const until = async (check, label, ms = 15000) => {
        const end = Date.now() + ms;
        while (true) {
          assertActive();
          if (fatal) throw fatal;
          const value = check();
          if (value) return value;
          if (Date.now() > end) throw Error("unconfirmed: " + label);
          await delay(25);
        }
      };
      const response = async (id) =>
        until(
          () => events.find((e) => e.type === "response" && e.id === id),
          "RPC " + id,
        );
      const settled = async (number) =>
        until(
          () =>
            events.filter((e) => e.type === "agent_settled").length >= number,
          "settlement " + number,
        );
      const toolEnds = () =>
        events.filter((e) => e.type === "tool_execution_end");
      const hostPin = wsl
        ? linuxOwner(host.pid)
        : ps(
            `$p=Get-CimInstance Win32_Process -Filter 'ProcessId = ${host.pid}' -ErrorAction Stop;if($null -eq $p){throw 'owned host absent'};@{pid=$p.ProcessId;parent=$p.ParentProcessId;creation=$p.CreationDate.ToUniversalTime().ToString('o');executable=$p.ExecutablePath}|ConvertTo-Json -Compress`,
          );
      assert.equal(hostPin.parent, process.pid);
      assert.equal(
        hostPin.executable.toLowerCase(),
        process.execPath.toLowerCase(),
      );
      assert.ok(wsl ? hostPin.startTicks : hostPin.creation);
      let windowsRootPin;
      const descendants = () =>
        ps(
          `$root=Get-CimInstance Win32_Process -Filter 'ProcessId = ${wsl ? windowsRootPin.pid : host.pid}' -ErrorAction Stop;if($null -eq $root -or $root.CreationDate.ToUniversalTime().ToString('o') -ne '${wsl ? windowsRootPin.creation : hostPin.creation}'){throw 'owned Windows root changed'};$pending=@(${wsl ? windowsRootPin.pid : host.pid});$rows=@();$seen=@();for($i=0;$i -lt $pending.Count;$i++){foreach($p in @(Get-CimInstance Win32_Process -Filter ('ProcessId='+$pending[$i]) -ErrorAction Stop)){if($seen -notcontains $p.ProcessId){$seen+=@($p.ProcessId);$rows+=@(@{pid=$p.ProcessId;parent=$p.ParentProcessId;creation=$p.CreationDate.ToUniversalTime().ToString('o');executable=$p.ExecutablePath;name=$p.Name});foreach($c in @(Get-CimInstance Win32_Process -Filter ('ParentProcessId='+$p.ProcessId) -ErrorAction Stop)){$pending+=@($c.ProcessId)}}}};ConvertTo-Json -Compress -Depth 4 -InputObject @($rows)`,
        );
      send("commands", "get_commands");
      const commands = await response("commands");
      assert.equal(commands.success, true);
      assert.ok(
        commands.data?.commands?.some(
          (command) =>
            command.name === "computer-stop" && command.source === "extension",
        ),
      );
      send("initial", "prompt", {
        message: "Execute the scripted passive command fixture.",
      });
      assert.equal((await response("initial")).data.disposition, "started");
      const health = await until(
        () =>
          toolEnds().find((e) => e.toolName === "windows_computer_use_health"),
        "health",
      );
      const workerPid = health.result?.details?.processId;
      assert.ok(Number.isSafeInteger(workerPid) && workerPid > 0);
      if (wsl)
        windowsRootPin = ps(
          `$p=Get-CimInstance Win32_Process -Filter 'ProcessId = ${workerPid}' -ErrorAction Stop;if($null -eq $p){throw 'Windows worker absent'};@{pid=$p.ProcessId;creation=$p.CreationDate.ToUniversalTime().ToString('o');executable=$p.ExecutablePath}|ConvertTo-Json -Compress`,
        );
      const waitStart = await until(
        () =>
          events.find(
            (e) =>
              e.type === "tool_execution_start" &&
              e.toolName === "windows_computer_use_wait",
          ),
        "wait start",
      );
      const pending = await until(() => {
        try {
          return observer().find(
            (r) =>
              r.kind === "input" &&
              r.action === "wait" &&
              r.milliseconds === 30000,
          );
        } catch (error) {
          if (error.code === "ENOENT") return;
          throw error;
        }
      }, "actual wait frame");
      assert.equal(typeof pending.operationId, "string");
      assert.equal(pending.pid, workerPid);
      assert.equal(observer()[0].pid, workerPid);
      if (wsl) {
        assert.equal(observer()[0].cwd.toLowerCase(), windowsDir.toLowerCase());
        assert.equal(observer()[0].settingsFile, "settings.json");
      }
      const identities = await until(() => {
        const rows = descendants();
        const helper = rows.find(
          (r) =>
            r.parent === workerPid &&
            r.executable?.toLowerCase() === ownership.executable.toLowerCase(),
        );
        return helper && rows;
      }, "owned ownership helper");
      if (!wsl)
        assert.ok(
          identities
            .find((r) => r.pid === host.pid)
            ?.executable?.toLowerCase() === process.execPath.toLowerCase(),
        );
      const linuxIdentities = wsl ? linuxDescendants(hostPin) : [];
      assert.ok(
        identities
          .find((r) => r.pid === workerPid)
          ?.executable?.toLowerCase()
          .endsWith("node.exe"),
      );
      const held = ps(
        `$m=[Threading.Mutex]::OpenExisting('Local\\PiComputerUseDesktop');$acquired=$false;try{try{$acquired=$m.WaitOne(0)}catch [Threading.AbandonedMutexException]{$acquired=$true};@{held=(!$acquired)}|ConvertTo-Json -Compress}finally{if($acquired){$m.ReleaseMutex()};$m.Dispose()}`,
      );
      assert.equal(held.held, true);
      assert.ok(
        !observer().some((r) => r.kind === "output" && r.id === pending.id),
      );
      write("busy.json", {
        pending,
        waitStart,
        identities,
        linuxIdentities,
        held,
        claim:
          "received wait request, owned mutex held and no response; not timer-scheduling instrumentation",
      });
      send("stop", "prompt", { message: "/computer-stop" });
      const stop = await response("stop");
      assert.equal(stop.success, true);
      assert.equal(stop.data.disposition, "handled");
      await settled(1);
      assert.equal(
        events.filter((e) => e.type === "agent_settled")[0].aborted,
        true,
      );
      const cancelled = toolEnds().find(
        (e) => e.toolName === "windows_computer_use_wait",
      );
      assert.equal(cancelled?.isError, true);
      assert.match(
        JSON.stringify(cancelled.result),
        /COMPUTER_USE_STOPPED|CANCELLED|AbortError|aborted/i,
      );
      assert.ok(
        observer().some(
          (r) =>
            r.kind === "output" &&
            r.event === "stopped" &&
            r.operationId === pending.operationId,
        ),
      );
      const cancellationProof = await until(() => {
        const proof = assessCommandSettlement(pending, observer());
        if (proof.status === "failed") throw Error(proof.reason);
        return proof.status === "observed" ? proof : undefined;
      }, "actual timely wait cancellation and operation-A release");
      write("cancellation.json", cancellationProof);
      send("retry", "prompt", { message: "/fixture-command-retry" });
      assert.equal((await response("retry")).data.disposition, "handled");
      await settled(2);
      const waits = toolEnds().filter(
        (e) => e.toolName === "windows_computer_use_wait",
      );
      assert.equal(waits.length, 2);
      assert.equal(waits[1].isError, true);
      assert.match(JSON.stringify(waits[1].result), /COMPUTER_USE_STOPPED/);
      assert.equal(
        observer().filter((r) => r.kind === "input" && r.action === "wait")
          .length,
        1,
        "custom retry never reaches worker",
      );
      send("fresh", "prompt", {
        message: "Execute the fresh user recovery phase.",
      });
      assert.equal((await response("fresh")).data.disposition, "started");
      await settled(3);
      const fresh = toolEnds().filter(
        (e) => e.toolName === "windows_computer_use_wait",
      );
      assert.equal(fresh.length, 3);
      assert.equal(fresh[2].result?.details?.ok, true);
      const frames = observer().filter(
        (r) => r.kind === "input" && r.action === "wait",
      );
      assert.equal(frames.length, 2);
      assert.equal(frames[1].milliseconds, 1);
      assert.notEqual(frames[1].operationId, pending.operationId);
      const fixture = readFileSync(fixtureTrace, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      assert.deepEqual(
        fixture
          .filter((r) => r.type === "before_agent_start")
          .map((r) => r.messageType),
        ["user", "custom", "user"],
      );
      assert.ok(
        events
          .filter((e) => e.type === "agent_settled")
          .slice(1)
          .every((e) => e.aborted === false),
      );
      assert.equal(
        toolEnds().length,
        5,
        "health/wait, denied retry, fresh health/wait only",
      );
      const allIdentities = [
        ...new Map(
          [...identities, ...descendants()].map((row) => [row.pid, row]),
        ).values(),
      ];
      const allLinuxIdentities = wsl
        ? [
            ...new Map(
              [...linuxIdentities, ...linuxDescendants(hostPin)].map((row) => [
                row.pid,
                row,
              ]),
            ).values(),
          ]
        : [];
      assertActive();
      host.stdin.end();
      let shutdownTimer;
      try {
        await Promise.race([
          closed,
          new Promise((_, reject) => {
            shutdownTimer = setTimeout(
              () => reject(Error("host orderly shutdown unconfirmed")),
              10000,
            );
          }),
        ]);
      } finally {
        clearTimeout(shutdownTimer);
      }
      assert.equal(host.exitCode, 0);
      if (fatal) throw fatal;
      const remaining = ps(
        `$ids=@(${allIdentities.map((r) => r.pid).join(",")});$rows=@();foreach($id in $ids){$p=Get-CimInstance Win32_Process -Filter ('ProcessId='+$id) -ErrorAction Stop;if($null -ne $p){$rows+=@(@{pid=$p.ProcessId;creation=$p.CreationDate.ToUniversalTime().ToString('o');executable=$p.ExecutablePath})}};ConvertTo-Json -Compress -InputObject @($rows)`,
      );
      assert.deepEqual(remaining, []);
      const linuxRemaining = allLinuxIdentities.filter(
        (row) => !linuxOwnerAbsent(row),
      );
      assert.deepEqual(linuxRemaining, []);
      const finalObserver = observer();
      assert.equal(finalObserver[0].pid, workerPid);
      assert.equal(
        finalObserver[0].executable.toLowerCase(),
        identities
          .find((row) => row.pid === workerPid)
          .executable.toLowerCase(),
      );
      assert.equal(
        finalObserver[0].worker.toLowerCase(),
        windowsWorker.toLowerCase(),
      );
      assert.ok(
        finalObserver.some(
          (r) => r.event === "shutdown_state" && r.phase === "complete",
        ),
      );
      for (const operationId of [pending.operationId, frames[1].operationId]) {
        const end = finalObserver.find(
          (r) =>
            r.kind === "input" &&
            r.action === "operation_end" &&
            r.operationId === operationId,
        );
        assert.ok(end, "operation settlement frame required");
        const acknowledgment = finalObserver.find(
          (r) => r.kind === "output" && r.id === end.id,
        );
        assert.equal(acknowledgment?.result?.ok, true);
        assert.equal(acknowledgment?.result?.released, true);
      }
      await rm(join(dir, "agent"), { recursive: true });
      await rm(settings);
      lines.close();
      write("events.json", events);
      write("result.json", {
        ok: true,
        commandHost,
        hostVersion: version,
        pathMapping: {
          hostCwd: dir,
          workerLaunchCwd: wsl ? dir : "unchanged launcher cwd",
          workerCwd: wsl ? windowsDir : "unchanged launcher cwd",
          hostSettings: wsl ? "settings.json" : settings,
          workerSettings: wsl ? "settings.json" : settings,
          workerTrace: wsl ? mappedPath(trace, "-w") : trace,
          windowsWorker,
          settingsForwarding: wsl
            ? "child-only WSLENV PI_CU_SETTINGS_FILE, relative without path translation"
            : "unchanged native environment",
        },
        preflight,
        hashes,
        hostPid: host.pid,
        hostPin,
        workerPid,
        cancellationProof,
        operationA: pending.operationId,
        operationB: frames[1].operationId,
        command: stop,
        toolResults: toolEnds(),
        settlements: events.filter((e) => e.type === "agent_settled"),
        observedIdentities: allIdentities,
        remaining,
        observedLinuxIdentities: allLinuxIdentities,
        linuxRemaining,
        physicalInput: false,
        isolatedSettingsRemoved: true,
        scope: wsl
          ? "actual WSL2 Pi RPC/registered command and real Windows worker with scripted provider; not physical/DSH/real-model acceptance"
          : "actual native Windows Pi RPC/registered command with scripted provider; not physical/WSL/DSH/real-model acceptance",
      });
      write("owner.json", { phase: "complete", cleanupAuthorized: true });
      console.log(JSON.stringify({ ok: true, dir, physicalInput: false }));
    },
    { deadlineMs: 120000, writeOwner: (state) => write("owner.json", state) },
  );
}
