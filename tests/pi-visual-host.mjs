// Opt-in real Pi task; the default plan never imports compiled code or opens Windows.
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { writeFileSync } from "node:fs";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { traceWithoutImages } from "./pi-visual-fixture.mjs";

export const requested = {
  provider: "openai",
  model: "gpt-6.1-sol",
  thinkingLevel: "low",
};
export function effectiveMetadataMatches(rows, expected = requested) {
  return (
    rows.length > 0 &&
    rows.every(
      (row) =>
        row.provider === expected.provider &&
        row.model === expected.model &&
        row.thinkingLevel === expected.thinkingLevel,
    )
  );
}
// Bounded duplication of the browser host's retention rule; no shared framework/refactor.
export async function keepVisualOwnership(
  child,
  collect,
  { deadlineMs, writeOwner },
) {
  let retained, retention;
  const retain = (reason) => {
    if (retention) return retention;
    retained = reason;
    retention = new Promise(() =>
      setInterval(() => {
        void child.pid;
      }, 60000),
    );
    child.stdout?.resume();
    child.stderr?.resume();
    try {
      writeOwner({
        phase: "retained",
        reason,
        keeperPid: process.pid,
        childPid: child.pid,
        cleanupAuthorized: false,
      });
    } catch {
      /* Preserve actual ownership when the journal is unavailable. */
    }
    console.log(
      JSON.stringify({
        status: "retained",
        reason,
        keeperPid: process.pid,
        childPid: child.pid,
        cleanupAuthorized: false,
      }),
    );
    return retention;
  };
  const watchdog = setTimeout(() => {
    void retain("visual-host-deadline-ownership-retained");
  }, deadlineMs);
  try {
    const result = await collect(() => {
      if (retained) throw Error("owner retained");
    });
    if (retained) return await retain(retained);
    clearTimeout(watchdog);
    return result;
  } catch {
    clearTimeout(watchdog);
    return await retain("visual-collector-error-ownership-retained");
  }
}

// The Windows side reuses native-ocr's already compiled, pinned child and private oracle.
export async function serveVisualFixture({
  fixture,
  fixtureLines,
  folder,
  executable,
  handle,
  title,
  pipeName,
}) {
  const { default: net } = await import("node:net");
  const closed = once(fixture, "close");
  fixture.stderr.resume();
  let dead = false,
    stopping = false,
    queue = Promise.resolve();
  fixture.on("exit", () => {
    dead = true;
  });
  const identity = () => {
    const script = `$ErrorActionPreference='Stop'; $p=Get-CimInstance Win32_Process -Filter 'ProcessId = ${fixture.pid}' -ErrorAction Stop; if($null -eq $p){throw 'owned fixture absent'}; @{pid=$p.ProcessId;creation=$p.CreationDate.ToUniversalTime().ToString('o');executable=$p.ExecutablePath}|ConvertTo-Json -Compress`;
    return JSON.parse(
      execFileSync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", script],
        { encoding: "utf8", windowsHide: true },
      ),
    );
  };
  let pinned;
  try {
    pinned = identity();
    if (pinned.executable.toLowerCase() !== executable.toLowerCase())
      throw Error("wrong fixture executable");
  } catch (error) {
    fixture.stdin.write("stop\n");
    await closed;
    fixtureLines.close();
    await fs.rm(folder, { recursive: true, force: true });
    throw error;
  }
  const server = net.createServer((socket) => {
    let data = "";
    socket.on("data", (bytes) => {
      data += bytes;
      if (!data.includes("\n")) return;
      socket.removeAllListeners("data");
      queue = queue.then(async () => {
        try {
          const { action } = JSON.parse(data);
          if (action === "oracle") {
            if (dead || stopping) throw Error("owned fixture unavailable");
            const current = identity();
            if (
              current.pid !== pinned.pid ||
              current.creation !== pinned.creation ||
              current.executable !== pinned.executable
            )
              throw Error("owned process changed");
            const next = once(fixtureLines, "line");
            fixture.stdin.write("oracle\n");
            const [line] = await next,
              oracle = JSON.parse(line);
            if (
              oracle.target.nativeWindowHandle !== handle ||
              oracle.target.processId !== fixture.pid
            )
              throw Error("owned root changed");
            socket.end(
              JSON.stringify({ ok: true, ...oracle, identity: current }) + "\n",
            );
            return;
          }
          if (action !== "stop") throw Error("unsupported private IPC command");
          stopping = true;
          fixture.stdin.write("stop\n");
          await closed;
          fixtureLines.close();
          await fs.rm(folder, { recursive: true, force: true });
          const script = `$ErrorActionPreference='Stop'; $p=Get-CimInstance Win32_Process -Filter 'ProcessId = ${fixture.pid}' -ErrorAction Stop; if($null -eq $p){'absent'}else{throw 'owned PID still present'}`;
          const absent =
            execFileSync(
              "powershell.exe",
              ["-NoProfile", "-NonInteractive", "-Command", script],
              { encoding: "utf8", windowsHide: true },
            ).trim() === "absent";
          socket.end(
            JSON.stringify({
              ok: absent,
              fixtureRetired: absent,
              folderRemoved: true,
              identity: pinned,
            }) + "\n",
          );
          server.close();
        } catch (error) {
          socket.end(
            JSON.stringify({ ok: false, error: String(error) }) + "\n",
          );
        }
      });
    });
  });
  await new Promise((resolve) =>
    server.listen("\\\\.\\pipe\\" + pipeName, resolve),
  );
  console.log(
    JSON.stringify({
      ready: true,
      nativeWindowHandle: handle,
      processId: fixture.pid,
      title,
      pipeName,
      identity: pinned,
    }),
  );
  await once(server, "close");
}

