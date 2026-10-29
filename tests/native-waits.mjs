// Dedicated passive fixture transitions; no physical input.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import computerUse from "../dist/extension.js";
import { computerUseHost } from "./native-host.mjs";

assert.equal(process.platform, "win32");
const folder = await mkdtemp(join(tmpdir(), "pi-cu-wait-fixture-")),
  executable = join(folder, "fixture.exe");
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
    "/target:exe",
    `/out:${executable}`,
    "/r:System.Windows.Forms.dll",
    "/r:System.Drawing.dll",
    fileURLToPath(new URL("./wait-fixture.cs", import.meta.url)),
  ],
  { encoding: "utf8", windowsHide: true, cwd: folder },
);
assert.equal(built.status, 0, built.stdout + built.stderr);
const title = `Pi CU Wait ${Date.now()}`,
  fixture = spawn(executable, [title], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    cwd: folder,
  });
const [ready] = await once(fixture.stdout, "data");
const handle = Number(ready.toString().trim());
const host = computerUseHost();
computerUse(host.api);
const wait = host.tools.get("windows_computer_use_wait_for");
assert.ok(wait);
const call = async (extra, signal) => {
  const result = await wait.execute(
    `wait-${Date.now()}`,
    {
      nativeWindowHandle: handle,
      processId: fixture.pid,
      timeoutMs: 2500,
      intervalMs: 100,
      ...extra,
    },
    signal,
    undefined,
    {},
  );
  return result.details;
};
const command = async (value) => {
  fixture.stdin.write(`${value}\n`);
  await once(fixture.stdout, "data");
};
try {
  // Warm the native bridge before narrow deadline tests.
  await host.tools
    .get("windows_computer_use_list_windows")
    .execute("warm", {}, undefined, undefined, {});
  const present = await call({ condition: "window" });
  assert.equal(present.verification, "observed", JSON.stringify(present));
  const adding = setTimeout(() => fixture.stdin.write("add\n"), 300);
  const appeared = await call({
    condition: "element",
    query: "Transition target",
  });
  clearTimeout(adding);
  assert.equal(appeared.verification, "observed", JSON.stringify(appeared));
  assert.equal(appeared.found, true);
  await command("remove");
  const disappeared = await call({
    condition: "element",
    query: "Transition target",
    appear: false,
  });
  assert.equal(disappeared.verification, "observed");
  const missing = await call({
    condition: "element",
    query: "absent-938",
    timeoutMs: 300,
  });
  assert.equal(missing.verification, "timeout", JSON.stringify(missing));
  assert.equal(missing.timedOut, true);
  const incomplete = await call({
    condition: "element",
    query: "absent-938",
    appear: false,
    maxNodes: 1,
    timeoutMs: 250,
  });
  assert.equal(incomplete.verification, "inconclusive");
  assert.equal(incomplete.observationTruncated, true);
  await command("text");
  const recognized = await call({
    condition: "text",
    query: "ready456",
    timeoutMs: 10000,
  });
  assert.equal(recognized.verification, "observed", JSON.stringify(recognized));
  await command("clear");
  const textGone = await call({
    condition: "text",
    query: "ready456",
    appear: false,
    timeoutMs: 6000,
  });
  assert.equal(textGone.verification, "observed", JSON.stringify(textGone));
  assert.match(textGone.verificationNote, /OCR output/);
  const controller = new AbortController(),
    start = performance.now();
  const cancelled = call(
    { condition: "element", query: "never", timeoutMs: 60000 },
    controller.signal,
  );
  setTimeout(() => controller.abort(), 100);
  await assert.rejects(cancelled);
  assert.ok(performance.now() - start < 2000);
  await host.emit("before_agent_start", { messageType: "user" });
  fixture.stdin.end("stop\n");
  await once(fixture, "close");
  const gone = await call({ condition: "window", appear: false });
  assert.equal(gone.verification, "observed", JSON.stringify(gone));
  console.log(
    JSON.stringify({
      ok: true,
      check: "native waits",
      windowPresent: true,
      windowGone: true,
      elementTransitions: true,
      completeTimeout: true,
      incompleteAbsence: true,
      literalOcrAppearDisappear: true,
      cancellation: true,
      physicalInput: false,
    }),
  );
} finally {
  if (fixture.exitCode === null) {
    fixture.stdin.end("stop\n");
    await once(fixture, "close");
  }
  for (const shutdown of host.shutdown) await shutdown();
  await rm(folder, { recursive: true, force: true });
}
