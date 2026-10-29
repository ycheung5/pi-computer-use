// Focused visible-browser diagnostic. No dialogs, native input, clipboard or daily profile.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import computerUse from "../dist/extension.js";
import { computerUseHost } from "./native-host.mjs";

assert.equal(process.platform, "win32", "Run with Windows Node");
const run = promisify(execFile);
const folder = await mkdtemp(join(tmpdir(), "pi-cu-foreground-"));
process.env.PI_CU_SETTINGS_FILE = join(folder, "settings.json");
await writeFile(
  process.env.PI_CU_SETTINGS_FILE,
  JSON.stringify({
    browserApp: "edge",
    browserVisible: true,
    browserSignIn: false,
  }),
);
const server = createServer((_request, response) => {
  response.setHeader("content-type", "text/html; charset=utf-8");
  response.end(
    '<!doctype html><title>Isolated foreground fixture</title><label>Editor<input value="initial"></label><button onclick="this.textContent=\'Clicked fixture\'">Ordinary action</button>',
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const host = computerUseHost();
computerUse(host.api);
const call = async (action, args) => {
  const tool = host.tools.get(`windows_computer_use_${action}`);
  assert.ok(tool);
  const result = (await tool.execute(action, args, undefined, undefined, {}))
    .details;
  assert.equal(result.ok, true, JSON.stringify(result));
  return result;
};
const probeScript = `Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class ForegroundEvidence{[StructLayout(LayoutKind.Sequential)]public struct LastInput{public uint size;public uint time;}[DllImport("user32.dll")]public static extern IntPtr GetForegroundWindow();[DllImport("user32.dll")]public static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);[DllImport("user32.dll")]public static extern bool GetLastInputInfo(ref LastInput i);}';$h=[ForegroundEvidence]::GetForegroundWindow();$ownerId=[uint32]0;$null=[ForegroundEvidence]::GetWindowThreadProcessId($h,[ref]$ownerId);$lastInfo=[ForegroundEvidence+LastInput]::new();$lastInfo.size=8;$null=[ForegroundEvidence]::GetLastInputInfo([ref]$lastInfo);$name=try{(Get-Process -Id $ownerId -ErrorAction Stop).ProcessName}catch{'unknown'};@{hwnd=$h.ToInt64();processId=$ownerId;processName=$name;lastInputTick=$lastInfo.time;probePid=$PID}|ConvertTo-Json -Compress`;
const stages = [];
const sample = async (stage) => {
  const operation = run(
    "powershell.exe",
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(probeScript, "utf16le").toString("base64"),
    ],
    { windowsHide: true, timeout: 10000, maxBuffer: 65536 },
  );
  operation.child.stdin.end();
  const result = await operation;
  const evidence = { stage, ...JSON.parse(result.stdout.trim()) };
  stages.push(evidence);
  return evidence;
};
let browserPid;
try {
  await sample("before-open");
  const opened = await call("set_value", {
    elementId: "new-tab",
    value: `http://127.0.0.1:${server.address().port}/`,
  });
  const tab = opened.tab.id;
  await sample("after-open");
  const listed = await call("list_windows", {});
  browserPid = listed.browserLane.browsers[0].processId;
  const find = async (query, role) => {
    const result = await call("find", { browserTab: tab, query });
    const entry = result.results.find((node) => node.id && node.role === role);
    assert.ok(entry);
    return entry.id;
  };
  const editor = await find("Editor", "textbox"),
    button = await find("Ordinary action", "button");
  await sample("after-read");
  await call("set_value", { elementId: editor, value: "background value" });
  await sample("after-value");
  await call("click", { elementId: button });
  await sample("after-nonmodal-click");
  await host.emit("agent_settled", { aborted: false });
  await sample("after-settlement");
} finally {
  for (const shutdown of host.shutdown) await shutdown();
  await sample("after-dispose");
  await new Promise((resolve) => server.close(resolve));
  await rm(folder, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}
const baseline = stages[0];
const changes = stages.filter(
  (sample) =>
    sample.hwnd !== baseline.hwnd || sample.processId !== baseline.processId,
);
const contaminated = stages.some(
  (sample) => sample.processId === sample.probePid,
);
const inputChanged = stages.some(
  (sample) => sample.lastInputTick !== baseline.lastInputTick,
);
const classification = contaminated
  ? "probe-console-interference"
  : changes.length === 0
    ? "preserved"
    : inputChanged
      ? "input-changed-inconclusive"
      : changes.some((sample) => sample.processId === browserPid)
        ? "browser-acquired-foreground"
        : "unexplained-foreground-change";
const report = {
  ok: classification === "preserved",
  browserPid,
  classification,
  stages,
  physicalInput: false,
  nativeProbeWindowsHidden: true,
  modalsUsed: false,
};
console.log(JSON.stringify(report));
if (classification !== "preserved") process.exitCode = 1;
