// Passive diagnostic: compare a direct managed UIA cache read to provider entry.
import assert from "node:assert/strict";
import { execFile, spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

if (process.argv.slice(2).join(" ") === "--plan") {
  console.log(
    JSON.stringify({
      executed: false,
      physicalInput: false,
      cases: ["provider.platform-normalization"],
    }),
  );
  process.exit(0);
}
assert.equal(process.argv.length, 2, "Unknown argument");
assert.equal(process.platform, "win32", "Run on an interactive Windows host");
const folder = await mkdtemp(join(tmpdir(), "pi-cu-provider-platform-"));
let child, result;
try {
  const framework = join(
    process.env.WINDIR,
    "Microsoft.NET",
    "Framework64",
    "v4.0.30319",
  );
  const exe = join(folder, "fixture.exe");
  const refs = [
    "UIAutomationClient.dll",
    "UIAutomationProvider.dll",
    "UIAutomationTypes.dll",
    "WindowsBase.dll",
  ].map((x) => `/r:${join(framework, "WPF", x)}`);
  const build = spawnSync(
    join(framework, "csc.exe"),
    [
      "/nologo",
      "/target:exe",
      `/out:${exe}`,
      "/r:System.Windows.Forms.dll",
      "/r:System.Drawing.dll",
      ...refs,
      fileURLToPath(new URL("./nullable-uia-fixture.cs", import.meta.url)),
    ],
    { encoding: "utf8", windowsHide: true },
  );
  assert.equal(build.status, 0, build.stdout + build.stderr);
  child = spawn(exe, [], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    cwd: folder,
  });
  const lines = createInterface({ input: child.stdout });
  const iterator = lines[Symbol.asyncIterator]();
  async function next() {
    let timer;
    try {
      return await Promise.race([
        iterator.next().then((x) => {
          if (x.done) throw new Error("Fixture exited");
          return x.value.trim();
        }),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Fixture response timeout")),
            10000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  async function command(s) {
    child.stdin.write(s + "\n");
    return next();
  }
  const hwnd = Number(await next());
  assert.ok(hwnd > 0 && child.pid > 0);
  const h = (await command("child-handle")).match(/^child-handle:(\d+)$/);
  assert.ok(h);
  assert.equal(await command("arm:unavailable"), "armed");
  const ps = `$ErrorActionPreference='Stop'; Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes; $e=[System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]${h[1]}); $c=New-Object System.Windows.Automation.CacheRequest; $c.TreeScope=[System.Windows.Automation.TreeScope]::Element; $c.TreeFilter=[System.Windows.Automation.Automation]::RawViewCondition; $c.AutomationElementMode=[System.Windows.Automation.AutomationElementMode]::Full; foreach($n in @('Name','AutomationId','ClassName','ControlType','BoundingRectangle','IsEnabled','IsOffscreen','HasKeyboardFocus','ProcessId','NativeWindowHandle','RuntimeId','FrameworkId')) {$c.Add([System.Windows.Automation.AutomationElement]::("${"$"}{n}Property"))}; try {$v=$e.GetUpdatedCache($c); @{observation='returned';name=$v.Cached.Name}|ConvertTo-Json -Compress} catch {@{observation='exception';type=$_.Exception.GetType().FullName;message=$_.Exception.Message}|ConvertTo-Json -Compress}`;
  const run = promisify(execFile)(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(ps, "utf16le").toString("base64"),
    ],
    { timeout: 12000, windowsHide: true },
  );
  const entry = await next();
  assert.equal(entry, "provider:entered:unavailable");
  const { stdout } = await run;
  const observation = JSON.parse(stdout.replace(/^\uFEFF/, ""));
  assert.ok(["returned", "exception"].includes(observation.observation));
  result = {
    ok: true,
    physicalInput: false,
    entry,
    observation,
    scope:
      "direct-child compact managed cache; not the DSH walker or an engine comparison",
  };
} finally {
  if (child && child.exitCode === null && child.signalCode === null) {
    const closed = once(child, "close");
    child.stdin.end("stop\n");
    await Promise.race([
      closed,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("Fixture cleanup unconfirmed")),
          5000,
        ),
      ),
    ]);
  }
  await rm(folder, { recursive: true, force: true });
}

console.log(JSON.stringify({ ...result, fixtureCleanupConfirmed: true }));
