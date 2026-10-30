// Test-only paired window management on disposable fixtures; no keyboard/mouse input.
import assert from "node:assert/strict";

const options = process.argv.slice(2);
for (const arg of options)
  assert.ok(
    arg === "--plan" || /^--(engine|reference)=.+/.test(arg),
    `Unknown option: ${arg}`,
  );
const option = (name) =>
  options.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const engine = option("engine") ?? "pi";
assert.ok(
  ["pi", "reference"].includes(engine),
  "engine must be pi or reference",
);
if (options.includes("--plan")) {
  console.log(
    JSON.stringify({
      engine,
      executed: false,
      physicalInput: false,
      foregroundChangesPossible: true,
      cases: [
        "launch",
        "worker-survival",
        "wrong-owner",
        "move",
        "activate",
        "close-veto",
        "close",
        "stale-identity",
      ],
    }),
  );
  process.exit(0);
}
assert.equal(
  process.env.PI_CU_WINDOW_MANAGEMENT_TEST,
  "1",
  "PI_CU_WINDOW_MANAGEMENT_TEST=1 requires an authorized desktop; this activates an owned window",
);
assert.equal(process.platform, "win32", "Run with Windows Node");

const referencePath = option("reference");
if (engine === "reference")
  assert.ok(referencePath, "reference engine requires --reference");
const [
  { spawnSync },
  { mkdtemp, readFile, rm },
  { tmpdir },
  { join },
  { setTimeout: delay },
  { fileURLToPath },
  { randomUUID },
  { createComparisonClient },
] = await Promise.all([
  import("node:child_process"),
  import("node:fs/promises"),
  import("node:os"),
  import("node:path"),
  import("node:timers/promises"),
  import("node:url"),
  import("node:crypto"),
  import("./comparison-client.mjs"),
]);
const folder = await mkdtemp(join(tmpdir(), "pi-cu-paired-management-"));
const executable = join(folder, "Fixture app.exe");
const events = join(folder, "fixture-events.txt");
const title = `Pi paired window ${randomUUID()}`;
const report = {
  engine,
  check: "paired-window-management",
  physicalInput: false,
  title,
  steps: [],
  cleanupConfirmed: false,
};
process.env.PI_CU_SETTINGS_FILE = join(folder, "settings.json");
let client;
let identity;
let startTicks;
let launchDispatched = false;
let launchConfirmed = false;
let controllerConfirmed = true;
let primaryFailure;

// Independent OS query: never rely on a remembered operation target for foreground or bounds.
const ps = (source, payload) => {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64",
  );
  const script = `$d=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'))|ConvertFrom-Json;${source}`;
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(script, "utf16le").toString("base64"),
    ],
    { encoding: "utf8", windowsHide: true, cwd: folder, timeout: 12000 },
  );
  if (result.status !== 0)
    throw new Error(`OS observation failed: ${result.error ?? result.stderr}`);
  return JSON.parse(result.stdout.trim());
};
const probe = ({ nativeWindowHandle, processId }) =>
  ps(
    `
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class PiCuManagementProbe {
 [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left,Top,Right,Bottom; }
 [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out Rect r);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
'@;
$h=[IntPtr]::new([long]$d.hwnd); $exists=[PiCuManagementProbe]::IsWindow($h);
[uint32]$windowPid=0; $rect=New-Object PiCuManagementProbe+Rect;
if ($exists) { [void][PiCuManagementProbe]::GetWindowThreadProcessId($h,[ref]$windowPid); [void][PiCuManagementProbe]::GetWindowRect($h,[ref]$rect) }
$foreground=[PiCuManagementProbe]::GetForegroundWindow(); [uint32]$foregroundPid=0; [void][PiCuManagementProbe]::GetWindowThreadProcessId($foreground,[ref]$foregroundPid);
$p=Get-Process -Id ([int]$d.pid) -ErrorAction SilentlyContinue; $alive=$null -ne $p; $pathMatch=$false; $started=$null;
if ($alive) { try { $pathMatch=$p.Path -eq $d.exe; $started=$p.StartTime.ToUniversalTime().Ticks.ToString() } catch { } }
@{exists=$exists;windowPid=$windowPid;foregroundHandle=$foreground.ToInt64();foregroundPid=$foregroundPid;processAlive=$alive;processPathMatches=$pathMatch;processStartTicks=$started;bounds=@{x=$rect.Left;y=$rect.Top;width=$rect.Right-$rect.Left;height=$rect.Bottom-$rect.Top}}|ConvertTo-Json -Compress
`,
    { hwnd: nativeWindowHandle, pid: processId, exe: executable },
  );
