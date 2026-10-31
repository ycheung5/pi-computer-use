// Public worker seam; targets only the independently identified owned fixture.

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { WorkerClient } from "../dist/client.js";
import { compileNative } from "../dist/native.js";

assert.equal(process.platform, "win32");
const folder = await mkdtemp(join(tmpdir(), "pi-cu-lifetime-"));
const executable = join(folder, "fixture.exe");
const compiler = join(
  process.env.WINDIR,
  "Microsoft.NET",
  "Framework64",
  "v4.0.30319",
  "csc.exe",
);
const built = spawnSync(
  compiler,
  [
    "/nologo",
    `/out:${executable}`,
    "/r:System.Windows.Forms.dll",
    "/r:System.Drawing.dll",
    "/r:System.Web.Extensions.dll",
    fileURLToPath(new URL("./accessibility-fixture.cs", import.meta.url)),
  ],
  { encoding: "utf8", windowsHide: true },
);
assert.equal(built.status, 0, built.stdout + built.stderr);
const fixtureTitle = `Owned lifetime ${Date.now()}`;
const expiryOnly = process.argv.includes("--expiry-only");
const reuseOnly = process.argv.includes("--reuse-only");
let reuseAvailability;
const fixture = spawn(
  executable,
  [
    fixtureTitle,
    "--lifetime",
    ...(expiryOnly ? ["--expiry"] : reuseOnly ? ["--reuse"] : []),
  ],
  {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  },
);
const fixtureClosed = once(fixture, "close");
const lines = createInterface({ input: fixture.stdout })[
  Symbol.asyncIterator
]();
const next = async () => JSON.parse((await lines.next()).value);
const receipts = [];
const output = process.argv
  .find((value) => value.startsWith("--output="))
  ?.slice(9);
const client = () =>
  new WorkerClient({
    launch: async () => ({
      executable: process.execPath,
      args: [fileURLToPath(new URL("../dist/worker.js", import.meta.url))],
    }),
  });