const clientCode = `const net=require('node:net');const socket=net.connect('\\\\\\\\.\\\\pipe\\\\'+process.argv[1]);let data='';const timer=setTimeout(()=>process.exit(1),10000);socket.on('connect',()=>socket.write(JSON.stringify({action:process.argv[2]})+'\\n'));socket.on('data',b=>data+=b);socket.on('end',()=>{clearTimeout(timer);const r=JSON.parse(data);console.log(JSON.stringify(r));if(!r.ok)process.exitCode=1});socket.on('error',()=>{clearTimeout(timer);process.exitCode=1});`;

async function run(runs) {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const { nativeWorkerLaunch } = await import("../dist/launcher.js");
  const native = await nativeWorkerLaunch();
  const translate = (path) =>
    process.platform === "win32"
      ? path
      : execFileSync("wslpath", ["-w", path], { encoding: "utf8" }).trim();
  const cli = join(
    dirname(
      fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")),
    ),
    "bundle",
    "cli.js",
  );
  const revision = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  const sources = {};
  for (const name of [
    "tests/pi-visual-host.mjs",
    "tests/pi-visual-fixture.mjs",
    "tests/native-ocr.mjs",
    "tests/ocr-fixture.cs",
    "assets/accessibility.cs",
    "dist/extension.js",
    "dist/worker.js",
  ])
    sources[name] = createHash("sha256")
      .update(await fs.readFile(join(root, name)))
      .digest("hex");
  const output = await fs.mkdtemp(join(tmpdir(), "pi-visual-model-")),
    reports = [];
  const workerPath = translate(join(root, "dist/worker.js")).replace(
    /'/g,
    "''",
  );
  const queryWorkers = () => {
    const script = `$ErrorActionPreference='Stop'; $all=@(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction Stop); $owned=@($all|Where-Object {$_.CommandLine -and $_.CommandLine.Contains('${workerPath}')}|ForEach-Object {@{pid=$_.ProcessId;creation=$_.CreationDate.ToUniversalTime().ToString('o')}});ConvertTo-Json -Compress -InputObject @($owned)`;
    const powershell =
      process.platform === "win32"
        ? "powershell.exe"
        : "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe";
    const result = JSON.parse(
      execFileSync(
        powershell,
        [
          "-NoProfile",
          "-NonInteractive",
          "-EncodedCommand",
          Buffer.from(script, "utf16le").toString("base64"),
        ],
        {
          encoding: "utf8",
          timeout: 15000,
          stdio: ["ignore", "pipe", "ignore"],
        },
      ),
    );
    if (!Array.isArray(result)) throw Error("strict worker query unavailable");
    return result;
  };
  for (let reset = 1; reset <= runs; reset++) {
    const dir = await fs.mkdtemp(join(output, `${reset}-`));
    const write = (name, value) =>
      fs.writeFile(join(dir, name), JSON.stringify(value, null, 2) + "\n", {
        mode: 0o600,
      });
    const journal = (name, value) =>
      writeFileSync(join(dir, name), JSON.stringify(value) + "\n", {
        mode: 0o600,
      });
    const server = spawn(
      native.executable,
      [
        translate(join(root, "tests/native-ocr.mjs")),
        "--visual-server",
        "pi-cu-visual-" + randomUUID(),
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    server.stderr.resume();
    const serverClosed = once(server, "close").catch(() => [
      null,
      "launch-error",
    ]);
    const completed = await keepVisualOwnership(
      server,
      async (assertFixtureActive) => {
        const lines = createInterface({ input: server.stdout }),
          [line] = await once(lines, "line");
        const owned = { ...JSON.parse(line), windowsNode: native.executable };
        if (!owned.ready) throw Error("fixture not ready");
        const ipc = (action) =>
          JSON.parse(
            execFileSync(
              native.executable,
              ["-e", clientCode, owned.pipeName, action],
              { encoding: "utf8", timeout: 15000 },
            ),
          );
        const initial = ipc("oracle");
        if (
          !initial.ok ||
          initial.approve.count !== 0 ||
          initial.ignore.count !== 0
        )
          throw Error("fixture not fresh");
        await write("preflight.json", { owned, initial });
        journal("fixture-owner.json", {
          phase: "running",
          keeperPid: process.pid,
          expiresAt: Date.now() + 300000,
        });
        journal("owner.json", {
          phase: "running",
          keeperPid: process.pid,
          expiresAt: Date.now() + 240000,
        });
        const prompt = `Our disposable visual form is HWND ${owned.nativeWindowHandle}, PID ${owned.processId}, title ${JSON.stringify(owned.title)}. Read the random code painted beside APPROVE, activate that associated control exactly once, and report the code. Leave IGNORE unchanged. Use supported owned-window observations, images/OCR, and semantic Invoke; discover controls from public results and treat their IDs as opaque. Use window-only capture (captureWindow:true on snapshots), activate:false, and fallbackClick:false. Do not use keyboard, pointer, clipboard, app launch, other windows, or a desktop image. Stop on cancellation, uncertain effects, unsafe capture or cleanup.`;
        const tools = [
          "snapshot",
          "accessibility_tree",
          "find",
          "element_info",
          "ocr",
          "screenshot",
          "invoke",
        ]
          .map((name) => "windows_computer_use_" + name)
          .join(",");
        const args = [
          cli,
          "--mode",
          "json",
          "--print",
          "--no-session",
          "--no-extensions",
          "--no-context-files",
          "--no-skills",
          "--no-prompt-templates",
          "--no-themes",
          "--no-mcp",
          "--provider",
          requested.provider,
          "--model",
          requested.model,
          "--thinking",
          requested.thinkingLevel,
          "--tools",
          tools,
          "-e",
          join(root, "tests/pi-visual-fixture.mjs"),
          "--",
          prompt,
        ];
        const pi = spawn(process.execPath, args, {
          cwd: root,
          env: {
            ...process.env,
            PI_CU_VISUAL_SPEC: JSON.stringify({ dir, owned, clientCode }),
          },
          stdio: ["pipe", "pipe", "pipe"],
        });
        const closed = once(pi, "close").catch(() => [null, "launch-error"]);
        pi.stdin.on("error", () => {});
        pi.stdin.end();
        pi.stderr.resume();
        const report = await keepVisualOwnership(
          pi,
          async (assertPiActive) => {
            let settled = false,
              aborted = null,
              sequence = 0,
              finalReport = null,
              observedWorkers = [];
            const effective = [],
              tools = [];
            for await (const line of createInterface({ input: pi.stdout })) {
              const event = JSON.parse(line); // Parse/IO/query failures retain ownership, never authorize teardown.
              await fs.appendFile(
                join(dir, "trace.jsonl"),
                JSON.stringify({
                  sequence: ++sequence,
                  event: traceWithoutImages(event),
                }) + "\n",
                { mode: 0o600 },
              );
              if (event.type === "agent_settled") {
                settled = true;
                aborted = event.aborted ?? null;
              }
              if (
                event.type === "message_end" &&
                event.message?.role === "assistant"
              ) {
                const { provider, model, thinkingLevel, api } = event.message;
                effective.push({ provider, model, thinkingLevel, api });
                const text = event.message.content
                  ?.filter((part) => part.type === "text")
                  .map((part) => part.text)
                  .join("\n");
                if (text) finalReport = text;
              }
              if (event.type === "tool_execution_end") {
                if (!observedWorkers.length) observedWorkers = queryWorkers();
                tools.push({
                  tool: event.toolName,
                  ok: event.result?.details?.ok ?? null,
                  error: event.result?.details?.error ?? null,
                  isError: event.result?.isError === true,
                });
              }
            }
            const [exitCode, signal] = await closed,
              remainingWorkers = queryWorkers();
            const workerRetired =
              observedWorkers.length > 0 && remainingWorkers.length === 0;
            if (!settled || !workerRetired)
              throw Error(
                "Pi settlement or strict worker retirement unconfirmed",
              );
            const oracle = ipc("oracle"),
              metadataMatched = effectiveMetadataMatches(effective);
            const codeReported =
              typeof oracle.approve?.code === "string" &&
              new RegExp("\\b" + oracle.approve.code + "\\b").test(
                finalReport ?? "",
              );
            assertPiActive();
            return {
              revision,
              sources,
              reset,
              preparation:
                "coordinator-preopened owned painted form; model only observes and invokes",
              requested,
              effective,
              settled,
              aborted,
              exitCode,
              signal,
              tools,
              finalReport,
              metadataMatched,
              oracle,
              codeReported,
              cleanupAuthorized: true,
              workerCleanup: {
                querySucceeded: true,
                observedWorkers,
                remainingWorkers,
                workerRetired,
              },
              pass:
                exitCode === 0 &&
                aborted === false &&
                metadataMatched &&
                oracle.ok === true &&
                oracle.approve.count === 1 &&
                oracle.ignore.count === 0 &&
                codeReported,
            };
          },
          {
            deadlineMs: 240000,
            writeOwner: (state) => journal("owner.json", state),
          },
        );
        await write("result-before-cleanup.json", report);
        assertFixtureActive();
        const cleanup = ipc("stop"),
          [serverExitCode] = await serverClosed;
        lines.close();
        if (!cleanup.ok || serverExitCode !== 0)
          throw Error("fixture cleanup unconfirmed");
        const disk = await Promise.all(
          ["trace.jsonl", "guard.jsonl"].map((name) =>
            fs.readFile(join(dir, name), "utf8"),
          ),
        );
        const imageFreeDiskTraces = disk.every(
          (text) =>
            !text.includes("iVBOR") && !/"(?:data|base64)"\s*:/.test(text),
        );
        const result = {
          ...report,
          fixtureCleanup: cleanup,
          serverExitCode,
          imageFreeDiskTraces,
          pass: report.pass && imageFreeDiskTraces,
        };
        await write("result.json", result);
        reports.push({ dir, pass: result.pass });
        console.log(JSON.stringify(reports.at(-1)));
        return result;
      },
      {
        deadlineMs: 300000,
        writeOwner: (state) => journal("fixture-owner.json", state),
      },
    );
    if (!completed.pass) {
      process.exitCode = 1;
      break;
    }
  }
  await fs.writeFile(
    join(output, "summary.json"),
    JSON.stringify(
      { reports, pass: reports.every((report) => report.pass) },
      null,
      2,
    ) + "\n",
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  let runs = 1;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--runs") runs = Number(args[++i]);
    else if (!["--run", "--plan"].includes(args[i]))
      throw Error("unknown option");
  }
  if (!Number.isInteger(runs) || runs < 1 || runs > 3)
    throw Error("runs must be 1..3");
  if (!args.includes("--run"))
    console.log(
      JSON.stringify({
        run: false,
        scenario: "owned visual association",
        runs,
        requested,
        physicalInput: false,
      }),
    );
  else await run(runs);
}