const cleanupOwned = () =>
  ps(
    `
$stopped=@(); $remaining=@();
foreach($p in @(Get-Process -Name ([IO.Path]::GetFileNameWithoutExtension($d.exe)) -ErrorAction SilentlyContinue)) {
  try { if($p.Path -ne $d.exe) { continue }; $started=$p.StartTime.ToUniversalTime().Ticks.ToString();
    if($d.pid -and ($p.Id -ne [int]$d.pid -or $started -ne $d.started)) { $remaining+=@{pid=$p.Id;reason='identity-mismatch'};continue }
    Stop-Process -Id $p.Id -Force -ErrorAction Stop; $p.WaitForExit(5000)|Out-Null;
    if(-not $p.HasExited){$remaining+=@{pid=$p.Id;reason='still-alive'}} else {$stopped+=@{pid=$p.Id;startTicks=$started}}
  } catch { $remaining+=@{pid=$p.Id;reason='cleanup-unconfirmed'} }
}
@{stopped=$stopped;remaining=$remaining}|ConvertTo-Json -Compress -Depth 4
`,
    {
      exe: executable,
      pid: identity?.processId ?? 0,
      started: startTicks ?? "",
    },
  );
const step = async (name, run) => {
  const entry = { name, tools: [] };
  report.steps.push(entry);
  try {
    entry.observed = await run();
    entry.status = entry.observed?.outcome === "refused" ? "blocked" : "pass";
    return entry.observed;
  } catch (error) {
    entry.status = "fail";
    entry.error = String(error);
    if (error.observation) entry.observation = error.observation;
    throw error;
  }
};
const call = async (action, args) => {
  try {
    const value = await client.execute(action, args);
    // list_windows includes arbitrary user titles. Store only the owned target.
    if (action === "list_windows") {
      const matches = (value.windows ?? []).filter(
        (window) => window.name === title,
      );
      report.steps.at(-1).tools.push({
        action,
        ok: value.ok,
        observedWindowCount: value.windows?.length ?? 0,
        matches,
      });
    } else report.steps.at(-1).tools.push({ action, result: value });
    return value;
  } catch (error) {
    report.steps.at(-1).tools.push({
      action,
      error: String(error),
      rpcError: error.rpcError,
    });
    throw error;
  }
};
const find = async () => {
  const listed = await call("list_windows", {
    includeInvisible: true,
    maxWindows: 200,
  });
  assert.equal(listed.ok, true, JSON.stringify(listed.error));
  const matches = (listed.windows ?? []).filter(
    (window) => window.name === title,
  );
  assert.ok(
    matches.length <= 1,
    "fixture title must uniquely identify one window",
  );
  return matches[0];
};
const until = async (description, fn) => {
  const deadline = performance.now() + 10000;
  do {
    const value = await fn();
    if (value) return value;
    await delay(100);
  } while (performance.now() < deadline);
  throw new Error(`${description} observation timed out`);
};
const requireOwner = (sample) => {
  assert.equal(sample.exists, true, "owned window must exist");
  assert.equal(
    sample.windowPid,
    identity.processId,
    "OS window owner must match observed PID",
  );
  assert.equal(sample.processAlive, true, "fixture process must still exist");
  assert.equal(
    sample.processPathMatches,
    true,
    "fixture process executable must match unique owned path",
  );
  assert.ok(
    sample.processStartTicks,
    "fixture process creation identity must be available",
  );
  if (startTicks)
    assert.equal(
      sample.processStartTicks,
      startTicks,
      "process identity must not have changed",
    );
  return sample;
};
try {
  const compiler = join(
    process.env.WINDIR,
    "Microsoft.NET",
    "Framework64",
    "v4.0.30319",
    "csc.exe",
  );
  const compiled = spawnSync(
    compiler,
    [
      "/nologo",
      "/target:exe",
      `/out:${executable}`,
      "/r:System.Windows.Forms.dll",
      fileURLToPath(new URL("./window-management-fixture.cs", import.meta.url)),
    ],
    { encoding: "utf8", windowsHide: true, cwd: folder },
  );
  assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
  client = await createComparisonClient({ engine, referencePath, cwd: folder });
  await step("launch", async () => {
    // Mark uncertain before dispatch: a timeout must never authorize replay.
    launchDispatched = true;
    const result = await call("launch_app", {
      target: executable,
      arguments: `"${title}" veto-once "${events}"`,
      workingDirectory: folder,
      waitMs: 150,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    launchConfirmed = true;
    const window = await until("launched fixture", find);
    identity = {
      nativeWindowHandle: window.nativeWindowHandle,
      processId: window.processId,
    };
    assert.ok(
      Number.isSafeInteger(identity.nativeWindowHandle) &&
        identity.nativeWindowHandle > 0,
    );
    assert.ok(
      Number.isSafeInteger(identity.processId) && identity.processId > 0,
    );
    const sample = requireOwner(probe(identity));
    startTicks = sample.processStartTicks;
    return { identity, os: sample };
  });
  await step("worker-survival", async () => {
    await client.dispose();
    client = undefined;
    const sample = requireOwner(probe(identity));
    client = await createComparisonClient({
      engine,
      referencePath,
      cwd: folder,
    });
    return { os: sample };
  });
  await step("wrong-owner", async () => {
    const before = requireOwner(probe(identity));
    const result = await call("move_window", {
      ...identity,
      processId: identity.processId + 99999,
      x: before.bounds.x + 20,
      y: before.bounds.y + 20,
    });
    const after = requireOwner(probe(identity));
    try {
      assert.equal(result.ok, false, "wrong PID must not be accepted");
      assert.deepEqual(
        after.bounds,
        before.bounds,
        "wrong owner must not move fixture",
      );
    } catch (error) {
      error.observation = { before, after };
      throw error;
    }
    return { before, after };
  });
  await step("move", async () => {
    const before = requireOwner(probe(identity));
    const expected = { x: before.bounds.x + 20, y: before.bounds.y + 20 };
    const result = await call("move_window", { ...identity, ...expected });
    assert.equal(result.ok, true, JSON.stringify(result));
    const after = await until("window movement", async () => {
      const sample = requireOwner(probe(identity));
      return sample.bounds.x === expected.x && sample.bounds.y === expected.y
        ? sample
        : undefined;
    });
    assert.equal(after.bounds.width, before.bounds.width);
    assert.equal(after.bounds.height, before.bounds.height);
    return { before, after };
  });
  await step("activate", async () => {
    const before = requireOwner(probe(identity));
    const result = await call("activate_window", identity);
    const after = requireOwner(probe(identity));
    try {
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(
        typeof result.activated,
        "boolean",
        "activation must state its outcome",
      );
    } catch (error) {
      error.observation = { before, after };
      throw error;
    }
    const isForeground =
      after.foregroundHandle === identity.nativeWindowHandle &&
      after.foregroundPid === identity.processId;
    if (result.activated)
      assert.equal(
        isForeground,
        true,
        "claimed activation must be independently observed",
      );
    else assert.ok(result.warning, "refusal must include a warning");
    return {
      before,
      after,
      outcome: result.activated ? "observed" : "refused",
      independentForeground: isForeground,
    };
  });
  await step("close-veto", async () => {
    const before = requireOwner(probe(identity));
    const result = await call("close_window", identity);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.posted, true, "close must be dispatched once");
    await until("fixture veto", async () =>
      (await readFile(events, "utf8").catch(() => "")).includes("veto\n"),
    );
    const after = requireOwner(probe(identity));
    return { before, after, fixtureEvent: "veto" };
  });
  await step("close", async () => {
    const result = await call("close_window", identity);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.posted, true);
    const after = await until("fixture process exit", async () => {
      const sample = probe(identity);
      return !sample.exists && !sample.processAlive ? sample : undefined;
    });
    assert.match(await readFile(events, "utf8"), /(?:^|\n)close\n/);
    return { after, fixtureEvent: "close" };
  });
  await step("stale-identity", async () => {
    const result = await call("activate_window", identity);
    assert.equal(result.ok, false, "closed fixture identity must be rejected");
    const after = probe(identity);
    assert.equal(after.exists, false);
    assert.equal(after.processAlive, false);
    return { after };
  });
} catch (error) {
  primaryFailure = String(error);
} finally {
  try {
    if (client) await client.dispose();
  } catch (error) {
    controllerConfirmed = false;
    report.controllerCleanupError = String(error);
  }
  const cleanupFixture = async () => {
    if (launchDispatched) {
      if (!controllerConfirmed)
        throw new Error("controller cleanup unconfirmed; fixture retained");
      report.fixtureCleanup = cleanupOwned();
      if (report.fixtureCleanup.remaining.length)
        throw new Error("owned fixture process exit unconfirmed");
      if (!launchConfirmed || !identity || !startTicks)
        throw new Error(
          "launch/fixture identity unconfirmed; retained folder in case dispatch is still settling",
        );
    }
    if (controllerConfirmed)
      await rm(folder, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 150,
      });
    report.cleanupConfirmed = controllerConfirmed;
  };
  try {
    await cleanupFixture();
  } catch (error) {
    report.cleanupError = String(error);
  }
  report.ok =
    !primaryFailure &&
    report.cleanupConfirmed &&
    report.steps.every((entry) => entry.status === "pass");
  if (primaryFailure) report.error = primaryFailure;
  console.log(JSON.stringify(report));
}
if (!report.ok) process.exitCode = 1;