let worker = client();
const authorities = [];
const ownedPids = new Set([fixture.pid]);
const disposed = new WeakSet();
const call = async (action, args) => {
  const start = performance.now();
  const result = await worker.execute(action, args);
  receipts.push({
    action,
    args,
    durationMs: performance.now() - start,
    result: JSON.parse(
      JSON.stringify(result, (key, value) =>
        key === "base64" ? undefined : value,
      ),
    ),
  });
  return result;
};
function powershellJson(script) {
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `$ErrorActionPreference='Stop'\n${script}`,
    ],
    { encoding: "utf8", windowsHide: true, timeout: 15000 },
  );
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout.trim());
}
function rememberOwnedProcesses() {
  const snapshot = powershellJson(
    `$pending=@(${process.pid});$seen=@();$rows=@();$infrastructure=@();for($index=0;$index -lt $pending.Count;$index++){foreach($child in @(Get-CimInstance Win32_Process -Filter ('ParentProcessId='+$pending[$index]) -ErrorAction Stop)){if($child.ProcessId -ne $PID -and $seen -notcontains $child.ProcessId){$seen+=@($child.ProcessId);$row=@{pid=$child.ProcessId;parent=$child.ParentProcessId;name=$child.Name};if($child.ParentProcessId -eq ${process.pid} -and $child.Name -in @('conhost.exe','OpenConsole.exe')){$infrastructure+=@($row)}else{$rows+=@($row);$pending+=@($child.ProcessId)}}}};ConvertTo-Json -Compress -Depth 4 -InputObject @{owned=@($rows);testRootConsole=@($infrastructure)}`,
  );
  receipts.push({ processSnapshot: snapshot });
  for (const row of snapshot.owned) ownedPids.add(row.pid);
}
async function disposeAuthority(authority) {
  if (disposed.has(authority)) return;
  rememberOwnedProcesses();
  await authority.dispose();
  disposed.add(authority);
}
async function verifyDelegatedCapture(windowRef, target) {
  fixture.stdin.write("marker-names\n");
  const names = (await next()).names;
  assert.equal(names.length, 1);
  const framework = join(
      process.env.WINDIR,
      "Microsoft.NET",
      "Framework64",
      "v4.0.30319",
    ),
    metadata = join(process.env.WINDIR, "System32", "WinMetadata");
  const graphics = [];
  for (const name of [
    "Windows.Graphics.winmd",
    "Windows.Graphics.Capture.winmd",
    "Windows.Graphics.DirectX.winmd",
    "Windows.Graphics.DirectX.Direct3D11.winmd",
    "Windows.Graphics.Imaging.winmd",
  ]) {
    try {
      await readFile(join(metadata, name));
      graphics.push(join(metadata, name));
    } catch {}
  }
  const delegate = new WorkerClient({
    launch: (signal) =>
      compileNative(
        ["wgc.cs", "window-marker.cs"],
        [
          "System.Drawing.dll",
          join(framework, "System.Runtime.dll"),
          join(framework, "System.Runtime.WindowsRuntime.dll"),
          join(metadata, "Windows.Foundation.winmd"),
          ...graphics,
        ],
        signal,
      ),
  });
  authorities.push(delegate);
  const descriptor = {
    ...target,
    maxWidth: 100,
    _windowMarker: { name: names[0], windowRef },
  };
  try {
    const captured = await delegate.execute("screenshot", descriptor);
    receipts.push({
      delegatedCapture: JSON.parse(
        JSON.stringify(captured, (key, value) =>
          key === "base64" ? undefined : value,
        ),
      ),
    });
    fixture.stdin.write("strip-markers\n");
    assert.ok((await next()).removed >= 1);
    const lost = await delegate.execute("screenshot", descriptor);
    receipts.push({ delegatedLost: lost });
    assert.equal(lost.ok, false);
    assert.match(lost.error, /WINDOW_REFERENCE_LOST/);
    assert.equal(captured.ok, true, JSON.stringify(captured));
    assert.equal(captured.windowRef, windowRef);
    assert.equal(captured.screenshot.windowRef, windowRef);
    assert.equal(
      JSON.stringify(captured).includes("PiComputerUse.Window."),
      false,
    );
  } finally {
    await disposeAuthority(delegate);
  }
}
async function verifyPreparationGuard() {
  const providerExe = join(folder, "provider.exe");
  const framework = join(
    process.env.WINDIR,
    "Microsoft.NET",
    "Framework64",
    "v4.0.30319",
  );
  const compiled = spawnSync(
    compiler,
    [
      "/nologo",
      `/out:${providerExe}`,
      "/r:System.Windows.Forms.dll",
      ...[
        "UIAutomationClient.dll",
        "UIAutomationProvider.dll",
        "UIAutomationTypes.dll",
        "WindowsBase.dll",
      ].map((name) => `/r:${join(framework, "WPF", name)}`),
      fileURLToPath(new URL("./nullable-uia-fixture.cs", import.meta.url)),
    ],
    { encoding: "utf8", windowsHide: true },
  );
  assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
  const provider = spawn(providerExe, [], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  const providerLines = createInterface({ input: provider.stdout })[
    Symbol.asyncIterator
  ]();
  const read = async () => {
    const line = (await providerLines.next()).value;
    receipts.push({ providerLine: line });
    return line;
  };
  const handle = Number(await read());
  const authority = client();
  authorities.push(authority);
  try {
    const target = { nativeWindowHandle: handle, processId: provider.pid };
    const found = await authority.execute("find", {
      ...target,
      query: "Newer UIA control",
      ocrFallback: false,
    });
    receipts.push({ providerFind: found });
    assert.equal(found.ok, true);
    assert.equal(found.matches.length, 1);
    provider.stdin.write("enabled-hold\n");
    assert.equal(await read(), "enabled:armed");
    const pending = authority.execute("invoke", {
      windowRef: found.windowRef,
      elementId: found.matches[0].id,
      fallbackClick: false,
    });
    assert.equal(await read(), "enabled:entered");
    provider.stdin.write("strip-markers\n");
    assert.match(await read(), /^markers-removed:[1-9]/);
    provider.stdin.write("enabled-release\n");
    assert.equal(await read(), "enabled:settled");
    const result = await pending;
    receipts.push({ guardResult: result });
    assert.equal(result.ok, false);
    assert.match(result.error, /WINDOW_REFERENCE_LOST/);
    provider.stdin.write("invoke-state\n");
    assert.equal(
      await read(),
      "invoke-state:0",
      "no invocation after final preparation loses lifetime proof",
    );
    const rebound = await authority.execute("find", {
      ...target,
      query: "Newer UIA control",
      ocrFallback: false,
    });
    receipts.push({ postEffectBinding: rebound });
    assert.equal(rebound.ok, true);
    provider.stdin.write("invoke-strip\n");
    assert.equal(await read(), "invoke:armed");
    const affected = await authority.execute("invoke", {
      windowRef: rebound.windowRef,
      elementId: rebound.matches[0].id,
      fallbackClick: false,
    });
    receipts.push({ postEffectResult: affected });
    provider.stdin.write("invoke-state\n");
    assert.equal(await read(), "invoke-state:1");
    assert.equal(
      affected.dispatchAttempted,
      true,
      "post-effect proof loss must retain dispatch evidence",
    );
    assert.equal(affected.effectsUncertain, true);
    assert.match(affected.error, /WINDOW_REFERENCE_LOST_AFTER_DISPATCH/);
    assert.equal(affected.inputRequired, undefined);
  } finally {
    await disposeAuthority(authority);
    provider.stdin.end("enabled-release\nstop\n");
    if (provider.exitCode === null) await once(provider, "close");
  }
}
async function verifyTerminalTargets() {
  const initial = await next();
  receipts.push({ terminalInitial: initial });
  const observed = await call("accessibility_tree", {
    nativeWindowHandle: initial.hwnd,
    processId: initial.pid,
    maxDepth: 0,
  });
  assert.equal(observed.ok, true);
  fixture.stdin.write("replace\n");
  const replacement = await next();
  receipts.push({ terminalReplacement: replacement });
  assert.notEqual(
    replacement.hwnd,
    initial.hwnd,
    "this case requires the old numeric handle to be absent",
  );
  const constrained = await call("wait_for", {
    windowRef: observed.windowRef,
    windowTitle: fixtureTitle,
    condition: "window",
    appear: false,
    timeoutMs: 100,
    intervalMs: 50,
  });
  assert.equal(
    constrained.verification,
    "inconclusive",
    "a destroyed reference cannot verify its current title constraint",
  );
  const current = await call("accessibility_tree", {
    nativeWindowHandle: replacement.hwnd,
    processId: replacement.pid,
    maxDepth: 0,
  });
  assert.equal(current.ok, true);
  const close = await call("close_window", { windowRef: current.windowRef });
  assert.equal(close.ok, true, JSON.stringify(close));
  assert.equal(close.posted, true);
  assert.equal(close.verification, "sent");
  assert.equal(close.effectsUncertain, undefined);
  await fixtureClosed;
  const closed = await call("wait_for", {
    windowRef: current.windowRef,
    condition: "window",
    appear: false,
    timeoutMs: 100,
    intervalMs: 50,
  });
  assert.equal(closed.verification, "observed");
}
// Actual elapsed-time coverage: no clock override, reference refresh or helper restart.
async function verifyReferenceExpiry() {
  const initial = await next();
  const target = {
    nativeWindowHandle: initial.hwnd,
    processId: initial.pid,
    activate: false,
  };
  const observed = await call("find", {
    ...target,
    query: "Fixture action",
    ocrFallback: false,
  });
  assert.equal(observed.ok, true, JSON.stringify(observed));
  assert.equal(observed.matches.length, 1);
  assert.equal(typeof observed.windowRef, "string");
  const oldElement = observed.matches[0].id;
  assert.equal(typeof oldElement, "string");
  const started = performance.now(),
    startedUtc = new Date().toISOString();
  const identities = () =>
    powershellJson(
      `$rows=@();$pending=@(${process.pid});for($i=0;$i -lt $pending.Count;$i++){foreach($p in @(Get-CimInstance Win32_Process -Filter ('ParentProcessId='+$pending[$i]) -ErrorAction Stop)){if($p.ProcessId -ne $PID -and $p.Name -notin @('conhost.exe','OpenConsole.exe')){$pending+=@($p.ProcessId);$rows+=@(@{pid=$p.ProcessId;parent=$p.ParentProcessId;name=$p.Name;creation=$p.CreationDate.ToUniversalTime().ToString('o');executable=$p.ExecutablePath;command=$p.CommandLine})}}};ConvertTo-Json -Compress -Depth 4 -InputObject @($rows)`,
    );
  const before = identities();
  receipts.push({ expiryProcessPreflight: before });
  const fixtureIdentity = before.find((row) => row.pid === fixture.pid);
  const workerIdentity = before.filter(
    (row) =>
      row.name === "node.exe" &&
      /[\\/]dist[\\/]worker\.js/.test(row.command ?? ""),
  );
  assert.ok(fixtureIdentity, "independent fixture identity required");
  assert.equal(
    workerIdentity.length,
    1,
    "exactly one current owned worker required",
  );
  const nativeIdentity = before.filter(
    (row) => row.parent === workerIdentity[0].pid && row.name === "windows.exe",
  );
  assert.equal(
    nativeIdentity.length,
    2,
    "desktop authority and stop helper must both be pinned",
  );
  for (const row of [fixtureIdentity, workerIdentity[0], ...nativeIdentity]) {
    assert.ok(
      row.creation && row.executable,
      "creation timestamp and executable required",
    );
    ownedPids.add(row.pid);
  }
  receipts.push({
    expiryStart: {
      initial,
      startedUtc,
      identities: [fixtureIdentity, workerIdentity[0], ...nativeIdentity],
      waitMs: 305000,
    },
  });
  console.log(
    JSON.stringify({
      status: "waiting-real-reference-expiry",
      startedUtc,
      waitMs: 305000,
    }),
  );
  while (performance.now() - started < 305000) {
    await new Promise((resolve) =>
      setTimeout(
        resolve,
        Math.min(30000, 305000 - (performance.now() - started)),
      ),
    );
    console.log(
      JSON.stringify({
        status: "expiry-wait",
        elapsedMs: performance.now() - started,
      }),
    );
  }
  const after = identities();
  receipts.push({
    expiryElapsed: {
      elapsedMs: performance.now() - started,
      endedUtc: new Date().toISOString(),
      identities: after,
    },
  });
  for (const row of [fixtureIdentity, workerIdentity[0], ...nativeIdentity]) {
    assert.deepEqual(
      after.find((current) => current.pid === row.pid),
      row,
      "same live fixture/worker/native authority must survive the entire TTL",
    );
  }
  fixture.stdin.write("identity\n");
  const stillLive = await next();
  receipts.push({ expiryStillLive: stillLive });
  assert.deepEqual(stillLive, initial);
  const expired = await call("snapshot", {
    windowRef: observed.windowRef,
    includeScreenshot: false,
    activate: false,
  });
  assert.equal(expired.ok, false);
  assert.match(
    expired.error,
    /^WINDOWS_ERROR: STALE_WINDOW_REFERENCE: reference expired; observe again$/,
  );
  const absent = await call("wait_for", {
    windowRef: observed.windowRef,
    condition: "window",
    appear: false,
    timeoutMs: 100,
    intervalMs: 50,
    activate: false,
  });
  assert.equal(absent.verification, "inconclusive");
  assert.equal(absent.conclusive, false);
  const fresh = await call("find", {
    ...target,
    query: "Fixture action",
    ocrFallback: false,
  });
  assert.equal(fresh.ok, true);
  assert.equal(fresh.matches.length, 1);
  assert.equal(typeof fresh.windowRef, "string");
  assert.notEqual(fresh.windowRef, observed.windowRef);
  fixture.stdin.write("counter\n");
  const counterBefore = await next();
  const old = await call("invoke", {
    ...target,
    elementId: oldElement,
    fallbackClick: false,
  });
  assert.equal(old.ok, false);
  assert.match(old.error, /STALE_(?:WINDOW_REFERENCE|ELEMENT)/);
  fixture.stdin.write("counter\n");
  const counterAfter = await next();
  receipts.push({
    expiryEffects: { before: counterBefore, after: counterAfter },
  });
  assert.deepEqual(counterBefore, { clicks: 0 });
  assert.deepEqual(counterAfter, counterBefore);
  const finalIdentities = identities();
  for (const row of nativeIdentity)
    assert.deepEqual(
      finalIdentities.find((current) => current.pid === row.pid),
      row,
      "all expiry checks used the original native helpers",
    );
}
// Two finite empirical cycles; exhausting either bound is unavailable, never acceptance.
async function verifyRealHandleReuse() {
  await next();
  const command = async (value) => {
    fixture.stdin.write(value + "\n");
    const result = await next();
    receipts.push({ reuseCommand: value, result });
    return result;
  };
  const first = await command("reuse-prepare");
  assert.notEqual(first.status, "setup-error");
  if (first.status !== "collision") {
    reuseAvailability =
      "unavailable: no first full-HWND collision within bounds";
    return;
  }
  assert.ok(first.firstOrdinal > 0 && first.ordinal > first.firstOrdinal);
  assert.equal(first.live, true);
  assert.equal(first.owner, fixture.pid);
  const target = {
    nativeWindowHandle: first.hwnd,
    processId: first.pid,
    activate: false,
  };
  const bound = await call("accessibility_tree", {
    ...target,
    maxDepth: 0,
    includeOffscreen: true,
  });
  if (bound.ok !== true || typeof bound.windowRef !== "string") {
    reuseAvailability =
      "unavailable: hidden owned root UIA binding prerequisite";
    return;
  }
  const second = await command("reuse-next:" + first.hwnd);
  assert.notEqual(second.status, "setup-error");
  if (second.status !== "collision") {
    reuseAvailability =
      "unavailable: no second exact full-HWND collision within bounds";
    return;
  }
  assert.equal(second.hwnd, first.hwnd);
  assert.equal(second.pid, first.pid);
  assert.equal(second.owner, fixture.pid);
  assert.ok(second.ordinal > first.ordinal);
  assert.equal(second.closeCount, 0);
  for (const [action, extra] of [
    ["snapshot", { includeScreenshot: false }],
    ["close_window", {}],
  ]) {
    const lost = await call(action, {
      ...target,
      windowRef: bound.windowRef,
      ...extra,
    });
    assert.equal(lost.ok, false, JSON.stringify(lost));
    assert.match(lost.error, /WINDOW_REFERENCE_LOST/);
  }
  const intact = await command("reuse-oracle");
  assert.equal(intact.live, true);
  assert.equal(intact.hwnd, second.hwnd);
  assert.equal(intact.ordinal, second.ordinal);
  assert.equal(intact.closeCount, 0);
  const fresh = await call("accessibility_tree", {
    ...target,
    maxDepth: 0,
    includeOffscreen: true,
  });
  assert.equal(fresh.ok, true, JSON.stringify(fresh));
  assert.equal(typeof fresh.windowRef, "string");
  assert.notEqual(fresh.windowRef, bound.windowRef);
  reuseAvailability =
    "observed: same full HWND/PID across distinct real lifetimes; old proof refused without close effect";
}
let ok = false;
try {
  if (reuseOnly) {
    await verifyRealHandleReuse();
    ok = reuseAvailability.startsWith("observed:");
  } else if (expiryOnly) {
    await verifyReferenceExpiry();
    ok = true;
  } else if (process.argv.includes("--terminal-only")) {
    await verifyTerminalTargets();
    ok = true;
  } else if (process.argv.includes("--provider-only")) {
    await next();
    await verifyPreparationGuard();
    ok = true;
  } else {
    const identity = await next();
    receipts.push({ fixture: identity });
    const target = {
      nativeWindowHandle: identity.hwnd,
      processId: identity.pid,
    };
    const tree = await call("accessibility_tree", {
      ...target,
      maxDepth: 2,
      maxNodes: 30,
      activate: false,
    });
    assert.equal(tree.ok, true, JSON.stringify(tree));
    assert.equal(
      typeof tree.windowRef,
      "string",
      "owned observation must issue a lifetime reference",
    );
    assert.ok(tree.windowRef.length > 0);
    const again = await call("accessibility_tree", {
      windowRef: tree.windowRef,
      maxDepth: 0,
      activate: false,
    });
    assert.equal(again.ok, true, JSON.stringify(again));
    assert.equal(again.windowRef, tree.windowRef);
    const first = await call("find", {
      ...target,
      query: "Fixture action",
      ocrFallback: false,
    });
    assert.equal(first.matches.length, 1, JSON.stringify(first));
    const oldElement = first.matches[0].id;
    fixture.stdin.write("strip-markers\n");
    const removal = await next();
    receipts.push({ removal });
    assert.ok(removal.removed >= 1);
    for (const [action, extra] of [
      ["accessibility_tree", {}],
      ["screenshot", {}],
      ["snapshot", { includeScreenshot: false }],
      ["ocr", { query: "Fixture" }],
      ["move_window", { x: 40, y: 40 }],
      ["type_text", { text: "must not dispatch", method: "background" }],
      ["click", { x: 20, y: 20, dispatch: "background" }],
    ]) {
      const lost = await call(action, { windowRef: tree.windowRef, ...extra });
      assert.equal(lost.ok, false, action);
      assert.match(lost.error, /WINDOW_REFERENCE_LOST/, action);
    }
    const waiting = await call("wait_for", {
      windowRef: tree.windowRef,
      condition: "window",
      appear: false,
      timeoutMs: 100,
      intervalMs: 50,
    });
    assert.equal(
      waiting.verification,
      "inconclusive",
      "missing marker is not disappearance",
    );
    const fresh = await call("find", {
      ...target,
      query: "Fixture action",
      ocrFallback: false,
    });
    assert.equal(fresh.ok, true, JSON.stringify(fresh));
    const stale = await call("invoke", {
      elementId: oldElement,
      fallbackClick: false,
    });
    assert.equal(
      stale.ok,
      false,
      "a fresh observation must not overwrite an old element's lost root binding",
    );
    fixture.stdin.write("counter\n");
    assert.equal((await next()).clicks, 0);
    assert.match(
      stale.error,
      /STALE_ELEMENT|WINDOW_REFERENCE_LOST|STALE_WINDOW_REFERENCE/,
    );
    const conflict = await call("screenshot", {
      windowRef: fresh.windowRef,
      processId: identity.pid + 1,
    });
    assert.equal(conflict.ok, false);
    assert.match(conflict.error, /WINDOW_REFERENCE_CONFLICT/);
    const snapshot = await call("snapshot", {
      windowRef: fresh.windowRef,
      captureWindow: true,
      maxWidth: 120,
      maxDepth: 1,
    });
    assert.equal(snapshot.ok, true, JSON.stringify(snapshot));
    assert.equal(snapshot.windowRef, fresh.windowRef);
    assert.equal(snapshot.screenshot.windowRef, fresh.windowRef);
    assert.equal(snapshot.screenshot.source, "window");
    const ocr = await call("ocr", {
      windowRef: fresh.windowRef,
      query: "Fixture",
      resolveControl: true,
    });
    assert.equal(ocr.ok, true, JSON.stringify(ocr));
    assert.equal(ocr.windowRef, fresh.windowRef);
    const present = await call("wait_for", {
      windowRef: fresh.windowRef,
      condition: "window",
      timeoutMs: 100,
      intervalMs: 50,
    });
    assert.equal(present.verification, "observed");
    assert.equal((await call("operation_end", {})).ok, true);
    const other = client();
    authorities.push(other);
    const rawWait = await other.execute("wait_for", {
      ...target,
      condition: "window",
      timeoutMs: 5000,
      intervalMs: 50,
    });
    receipts.push({ rawWait });
    assert.equal(rawWait.verification, "observed");
    fixture.stdin.write("marker-count\n");
    assert.equal(
      (await next()).removed,
      1,
      "raw window wait must not tag targets or unrelated windows",
    );
    const foreign = await other.execute("accessibility_tree", {
      windowRef: fresh.windowRef,
      maxDepth: 0,
    });
    receipts.push({ foreign });
    assert.equal(foreign.ok, false);
    assert.match(foreign.error, /STALE_WINDOW_REFERENCE/);
    const second = await other.execute("accessibility_tree", {
      ...target,
      maxDepth: 0,
    });
    receipts.push({ second });
    assert.equal(second.ok, true);
    assert.notEqual(second.windowRef, fresh.windowRef);
    await disposeAuthority(other);
    const still = await call("accessibility_tree", {
      windowRef: fresh.windowRef,
      maxDepth: 0,
    });
    assert.equal(still.ok, true);
    const warm = [];
    for (let index = 0; index < 10; index++) {
      const start = performance.now();
      const result = await call("accessibility_tree", {
        windowRef: fresh.windowRef,
        maxDepth: 0,
      });
      assert.equal(result.ok, true);
      warm.push(performance.now() - start);
    }
    receipts.push({ warmMs: warm });
    const baselinePath = process.argv
      .find((value) => value.startsWith("--baseline-worker="))
      ?.slice(18);
    if (baselinePath) {
      assert.equal((await call("operation_end", {})).ok, true);
      const baseline = new WorkerClient({
        launch: async () => ({
          executable: process.execPath,
          args: [baselinePath],
        }),
      });
      authorities.push(baseline);
      assert.equal(
        (
          await baseline.execute("accessibility_tree", {
            ...target,
            maxDepth: 0,
          })
        ).ok,
        true,
      );
      const samples = [];
      for (let index = 0; index < 10; index++) {
        const start = performance.now();
        const result = await baseline.execute("accessibility_tree", {
          ...target,
          maxDepth: 0,
        });
        assert.equal(result.ok, true);
        samples.push(performance.now() - start);
      }
      receipts.push({ baselineCommit: "ad28859", baselineWarmMs: samples });
      await disposeAuthority(baseline);
    }
    fixture.stdin.write("replace\n");
    const replacement = await next();
    receipts.push({
      replacement,
      genuineReuse:
        replacement.hwnd === identity.hwnd && replacement.pid === identity.pid,
    });
    assert.equal(replacement.lifetime, 2);
    const ended = await call("accessibility_tree", {
      windowRef: fresh.windowRef,
      maxDepth: 0,
    });
    assert.equal(ended.ok, false);
    assert.match(ended.error, /WINDOW_REFERENCE_LOST|STALE_WINDOW_REFERENCE/);
    const current = await call("find", {
      nativeWindowHandle: replacement.hwnd,
      processId: replacement.pid,
      query: "Fixture action",
      ocrFallback: false,
    });
    assert.equal(current.ok, true);
    const oldIdAgain = await call("invoke", {
      elementId: fresh.matches[0].id,
      fallbackClick: false,
    });
    assert.equal(oldIdAgain.ok, false);
    await disposeAuthority(worker);
    worker = client();
    const restarted = await call("accessibility_tree", {
      windowRef: current.windowRef,
      maxDepth: 0,
    });
    assert.equal(restarted.ok, false);
    assert.match(restarted.error, /STALE_WINDOW_REFERENCE/);
    const renewed = await call("accessibility_tree", {
      nativeWindowHandle: replacement.hwnd,
      processId: replacement.pid,
      maxDepth: 0,
    });
    assert.equal(renewed.ok, true);
    assert.notEqual(renewed.windowRef, current.windowRef);
    await verifyDelegatedCapture(renewed.windowRef, {
      nativeWindowHandle: replacement.hwnd,
      processId: replacement.pid,
    });
    assert.equal((await call("operation_end", {})).ok, true);
    const nativeTarget = {
      nativeWindowHandle: replacement.hwnd,
      processId: replacement.pid,
    };
    const beforeNativeRestart = await worker.execute(
      "accessibility_tree",
      { ...nativeTarget, maxDepth: 0 },
      undefined,
      "native-before-stop",
    );
    receipts.push({ beforeNativeRestart });
    assert.equal(beforeNativeRestart.ok, true);
    rememberOwnedProcesses();
    worker.stopOperation("native-before-stop");
    const stopped = await worker.execute(
      "operation_end",
      {},
      undefined,
      "native-before-stop",
    );
    assert.equal(stopped.ok, true);
    const nativeRestarted = await worker.execute(
      "accessibility_tree",
      { windowRef: beforeNativeRestart.windowRef, maxDepth: 0 },
      undefined,
      "native-after-stop",
    );
    receipts.push({ nativeRestarted });
    assert.equal(nativeRestarted.ok, false);
    assert.match(nativeRestarted.error, /STALE_WINDOW_REFERENCE/);
    assert.equal(
      (
        await worker.execute(
          "operation_end",
          {},
          undefined,
          "native-after-stop",
        )
      ).ok,
      true,
    );
    assert.equal((await call("operation_end", {})).ok, true);
    await verifyPreparationGuard();
    ok = true;
  }
} finally {
  await disposeAuthority(worker);
  for (const authority of authorities) await disposeAuthority(authority);
  if (reuseOnly && fixture.exitCode === null) {
    fixture.stdin.write("reuse-oracle\n");
    const reuseCleanup = await next();
    receipts.push({ reuseCleanup });
    assert.equal(
      reuseCleanup.markerCount,
      0,
      "normal native retirement removes matching hidden-root markers",
    );
  }
  if (fixture.exitCode === null) {
    fixture.stdin.write("marker-count\n");
    const remainingMarkers = await next();
    receipts.push({ remainingMarkers });
    assert.equal(
      remainingMarkers.removed,
      0,
      "normal native retirement removes owned markers",
    );
  }
  if (fixture.exitCode === null) {
    fixture.stdin.end("stop\n");
    await fixtureClosed;
  }
  const live = powershellJson(
    `$expected=@(${[...ownedPids].join(",")});foreach($id in $expected){try{$p=[System.Diagnostics.Process]::GetProcessById($id)}catch [System.ArgumentException]{continue};try{[void]$p.WaitForExit(5000)}finally{$p.Dispose()}};ConvertTo-Json -Compress -InputObject @(Get-Process -ErrorAction Stop|Where-Object{$expected -contains $_.Id}|ForEach-Object{$_.Id})`,
  );
  receipts.push({
    cleanup: {
      recordedPids: [...ownedPids],
      livePids: live,
      independent: true,
    },
  });
  await writeFile(
    join(folder, "receipts.json"),
    JSON.stringify({ ok, reuseAvailability, receipts }, null, 2),
  );
  console.log(JSON.stringify({ ok, reuseAvailability, folder }));
  if (output) {
    const hashes = await Promise.all(
      [
        "assets/window-marker.cs",
        "assets/window-references.cs",
        "assets/accessibility.cs",
        "src/worker.ts",
        "tests/native-window-lifetime.mjs",
      ].map(async (file) => [
        file,
        createHash("sha256")
          .update(await readFile(new URL(`../${file}`, import.meta.url)))
          .digest("hex"),
      ]),
    );
    await writeFile(
      output,
      JSON.stringify(
        {
          ok,
          reuseAvailability,
          receipts,
          sourceHashes: Object.fromEntries(hashes),
        },
        null,
        2,
      ),
    );
  }
  assert.deepEqual(
    live,
    [],
    "owned process cleanup must be independently confirmed",
  );
  if (ok || reuseAvailability?.startsWith("unavailable:"))
    await rm(folder, { recursive: true, force: true });
  if (reuseOnly && !ok) process.exitCode = 2;
}
