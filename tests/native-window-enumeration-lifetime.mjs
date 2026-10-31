// Real EnumWindows on an unswitched owned desktop; never stamp the personal desktop.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { WorkerClient } from "../dist/client.js";

assert.equal(process.platform, "win32");
const folder = await mkdtemp(join(tmpdir(), "pi-cu-enumeration-"));
const desktop = `PiCuOwned_${randomUUID().replaceAll("-", "")}`;
const framework = join(
    process.env.WINDIR,
    "Microsoft.NET",
    "Framework64",
    "v4.0.30319",
  ),
  compiler = join(framework, "csc.exe");
const fixtureExe = join(folder, "fixture.exe"),
  bridgeExe = join(folder, "bridge.exe"),
  fixtureIdentity = join(folder, "fixture-desktop.json"),
  bridgeIdentity = join(folder, "bridge-desktop.json");
const bootstrap = fileURLToPath(
  new URL("desktop-bootstrap.cs", import.meta.url),
);
const fixtureBuild = spawnSync(
  compiler,
  [
    "/nologo",
    "/define:FIXTURE",
    "/main:DesktopBootstrap",
    `/out:${fixtureExe}`,
    "/r:System.Windows.Forms.dll",
    "/r:System.Drawing.dll",
    bootstrap,
    fileURLToPath(new URL("accessibility-fixture.cs", import.meta.url)),
  ],
  { encoding: "utf8", windowsHide: true },
);
assert.equal(fixtureBuild.status, 0, fixtureBuild.stdout + fixtureBuild.stderr);
const windowsSource = process.argv
  .find((x) => x.startsWith("--windows-source="))
  ?.slice(17);
