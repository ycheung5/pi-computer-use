// Paired public tool workflows on a disposable local form and isolated headless profiles.
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { WorkerClient } from "../dist/client.js";
import { nativeWorkerLaunch } from "../dist/launcher.js";
import { ReferenceClient, referenceResult } from "./reference-client.mjs";

const run = promisify(execFile);
assert.ok(process.argv[2], "Pass the reference checkout path");
if (process.platform === "linux") {
  const launch = await nativeWorkerLaunch();
  const translate = async (p) =>
    (await run("wslpath", ["-w", resolve(p)])).stdout.trim();
  const script = await translate(fileURLToPath(import.meta.url));
  const reference = await translate(process.argv[2]);
  const output = process.env.PI_CU_RELEASE_OUTPUT
    ? await translate(process.env.PI_CU_RELEASE_OUTPUT)
    : undefined;
  const code = `import{pathToFileURL}from'node:url';${output ? `process.env.PI_CU_RELEASE_OUTPUT=${JSON.stringify(output)};` : "delete process.env.PI_CU_RELEASE_OUTPUT;"}process.argv=[process.execPath,${JSON.stringify(script)},${JSON.stringify(reference)},...${JSON.stringify(process.argv.slice(3))}];await import(pathToFileURL(${JSON.stringify(script)}).href);`;
  const pending = run(launch.executable, ["--input-type=module", "-e", code], {
    cwd: launch.cwd,
    timeout: 240000,
    maxBuffer: 8 * 1024 * 1024,
  });
  pending.child.stdin.end();
  try {
    const result = await pending;
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
  } catch (error) {
    process.stdout.write(error.stdout ?? "");
    process.stderr.write(error.stderr ?? String(error));
    process.exitCode = Number.isInteger(error.code) ? error.code : 1;
  }
  process.exit(process.exitCode ?? 0);
}
assert.equal(process.platform, "win32");
const reference = resolve(process.argv[2]);
const app = process.argv[3] ?? "edge";
assert.ok(["edge", "chrome"].includes(app), "Use edge or chrome");
const repetitions = Number(process.argv[4] ?? 1);
assert.ok(
  Number.isSafeInteger(repetitions) && repetitions >= 1 && repetitions <= 3,
);
const root = fileURLToPath(new URL("../", import.meta.url));
const folder = await mkdtemp(join(tmpdir(), "pi-browser-comparison-"));
const report = {
  diagnosticInjection: process.argv.includes("--verify-unfilled"),
  ok: false,
  check: "paired browser form",
  app,
  repetitions,
  nodeVersion: process.version,
  physicalInput: false,
  clipboardMutation: false,
  cases: [],
  cleanup: {},
};
const expected = {
  name: "Pi 中文 café 😀",
  notes: "First line\n第二行 café 😀",
  accepted: true,
  choice: "beta",
};
let server, serverClosed;
let active;
let cleanupUnconfirmed = false;
const quote = (text) => `'${text.replaceAll("'", "''")}'`;
const powershell = async (script) =>
  (
    await run(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        Buffer.from(script, "utf16le").toString("base64"),
      ],
      { windowsHide: true, cwd: folder },
    )
  ).stdout.trim();
const desktop = async () =>
  JSON.parse(
    await powershell(
      `Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class BrowserComparisonDesktop{[StructLayout(LayoutKind.Sequential)]public struct Point{public int X;public int Y;}[StructLayout(LayoutKind.Sequential)]public struct Last{public uint size;public uint tick;}[DllImport("user32.dll")]public static extern IntPtr GetForegroundWindow();[DllImport("user32.dll")]public static extern bool GetCursorPos(out Point p);[DllImport("user32.dll")]public static extern bool GetLastInputInfo(ref Last i);public static string Read(){Point p;GetCursorPos(out p);Last i=new Last();i.size=(uint)Marshal.SizeOf(i);GetLastInputInfo(ref i);return "{\\"foreground\\":"+GetForegroundWindow().ToInt64()+",\\"x\\":"+p.X+",\\"y\\":"+p.Y+",\\"inputTick\\":"+i.tick+"}";}}'; [BrowserComparisonDesktop]::Read()`,
    ),
  );
const closeChild = async (child) => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const closed = new Promise((resolveClosed) =>
    child.once("close", resolveClosed),
  );
  child.stdin.end();
  let deadline;
  try {
    await Promise.race([
      closed,
      new Promise((_, reject) => {
        deadline = setTimeout(() => {
          child.kill();
          reject(new Error("Fixture cleanup unconfirmed"));
        }, 8000);
      }),
    ]);
  } finally {
    clearTimeout(deadline);
  }
};
const entries = (raw) =>
  raw.content?.filter((x) => x.type === "text").map((x) => x.text) ?? [];
