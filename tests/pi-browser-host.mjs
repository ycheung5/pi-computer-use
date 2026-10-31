// Real models are opt-in; planning never imports compiled code or starts a child.
import {
  actualText,
  brief,
  heldState,
  scenarios,
  verifyOutcome,
} from "./pi-browser-fixture.mjs";

const options = {
  runs: 1,
  requested: { provider: "openai", model: "gpt-6.1-sol", thinking: "low" },
};
try {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (key === "--plan") options.plan = true;
    else if (
      ["--scenario", "--runs", "--provider", "--model", "--thinking"].includes(
        key,
      )
    ) {
      const value = args[++i];
      if (!value || value.startsWith("--")) throw Error("Missing option value");
      if (key === "--scenario") options.scenario = value;
      else if (key === "--runs") options.runs = Number(value);
      else options.requested[key.slice(2)] = value;
    } else throw Error("Unknown option");
  }
  if (options.scenario && ![...scenarios, "all"].includes(options.scenario))
    throw Error("Unknown scenario");
  if (
    !Number.isSafeInteger(options.runs) ||
    options.runs < 1 ||
    options.runs > 3
  )
    throw Error("Use one to three resets");
  const selected =
    options.scenario && options.scenario !== "all"
      ? [options.scenario]
      : scenarios;
  if (options.plan)
    console.log(
      JSON.stringify({
        mode: "plan",
        scenarios: selected,
        runs: options.runs,
        requested: options.requested,
      }),
    );
  else if (!options.scenario)
    throw Error("Select an explicit --scenario for live execution");
  else await live(selected, options);
} catch (error) {
  console.error(error.message);
  process.exitCode = 2;
}
async function live(selected, options) {
  const timeoutMs = Number(process.env.PI_CU_TEST_TIMEOUT_MS ?? 180000);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 180000)
    throw Error("PI_CU_TEST_TIMEOUT_MS must be between 50 and 180000");
  const { spawn, execFileSync } = await import("node:child_process");
  const fs = await import("node:fs/promises");
  const { once } = await import("node:events");
  const { createInterface } = await import("node:readline");
  const { createHash, randomUUID } = await import("node:crypto");
  const { tmpdir } = await import("node:os");
  const { join, dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const { nativeWorkerLaunch } = await import("../dist/launcher.js");
  const root = fileURLToPath(new URL("../", import.meta.url));
  const native = await nativeWorkerLaunch();
  const win = (code) =>
    JSON.parse(
      execFileSync(native.executable, ["-e", code], {
        encoding: "utf8",
        timeout: 15000,
        stdio: ["ignore", "pipe", "ignore"],
      }),
    );
  const translate = (path) =>
    process.platform === "win32"
      ? path
      : execFileSync("wslpath", ["-w", path], { encoding: "utf8" }).trim();
  const output =
    process.env.PI_CU_RELEASE_OUTPUT ??
    (await fs.mkdtemp(join(tmpdir(), "pi-browser-model-")));
  await fs.mkdir(output, { recursive: true, mode: 0o700 });
  const cli = join(
    dirname(
      fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")),
    ),
    "bundle",
    "cli.js",
  );
  const hash = async (path) =>
    createHash("sha256")
      .update(await fs.readFile(path))
      .digest("hex");
  const revision = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  const piVersion = JSON.parse(
    await fs.readFile(
      join(dirname(dirname(dirname(cli))), "package.json"),
      "utf8",
    ),
  ).version;
  const runtime = win(
    "console.log(JSON.stringify({nodeVersion:process.version,windowsRelease:require('node:os').release()}))",
  );
  const manifest = {};
  for (const path of [
    "src/browser.ts",
    "src/worker.ts",
    "dist/browser.js",
    "dist/worker.js",
    "tests/browser-actions-server.mjs",
    "tests/pi-browser-fixture.mjs",
    "tests/pi-browser-host.mjs",
    "tests/pi-host-command.mjs",
  ])
    manifest[path] = await hash(join(root, path));
  const reports = [];
  for (const scenario of selected)
    for (let reset = 1; reset <= options.runs; reset++) {
      const dir = await fs.mkdtemp(join(output, `${scenario}-${reset}-`));
      const journal = join(dir, "owner.json"),
        auditFile = join(dir, "tools.jsonl");
      const write = async (name, value) => {
        const target = join(dir, name),
          temporary = join(dir, `${name}.${randomUUID()}.tmp`);
        await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
          mode: 0o600,
        });
        await fs.rename(temporary, target);
      };
      const ownership = {
        phase: "starting",
        keeperPid: process.pid,
        scenario,
        reset,
        revision,
        timeoutMs,
        dir,
      };
      let retention,
        nativePrepared,
        nativeReady,
        observedNativeWorkers = [];
      const retain = async (reason) => {
        if (retention) return retention;
        retention = new Promise(() => setInterval(() => {}, 60000));
        ownership.phase = "retained";
        ownership.reason = reason;
        await write("owner.json", ownership);
        await write("report.json", {
          scenario,
          reset,
          retained: true,
          reason,
          journal,
          keeperPid: process.pid,
          verification: { pass: false },
        });
        console.log(
          JSON.stringify({
            status: "retained",
            reason,
            journal,
            keeperPid: process.pid,
          }),
        );
        // Keep the actual owner's pipes/resources referenced. Investigation must settle ownership.
        await retention;
      };
      await write("owner.json", ownership);
      try {
        const profile = win(
          "const fs=require('node:fs'),os=require('node:os'),p=require('node:path');console.log(JSON.stringify(fs.mkdtempSync(p.join(os.tmpdir(),'pi-model-profile-'))))",
        );
        ownership.profile = profile;
        if (scenario === "mixed") {
          for (const path of [
            "tests/pi-visual-host.mjs",
            "tests/pi-visual-fixture.mjs",
            "tests/native-ocr.mjs",
            "tests/ocr-fixture.cs",
            "assets/accessibility.cs",
            "assets/capture.cs",
            "assets/window-references.cs",
            "dist/capture.js",
          ])
            manifest[path] = await hash(join(root, path));
          const { prepareOwnedVisualFixture } = await import(
            "./pi-visual-host.mjs"
          );
          nativePrepared = prepareOwnedVisualFixture(native, root, true);
          ownership.nativeFixtureChildPid = nativePrepared.server.pid;
          await write("owner.json", ownership);
          nativeReady = await nativePrepared.ready();
          await write("native-fixture-owner.json", {
            phase: "running",
            expiresAt: Date.now() + 300000,
          });
        }
        const server = spawn(
          native.executable,
          [
            translate(join(root, "tests/browser-actions-server.mjs")),
            "edge",
            "false",
            ...(nativeReady
              ? [
                  JSON.stringify({
                    pipe: "\\\\.\\pipe\\" + nativeReady.owned.pipeName,
                    identity: nativeReady.owned.identity,
                  }),
                ]
              : []),
          ],
          {
            stdio: ["pipe", "pipe", "pipe"],
            windowsHide: true,
            env: {
              ...process.env,
              PI_CU_PARTIAL_FIXTURE: scenario === "partial" ? "1" : "0",
              PI_CU_HELD_FIXTURE: scenario === "cancel" ? "1" : "0",
              WSLENV: `${process.env.WSLENV ?? ""}:PI_CU_PARTIAL_FIXTURE:PI_CU_HELD_FIXTURE`,
            },
          },
        );
        server.stderr.resume();
        ownership.fixtureChildPid = server.pid;
        const serverClosed = once(server, "close").catch(() => null),
          lines = createInterface({ input: server.stdout });
        const sourceLine = await Promise.race([
          once(lines, "line"),
          serverClosed.then(() => null),
          new Promise((resolve) => setTimeout(() => resolve(null), 10000)),
        ]);
        if (!sourceLine) await retain("fixture-start-unconfirmed");
        let source;
        try {
          source = JSON.parse(sourceLine[0]);
        } catch {
          await retain("fixture-address-unconfirmed");
        }
        if (!/^http:\/\/127\.0\.0\.1:\d+\/$/.test(source.url))
          await retain("fixture-address-untrusted");
        ownership.fixtureUrl = source.url;
        if (nativeReady) source.native = nativeReady.owned;
        ownership.phase = "running";
        ownership.expiresAt = Date.now() + timeoutMs;
        await write("owner.json", ownership);
        const ownedState = () => {
          const prefix = profile.replaceAll("'", "''");
          const ps = `$ErrorActionPreference='Stop';$p='${prefix}';$a=@(Get-CimInstance Win32_Process -ErrorAction Stop -Filter "Name='msedge.exe'"|Where-Object {$_.CommandLine -and $_.CommandLine.Contains($p)});$r=$a|Where-Object {$_.CommandLine -notmatch '--type='}|Select-Object -First 1;$v=if($r.ExecutablePath){(Get-Item -LiteralPath $r.ExecutablePath).VersionInfo.ProductVersion}else{$null};[Console]::Write((@{count=$a.Count;version=$v}|ConvertTo-Json -Compress))`;
          return win(
            `const fs=require('node:fs'),p=require('node:path'),cp=require('node:child_process');const n=cp.execFileSync(p.join(process.env.WINDIR,'System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoProfile','-EncodedCommand',${JSON.stringify(Buffer.from(ps, "utf16le").toString("base64"))}],{encoding:'utf8'}).trim();const s=JSON.parse(n);if(!Number.isInteger(s.count))throw Error('process evidence unavailable');console.log(JSON.stringify({browserVersion:s.version,profileEmpty:fs.readdirSync(${JSON.stringify(profile)}).length===0,processCount:s.count}))`,
          );
        };
        if (scenario === "partial") {
          await write("fixture-readiness.json", {
            ready: source.partialFixture === true,
          });
          if (source.partialFixture !== true)
            throw Error("PARTIAL_FIXTURE_NOT_READY: refusing model startup");
        }
        if (scenario === "cancel") {
          await write("fixture-readiness.json", {
            ready: source.heldReady === true,
          });
          if (
            source.heldReady !== true ||
            !source.heldUrl?.startsWith(source.url + "held-")
          )
            throw Error("HELD_FIXTURE_NOT_READY");
        }
        const cancel =
          scenario === "cancel"
            ? {
                heldUrl: source.heldUrl,
                hash: createHash("sha256").update(source.heldUrl).digest("hex"),
                trace: join(dir, "worker.jsonl"),
                windowsTrace: translate(join(dir, "worker.jsonl")),
                windowsNode: native.executable,
              }
            : undefined;
        const spec = {
          ...(cancel ? { cancel } : {}),
          scenario,
          base: source.url,
          upload: source.upload,
          auditFile,
          journal,
          ...(nativeReady
            ? {
                native: {
                  owned: nativeReady.owned,
                  clientCode: nativeReady.clientCode,
                  fixtureJournal: join(dir, "native-fixture-owner.json"),
                },
              }
            : {}),
        };
        const names = [
          "snapshot",
          "accessibility_tree",
          "find",
          "element_info",
          "wait_for",
          "set_value",
          "invoke",
          "focus",
          "click",
          "scroll",
          "type_text",
          "keypress",
          "screenshot",
          "close_window",
          "wait",
          ...(nativeReady ? ["ocr"] : []),
        ]
          .map((n) => `windows_computer_use_${n}`)
          .join(",");
        const env = {
          ...process.env,
          PI_CU_TEST_SPEC: JSON.stringify(spec),
          PI_CU_SETTINGS_FILE: source.settings,
          PI_CU_BROWSER_PROFILE_ROOT: profile,
          WSLENV: `${process.env.WSLENV ?? ""}:PI_CU_SETTINGS_FILE:PI_CU_BROWSER_PROFILE_ROOT`,
        };
        const pi = spawn(
          process.execPath,
          [
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
            options.requested.provider,
            "--model",
            options.requested.model,
            "--thinking",
            options.requested.thinking,
            "--tools",
            names,
            "-e",
            join(root, "tests/pi-browser-fixture.mjs"),
            "--",
            brief(scenario, source),
          ],
          { cwd: root, env, stdio: ["pipe", "pipe", "pipe"] },
        );
        ownership.piPid = pi.pid;
        await write("owner.json", ownership);
        const piClosed = once(pi, "close").catch(() => [null, "launch-error"]);
        pi.stdin.end();
        pi.stderr.resume();
        const facts = {
          base: source.url,
          requested: options.requested,
          effective: [],
          lifecycle: { settled: false },
          observations: [],
          audit: [],
          downloads: [],
          downloadName: source.downloadName,
          advancedObserved: {},
        };
        if (nativeReady)
          facts.native = {
            owned: nativeReady.owned,
            initial: nativeReady.initial,
          };
        const sanitize = nativeReady
          ? (await import("./pi-visual-fixture.mjs")).traceWithoutImages
          : (value) => value;
        let unsafe = false,
          stopped = false,
          parseError = false,
          toolStarts = 0;
        const watchdog = setTimeout(() => {
          void retain("host-deadline-ownership-retained");
        }, timeoutMs);
        for await (const line of createInterface({ input: pi.stdout })) {
          let event;
          try {
            event = JSON.parse(line);
          } catch {
            parseError = true;
            continue;
          }
          let saved;
          if (
            event.type === "message_end" &&
            event.message?.role === "assistant"
          ) {
            const { provider, model, thinkingLevel, api, stopReason } =
              event.message;
            facts.effective.push({ provider, model, thinkingLevel, api });
            const text = (event.message.content ?? [])
              .filter((c) => c.type === "text")
              .map((c) => c.text)
              .join("\n");
            if (text) facts.finalReport = text;
            if (scenario === "cancel" && stopReason === "stop" && text)
              facts.completionClaim = true;
            saved = {
              type: event.type,
              provider,
              model,
              thinkingLevel,
              stopReason,
              text,
            };
          } else if (
            event.type.startsWith("tool_execution_") ||
            event.type === "agent_settled"
          )
            saved = event;
          if (saved)
            await fs.appendFile(
              join(dir, "trace.jsonl"),
              `${JSON.stringify(sanitize(saved))}\n`,
              { mode: 0o600 },
            );
          if (event.type === "tool_execution_start") toolStarts++;
          if (event.type === "agent_settled")
            facts.lifecycle = { settled: true, aborted: event.aborted };
          if (event.type !== "tool_execution_end") continue;
          if (nativePrepared && !observedNativeWorkers.length)
            observedNativeWorkers = nativePrepared.queryWorkers();
          const d = event.result?.details;
          if (d) facts.observations.push(d);
          if (d?.cleanupConfirmed === false) unsafe = true;
          if (/COMPUTER_USE_(?:STOPPED|CANCELLED)/.test(String(d?.error ?? "")))
            stopped = true;
          if (d?.ok !== true) continue;
          if (d.tab && !facts.browser) {
            try {
              facts.browser = {
                app: "edge",
                version: ownedState().browserVersion,
              };
            } catch {
              facts.browser = { app: "edge", version: null };
            }
          }
          const text = actualText(d),
            u = d.tab?.url,
            observed = facts.advancedObserved;
          if (u === `${source.url}child` && text.includes("Child fixture"))
            observed.child = true;
          if (
            observed.child &&
            u === `${source.url}advanced` &&
            text.includes("Advanced browser fixture")
          )
            observed.returned = true;
          if (text.includes("Prompt: fixture answer 中文"))
            observed.prompt = true;
          if (
            u === `${source.url}advanced` &&
            text.includes("Prompt: continue 中文")
          )
            facts.promptObserved = true;
          if (text.includes("Confirm: false")) observed.confirm = true;
          if (text.includes("Uploaded: fixture-upload.txt"))
            observed.upload = true;
          facts.downloads.push(...(d.downloads ?? []));
        }
        const [exitCode, signal] = await piClosed;
        clearTimeout(watchdog);
        if (scenario === "cancel") {
          const current = JSON.parse(await fs.readFile(journal, "utf8"));
          if (current.phase === "retained") await retain(current.reason);
        }
        if (ownership.phase === "retained") await retain(ownership.reason);
        facts.lifecycle = { ...facts.lifecycle, exitCode, signal, parseError };
        let state;
        try {
          state = ownedState();
        } catch {
          await retain("owned-process-or-profile-evidence-unavailable");
        }
        if (
          unsafe ||
          parseError ||
          (!facts.lifecycle.settled && toolStarts > 0) ||
          !state.profileEmpty ||
          state.processCount !== 0
        )
          await retain("host-or-browser-cleanup-unconfirmed");
        facts.cleanup = state;
        if (cancel) {
          const {
            commandRows,
            commandWorkerIdentity,
            assessCommandSettlement,
          } = await import("./pi-host-command.mjs");
          const audit = (await fs.readFile(auditFile, "utf8"))
            .split("\n")
            .filter(Boolean)
            .map((line) => JSON.parse(line));
          const rows = commandRows(cancel.trace, true),
            triggers = audit.filter((row) => row.type === "controlled_cancel"),
            pins = audit.filter((row) => row.type === "cancel_worker_pin");
          if (
            pins.length !== 1 ||
            commandWorkerIdentity(native.executable, pins[0].pin.pid)
          )
            await retain("cancel-worker-retirement-unknown");
          const pending = triggers[0]?.pending,
            assessment = pending
              ? assessCommandSettlement(pending, rows)
              : { status: "unexercised" };
          if (pending && assessment.status !== "observed")
            await retain("cancel-settlement-unconfirmed");
          const stop = rows.find(
            (row) =>
              row.kind === "input" &&
              row.pid === pending?.pid &&
              row.sequence > pending.sequence &&
              row.sequence < assessment.response?.sequence &&
              (row.stop === pending.operationId || row.cancel === pending.id),
          );
          facts.cancel = {
            pending,
            assessment,
            workerPin: pins[0].pin,
            workerRetired: true,
            triggerCount: triggers.length,
            noPostStopBusiness: Boolean(
              stop &&
                !rows.some(
                  (row) =>
                    row.kind === "input" &&
                    row.sequence > stop.sequence &&
                    row.action &&
                    row.action !== "operation_end",
                ),
            ),
            noCompletionClaim: !facts.completionClaim,
          };
        }
        if (nativePrepared) {
          const remainingWorkers = nativePrepared.queryWorkers();
          if (!observedNativeWorkers.length || remainingWorkers.length)
            await retain("mixed-native-worker-retirement-unconfirmed");
          facts.native.workerRetired = true;
          facts.native.workerCleanup = {
            observedNativeWorkers,
            remainingWorkers,
          };
          facts.native.final = nativeReady.ipc("oracle");
          facts.native.receipt = win(
            `fetch(${JSON.stringify(source.url + "mixed/receipt")}).then(r=>r.json()).then(v=>console.log(JSON.stringify(v)))`,
          );
        }
        try {
          facts.audit = (await fs.readFile(auditFile, "utf8"))
            .trim()
            .split("\n")
            .filter(Boolean)
            .map((l) => JSON.parse(l));
          if (scenario === "cancel") {
            facts.cancel.http = await heldState(source.url);
          } else if (scenario === "advanced") {
            const files = new Map(
              facts.downloads
                .filter(
                  (f) =>
                    f.state === "completed" &&
                    f.name === source.downloadName &&
                    typeof f.file === "string",
                )
                .map((f) => [f.file, f]),
            );
            const file = files.size === 1 ? [...files.values()][0] : null;
            const evidence = win(
              `const fs=require('node:fs/promises'),p=require('node:path');(async()=>{const oracle=await(await fetch(${JSON.stringify(`${source.url}advanced/state`)})).json();const f=${JSON.stringify(file)};let exact=false;if(f&&p.basename(f.file)===${JSON.stringify(source.downloadName)}){exact=await fs.readFile(f.file,'utf8')==='download fixture only';if(exact)await fs.rm(f.file);}console.log(JSON.stringify({oracle,exact}));})()`,
            );
            facts.oracle = evidence.oracle;
            facts.downloadExact = evidence.exact;
          } else {
            const { formState } = await import("./pi-browser-fixture.mjs");
            facts.oracle = await formState(source.url);
          }
        } catch {
          facts.oracleUnavailable = true;
        }
        server.stdin.end();
        const closed = await Promise.race([
          serverClosed,
          new Promise((resolve) => setTimeout(() => resolve(null), 10000)),
        ]);
        if (closed?.[0] !== 0) await retain("fixture-exit-unconfirmed");
        lines.close();
        if (nativePrepared) {
          facts.native.cleanup = nativeReady.ipc("stop");
          const retired = await Promise.race([
            nativePrepared.closed,
            new Promise((resolve) => setTimeout(() => resolve(null), 10000)),
          ]);
          if (!facts.native.cleanup.ok || retired?.[0] !== 0)
            await retain("mixed-native-fixture-cleanup-unconfirmed");
          nativePrepared.lines.close();
          await write("native-fixture-owner.json", { phase: "settled" });
        }
        facts.cleanup.fixtureExited = true;
        ownership.phase = "settled";
        await write("owner.json", ownership);
        const report = {
          scenario,
          reset,
          revision,
          manifest,
          piVersion,
          runtime,
          facts,
          verification: verifyOutcome(scenario, facts),
        };
        await write("report.json", report);
        reports.push({
          scenario,
          reset,
          report: join(dir, "report.json"),
          pass: report.verification.pass,
        });
        console.log(JSON.stringify(reports.at(-1)));
        if (stopped || facts.lifecycle.aborted) {
          process.exitCode =
            scenario === "cancel" && report.verification.pass ? 0 : 1;
          return;
        }
      } catch {
        await retain("collector-error-ownership-retained");
      }
    }
  await fs.writeFile(
    join(output, "summary.json"),
    `${JSON.stringify({ reports, pass: reports.every((r) => r.pass) }, null, 2)}\n`,
    { mode: 0o600 },
  );
  if (reports.some((r) => !r.pass)) process.exitCode = 1;
}