const nativeSources = [
  "windows.cs",
  "window-marker.cs",
  "window-references.cs",
  "accessibility.cs",
  "capture.cs",
  "controls.cs",
  "window-management.cs",
  "pointer.cs",
  "browser-indicators.cs",
  "text.cs",
].map((name) =>
  name === "windows.cs" && windowsSource
    ? windowsSource
    : fileURLToPath(new URL(`../assets/${name}`, import.meta.url)),
);
const bridgeBuild = spawnSync(
  compiler,
  [
    "/nologo",
    "/main:DesktopBootstrap",
    `/out:${bridgeExe}`,
    "/r:System.Web.Extensions.dll",
    "/r:System.Drawing.dll",
    "/r:Microsoft.CSharp.dll",
    "/r:System.Windows.Forms.dll",
    ...[
      "WindowsBase.dll",
      "UIAutomationClient.dll",
      "UIAutomationTypes.dll",
    ].map((name) => `/r:${join(framework, "WPF", name)}`),
    bootstrap,
    ...nativeSources,
  ],
  { encoding: "utf8", windowsHide: true },
);
assert.equal(bridgeBuild.status, 0, bridgeBuild.stdout + bridgeBuild.stderr);
const fixture = spawn(
  fixtureExe,
  [desktop, fixtureIdentity, "Owned enumeration fixture", "--lifetime"],
  { stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
);
const closed = once(fixture, "close");
let fixtureErrors = "";
fixture.stderr.setEncoding("utf8");
fixture.stderr.on("data", (chunk) => {
  fixtureErrors += chunk;
});
const lines = createInterface({ input: fixture.stdout })[
  Symbol.asyncIterator
]();
const next = async () => {
  const row = await lines.next();
  if (row.done)
    throw new Error(`OWNED_DESKTOP_SETUP_UNAVAILABLE: ${fixtureErrors}`);
  return JSON.parse(row.value);
};
const first = await next();
const bridge = new WorkerClient({
  launch: async () => ({
    executable: bridgeExe,
    args: [desktop, bridgeIdentity],
  }),
});
const receipts = [{ fixture: first, desktop }];
const output = process.argv.find((x) => x.startsWith("--output="))?.slice(9);
let ok = false;
try {
  const preflight = await bridge.execute("list_windows", {
    maxWindows: 200,
    includeInvisible: true,
    _metadataOnly: true,
  });
  assert.equal(preflight.ok, true);
  const fixtureAssignment = JSON.parse(await readFile(fixtureIdentity, "utf8")),
    bridgeAssignment = JSON.parse(await readFile(bridgeIdentity, "utf8"));
  receipts.push({ fixtureAssignment, bridgeAssignment });
  assert.equal(fixtureAssignment.desktop, desktop);
  assert.equal(bridgeAssignment.desktop, desktop);
  assert.equal(fixtureAssignment.pid, first.pid);
  const allowed = new Set([first.pid, bridgeAssignment.pid]);
  assert.ok(
    preflight.windows.every((x) => allowed.has(x.processId)),
    "isolation prerequisite: unexpected foreign window; no binding enumeration permitted",
  );
  receipts.push({
    preflightCount: preflight.windows.length,
    preflightOwners: [...new Set(preflight.windows.map((x) => x.processId))],
  });
  fixture.stdin.write("strip-on-null\n");
  assert.equal((await next()).nullArmed, true);
  const raced = await bridge.execute("list_windows", {
    maxWindows: 200,
    includeInvisible: false,
  });
  const removal = await next();
  receipts.push({ raced, removal });
  assert.ok(
    removal.nullProbeRemoved >= 1,
    "responsiveness read must occur after this observation binds its root witness",
  );
  assert.equal(
    raced.windows.some(
      (x) => x.nativeWindowHandle === first.hwnd && x.windowRef,
    ),
    false,
    "lost binding must not be restamped onto earlier metadata",
  );
  assert.equal(raced.truncated, true);
  assert.equal(raced.conclusive, false);
  const fresh = await bridge.execute("list_windows", {
    maxWindows: 200,
    includeInvisible: false,
  });
  receipts.push({ fresh });
  assert.ok(
    fresh.windows.some(
      (x) =>
        x.nativeWindowHandle === first.hwnd && typeof x.windowRef === "string",
    ),
  );
  ok = true;
} finally {
  await bridge.dispose();
  fixture.stdin.write("marker-count\n");
  const remaining = await next();
  receipts.push({ remainingMarkers: remaining });
  fixture.stdin.end("stop\n");
  await closed;
  const absence = spawnSync(fixtureExe, ["--verify-absent", desktop], {
    encoding: "utf8",
    windowsHide: true,
  });
  receipts.push({
    desktopAbsence: {
      status: absence.status,
      stdout: absence.stdout.trim(),
      stderr: absence.stderr.trim(),
    },
  });
  const processCheck = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `$ErrorActionPreference='Stop';$expected=@(${first.pid},${JSON.parse(await readFile(bridgeIdentity, "utf8")).pid});ConvertTo-Json -Compress -InputObject @(Get-Process -ErrorAction Stop|Where-Object{$expected -contains $_.Id}|ForEach-Object{$_.Id})`,
    ],
    { encoding: "utf8", windowsHide: true },
  );
  receipts.push({
    processCleanup: {
      status: processCheck.status,
      livePids:
        processCheck.status === 0
          ? JSON.parse(processCheck.stdout.trim())
          : null,
      stderr: processCheck.stderr,
    },
  });
  const sourceHashes = Object.fromEntries(
    await Promise.all(
      [
        bootstrap,
        ...nativeSources,
        fileURLToPath(new URL("accessibility-fixture.cs", import.meta.url)),
      ].map(async (file) => [
        file,
        createHash("sha256")
          .update(await readFile(file))
          .digest("hex"),
      ]),
    ),
  );
  const report = {
    ok,
    receipts,
    windowsSourceMode: windowsSource ? "pinned-control" : "current",
    sourceHashes,
  };
  await writeFile(
    join(folder, "receipts.json"),
    JSON.stringify(report, null, 2),
  );
  if (output) await writeFile(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok, folder }));
  assert.equal(remaining.removed, 0);
  assert.equal(absence.status, 0, absence.stderr);
  assert.equal(processCheck.status, 0, processCheck.stderr);
  assert.deepEqual(JSON.parse(processCheck.stdout.trim()), []);
  if (ok) await rm(folder, { recursive: true, force: true });
}