const resultOf = (raw) => {
  const result = referenceResult(raw);
  return {
    ...result,
    text:
      result.text ??
      entries(raw)
        .filter((x) => {
          try {
            JSON.parse(x);
            return false;
          } catch {
            return true;
          }
        })
        .join("\n"),
  };
};
try {
  const candidates =
    app === "edge"
      ? [
          join(
            process.env["ProgramFiles(x86)"],
            "Microsoft",
            "Edge",
            "Application",
            "msedge.exe",
          ),
          join(
            process.env.ProgramFiles,
            "Microsoft",
            "Edge",
            "Application",
            "msedge.exe",
          ),
        ]
      : [
          join(
            process.env.ProgramFiles,
            "Google",
            "Chrome",
            "Application",
            "chrome.exe",
          ),
          join(
            process.env["ProgramFiles(x86)"],
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
  assert.ok(executable, `${app} installed executable unavailable`);
  report.executable = executable;
  report.browserVersion = await powershell(
    `(Get-Item -LiteralPath ${quote(executable)}).VersionInfo.ProductVersion`,
  );
  report.referenceVersion = JSON.parse(
    await readFile(join(reference, "package.json"), "utf8"),
  ).version;
  report.piVersion = JSON.parse(
    await readFile(join(root, "package.json"), "utf8"),
  ).version;
  report.fixtureSha256 = createHash("sha256")
    .update(await readFile(join(root, "tests", "browser-actions-server.mjs")))
    .digest("hex");
  server = spawn(
    process.execPath,
    [join(root, "tests", "browser-actions-server.mjs"), app, "false"],
    { cwd: folder, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
  );
  serverClosed = new Promise((resolveClosed) =>
    server.once("close", resolveClosed),
  );
  let diagnostic = "";
  server.stderr.on("data", (b) => {
    diagnostic += b;
  });
  const lines = createInterface({ input: server.stdout });
  const source = await new Promise((resolveSource, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Browser fixture timeout: ${diagnostic}`)),
      10000,
    );
    lines.once("line", (line) => {
      clearTimeout(timer);
      resolveSource(JSON.parse(line));
    });
    server.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  const settings = {
    browserApp: app,
    browserVisible: false,
    browserSignIn: false,
    indicatorEnabled: false,
    cursorIndicatorEnabled: false,
  };
  const settingsPath = join(folder, "settings.json");
  await writeFile(settingsPath, JSON.stringify(settings));
  process.env.PI_CU_SETTINGS_FILE = settingsPath;
  process.env.PI_CU_BROWSER_EXECUTABLE = executable;
  process.env.PI_CU_BROWSER_PROFILE_ROOT = join(folder, "pi-profiles");
  let halted = false;
  for (let index = 0; index < repetitions; index++)
    for (const engine of index % 2
      ? ["pi", "reference"]
      : ["reference", "pi"]) {
      const row = {
        engine,
        repetition: index + 1,
        status: "blocked",
        steps: [],
        cleanupConfirmed: false,
      };
      report.cases.push(row);
      if (halted) {
        row.error = "Earlier stop or uncertain cleanup blocked this case";
        continue;
      }
      const started = performance.now();
      let phase = "startup";
      try {
        if (engine === "reference") {
          active = new ReferenceClient(reference, {
            cwd: folder,
            env: {
              WCU_BROWSER_APP: app,
              WCU_BROWSER_EXE: executable,
              WCU_BROWSER_HEADLESS: "1",
              WCU_BROWSER_SIGNIN: "0",
              WCU_BROWSER_PROFILE: join(folder, "reference-profiles"),
              WCU_SETTINGS_JSON: JSON.stringify(settings),
            },
          });
          await active.init();
        } else {
          const worker = new WorkerClient({
            launch: async () => ({
              executable: process.execPath,
              args: [join(root, "dist", "worker.js")],
              cwd: folder,
            }),
            timeoutMs: 60000,
          });
          const operation = randomUUID();
          active = {
            call: (action, args) =>
              worker.execute(action, args, undefined, operation),
            close: () => worker.dispose(),
          };
        }
        const call = async (action, args) => {
          const raw = await active.call(action, args);
          const result = engine === "reference" ? resultOf(raw) : raw;
          if (result.ok !== true) {
            const error = new Error(`${action}: ${JSON.stringify(result)}`);
            error.toolResult = result;
            throw error;
          }
          return { result, raw };
        };
        const before = await desktop();
        phase = "open";
        const { result: opened } = await call("set_value", {
          elementId: "new-tab",
          value: `${source.url}form`,
        });
        const tab = (opened.tab ?? opened.opened).id;
        assert.ok(tab);
        const { result: listed } = await call("list_windows", {
          maxWindows: 1,
        });
        const ownedBrowser = listed.browserLane.browsers.find((browser) =>
          browser.tabs.some((item) => item.id === tab),
        );
        assert.ok(
          ownedBrowser,
          "The opened tab belongs to an advertised owned browser",
        );
        assert.ok(Number.isSafeInteger(ownedBrowser.processId));
        const actualBrowser = JSON.parse(
          await powershell(
            `$ownedBrowser=Get-CimInstance Win32_Process -Filter 'ProcessId = ${ownedBrowser.processId}'; if(-not $ownedBrowser){throw 'Owned browser disappeared'}; @{headless=($ownedBrowser.CommandLine -match '--headless');executable=$ownedBrowser.ExecutablePath;version=(Get-Item -LiteralPath $ownedBrowser.ExecutablePath).VersionInfo.ProductVersion}|ConvertTo-Json -Compress`,
          ),
        );
        assert.equal(actualBrowser.headless, true);
        assert.equal(
          actualBrowser.executable.toLowerCase(),
          executable.toLowerCase(),
        );
        assert.equal(actualBrowser.version, report.browserVersion);
        row.browser = actualBrowser;
        assert.equal(
          await (await fetch(`${source.url}form/state`)).json(),
          null,
          "Fresh navigation resets independent submission state",
        );
        row.initialSubmission = null;
        const lookup = async (name, role) => {
          const { result } = await call("find", {
            browserTab: tab,
            query: name,
          });
          const found = result.results.filter(
            (x) =>
              x.id &&
              x.name === name &&
              (!role || x.role.toLowerCase() === role),
          );
          assert.equal(found.length, 1, JSON.stringify(result));
          return found[0];
        };
        const find = async (name, role) => (await lookup(name, role)).id;
        phase = "read and inspect";
        const { result: tree } = await call("accessibility_tree", {
          browserTab: tab,
        });
        assert.match(tree.text, /Paired browser form fixture/);
        const name = await find("Name", "textbox");
        const notes = await find("Notes", "textbox");
        const choice = await find("Choice", "combobox");
        const accepted = await find("Accept terms", "checkbox");
        const disabledNode = await lookup("Disabled field", "textbox");
        const readonlyNode = await lookup("Read-only field", "textbox");
        const disabled = (
          await call("element_info", { elementId: disabledNode.id })
        ).result;
        const readonly = (
          await call("element_info", { elementId: readonlyNode.id })
        ).result;
        const d = disabled.element ?? disabled,
          r = readonly.element ?? readonly;
        assert.equal(d.value, "Disabled value");
        assert.equal(d.disabled ?? disabledNode.disabled, true);
        assert.equal(r.value, "Read-only value");
        row.restrictedInspection = {
          disabled: d.disabled ?? disabledNode.disabled,
          readonly: r.readonly ?? readonlyNode.readonly ?? null,
          initialValues: { disabled: d.value, readonly: r.value },
          edited: false,
        };
        row.steps.push({ phase, status: "pass" });
        phase = "fill";
        if (!process.argv.includes("--verify-unfilled")) {
          await call("set_value", { elementId: name, value: "seed" });
          await call("focus", { elementId: name });
          await call("keypress", { browserTab: tab, keys: ["ctrl", "a"] });
          await call("type_text", { browserTab: tab, text: expected.name });
          await call("set_value", { elementId: notes, value: expected.notes });
          await call("set_value", { elementId: choice, value: "Beta" });
          await call("set_value", { elementId: accepted, value: "true" });
          row.steps.push({ phase, status: "pass" });
        }
        phase = "submit";
        const { result: submitted } = await call("click", {
          elementId: await find("Submit form", "button"),
        });
        assert.equal(submitted.verification, "sent");
        row.actionEvidence = {
          verification: submitted.verification,
          pageChange: submitted.pageChange ?? null,
          hasFreshText: !!submitted.text,
        };
        const { result: confirmed } = await call("wait_for", {
          browserTab: tab,
          condition: "text",
          query: '"choice"',
          timeoutMs: 3000,
        });
        assert.equal(confirmed.verification, "observed");
        row.submitted = await (await fetch(`${source.url}form/state`)).json();
        if (process.argv.includes("--verify-unfilled"))
          row.cause = "test-defect";
        assert.deepEqual(row.submitted, expected);
        row.steps.push({ phase, status: "pass" });
        phase = "delayed confirmation";
        await call("invoke", {
          elementId: await find("Start delayed result", "button"),
        });
        const { result: delayed } = await call("wait_for", {
          browserTab: tab,
          condition: "text",
          query: "Delayed result ready",
          timeoutMs: 3000,
        });
        assert.equal(delayed.verification, "observed");
        row.delayedVerification = delayed.verification;
        row.steps.push({ phase, status: "pass" });
        phase = "scroll and screenshot";
        const { result: scrolled } = await call("scroll", {
          browserTab: tab,
          deltaY: 600,
        });
        assert.ok(scrolled.pageScroll.after[1] > scrolled.pageScroll.before[1]);
        row.pageScroll = scrolled.pageScroll;
        const shot = await call("screenshot", {
          browserTab: tab,
          maxWidth: 400,
        });
        const base64 =
          engine === "reference"
            ? shot.raw.content.find((x) => x.type === "image")?.data
            : shot.result.screenshot?.base64;
        assert.ok(base64);
        const png = Buffer.from(base64, "base64");
        assert.equal(png.readUInt32BE(0), 0x89504e47);
        assert.equal(png.readUInt32BE(16), 400);
        row.screenshot = {
          width: png.readUInt32BE(16),
          height: png.readUInt32BE(20),
        };
        row.steps.push({ phase, status: "pass" });
        phase = "restricted values after actions";
        const postDisabled = (
          await call("element_info", {
            elementId: await find("Disabled field", "textbox"),
          })
        ).result;
        const postReadonly = (
          await call("element_info", {
            elementId: await find("Read-only field", "textbox"),
          })
        ).result;
        row.restrictedInspection.postActionValues = {
          disabled: (postDisabled.element ?? postDisabled).value,
          readonly: (postReadonly.element ?? postReadonly).value,
        };
        assert.deepEqual(row.restrictedInspection.postActionValues, {
          disabled: "Disabled value",
          readonly: "Read-only value",
        });
        row.restrictedInspection.valuesPreserved = true;
        row.steps.push({ phase, status: "pass" });
        phase = "document identity";
        await call("set_value", {
          elementId: `${tab}:address`,
          value: `${source.url}form`,
        });
        const staleRaw = await active.call("element_info", { elementId: name });
        const stale = engine === "reference" ? resultOf(staleRaw) : staleRaw;
        assert.equal(stale.ok, false);
        assert.match(String(stale.error), /STALE|document|node|observed/i);
        row.staleReference = { ok: stale.ok, error: stale.error };
        assert.equal(
          await (await fetch(`${source.url}form/state`)).json(),
          null,
        );
        row.steps.push({ phase, status: "pass" });
        const after = await desktop();
        row.desktop = { before, after };
        assert.deepEqual(
          after,
          before,
          "Headless page workflow preserves native foreground/pointer/input tick",
        );
        row.status = "pass";
      } catch (error) {
        row.status = "fail";
        row.phase = phase;
        row.error = String(error);
        row.cause ??= "unknown";
        if (error.toolResult) row.toolResult = error.toolResult;
        if (/cancel|stop|cleanup unconfirmed/i.test(String(error)))
          halted = true;
      } finally {
        if (active) {
          try {
            await active.close();
            row.cleanupConfirmed = true;
          } catch (error) {
            row.cleanupError = String(error);
            cleanupUnconfirmed = true;
            row.status = "fail";
            halted = true;
          }
          active = undefined;
        }
        row.durationMs = Math.round(performance.now() - started);
      }
    }
} catch (error) {
  report.startupError = String(error);
} finally {
  if (active) {
    try {
      await active.close();
    } catch (error) {
      report.cleanup.controllerError = String(error);
      cleanupUnconfirmed = true;
    }
  }
  if (server) {
    try {
      await closeChild(server);
      await serverClosed;
      report.cleanup.fixtureConfirmed = true;
    } catch (error) {
      report.cleanup.fixtureError = String(error);
      cleanupUnconfirmed = true;
    }
  }
  if (cleanupUnconfirmed) {
    report.cleanup.retainedFolder = folder;
    report.cleanup.folderError =
      "Owned folder retained because cleanup is unconfirmed";
  } else {
    try {
      await rm(folder, { recursive: true, force: true });
      report.cleanup.folderRemoved = true;
    } catch (error) {
      report.cleanup.folderError = String(error);
    }
  }
}
report.ok =
  report.cases.length === repetitions * 2 &&
  report.cases.every((x) => x.status === "pass" && x.cleanupConfirmed) &&
  report.cleanup.fixtureConfirmed === true &&
  report.cleanup.folderRemoved === true;
if (process.env.PI_CU_RELEASE_OUTPUT) {
  await mkdir(process.env.PI_CU_RELEASE_OUTPUT, { recursive: true });
  await writeFile(
    join(process.env.PI_CU_RELEASE_OUTPUT, "browser-comparison.json"),
    JSON.stringify(report, null, 2),
  );
}
console.log(JSON.stringify(report));
if (!report.ok) process.exitCode = 1;
