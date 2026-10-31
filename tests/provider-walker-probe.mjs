// Test-only instrumentation of the pinned reference walker; no desktop input.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { access, cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { ReferenceClient, referenceResult } from "./reference-client.mjs";

const anchor =
  "      $child = $Traversal.walker.GetFirstChild($Element, $Traversal.cache)";
const inserted = `      if ($env:PI_CU_WALKER_READY -and -not $script:PiCuWalkerGateSeen) {\n        $script:PiCuWalkerGateSeen = $true\n        [IO.File]::WriteAllText($env:PI_CU_WALKER_READY, 'ready')\n        $gateWatch = [Diagnostics.Stopwatch]::StartNew()\n        while (-not (Test-Path -LiteralPath $env:PI_CU_WALKER_GO)) { if ($gateWatch.ElapsedMilliseconds -gt 10000) { throw 'Diagnostic walker gate timed out' }; Start-Sleep -Milliseconds 20 }\n      }\n${anchor}`;
async function instrument(input, output) {
  const original = await readFile(input, "utf8");
  assert.equal(
    original.split(anchor).length,
    2,
    "Reference traversal anchor must occur exactly once",
  );
  await writeFile(output, original.replace(anchor, inserted), { flag: "wx" });
  return createHash("sha256").update(original).digest("hex");
}
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--plan") {
  console.log(
    JSON.stringify({
      executed: false,
      physicalInput: false,
      instrumentedReference: true,
      cases: ["provider.reference-walker"],
    }),
  );
  process.exit(0);
}
if (args.length === 3 && args[0] === "--instrument") {
  await instrument(args[1], args[2]);
  process.exit(0);
}
assert.equal(
  args.length,
  1,
  "Pass the Windows-readable reference checkout path",
);
assert.equal(process.platform, "win32", "Interactive Windows host required");
const source = resolve(args[0]);
const folder = await mkdtemp(join(tmpdir(), "pi-cu-provider-walker-"));
let fixture, client, result;
try {
  const copy = join(folder, "reference");
  await cp(source, copy, { recursive: true });
  const backend = join(copy, "scripts", "windows-uia.ps1"),
    temp = join(copy, "scripts", "walker-diagnostic.ps1");
  const originalHash = await instrument(backend, temp);
  const amended = await readFile(temp, "utf8");
  await writeFile(backend, amended);
  await rm(temp);
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
  fixture = spawn(exe, [], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    cwd: folder,
  });
  fixture.stderr.resume();
  const iter = createInterface({ input: fixture.stdout })[
    Symbol.asyncIterator
  ]();
  async function next() {
    let timer;
    try {
      return await Promise.race([
        iter.next().then((x) => {
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
  const hwnd = Number(await next());
  assert.ok(hwnd > 0 && fixture.pid > 0);
  const ready = join(folder, "walker-ready"),
    go = join(folder, "walker-go");
  client = new ReferenceClient(copy, {
    cwd: folder,
    env: { PI_CU_WALKER_READY: ready, PI_CU_WALKER_GO: go },
    timeoutMs: 25000,
  });
  await client.init();
  const pending = client
    .call("snapshot", {
      nativeWindowHandle: hwnd,
      processId: fixture.pid,
      includeScreenshot: false,
      activate: false,
      treeTimeoutMs: 30000,
    })
    .then(
      (value) => ({ value }),
      (error) => ({ error: String(error) }),
    );
  let gateReady = false;
  for (let i = 0; i < 200; i++) {
    try {
      await access(ready);
      gateReady = true;
      break;
    } catch {}
    await delay(25);
  }
  assert.ok(gateReady, "Instrumented walker did not reach its gate");
  fixture.stdin.write("arm:unavailable\n");
  assert.equal(await next(), "armed");
  await writeFile(go, "go", { flag: "wx" });
  const entered = await next();
  assert.equal(entered, "provider:entered:unavailable");
  const response = await pending;
  assert.ok(response.value, "Reference call failed: " + response.error);
  const observation = referenceResult(response.value);
  result = {
    ok: true,
    physicalInput: false,
    instrumentedReference: true,
    walkerGateObserved: true,
    entered,
    observation,
    originalBackendSha256: originalHash,
    scope:
      "test-only reference copy paused immediately before its first cached TreeWalker call; not an unchanged-reference run",
  };
} finally {
  if (client) await client.close();
  if (fixture && fixture.exitCode === null && fixture.signalCode === null) {
    const closed = once(fixture, "close");
    fixture.stdin.end("stop\n");
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
