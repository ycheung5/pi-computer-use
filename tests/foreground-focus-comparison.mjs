// Cross-process foreground restoration, owned fixtures; no physical input.
import assert from "node:assert/strict";

const args = process.argv.slice(2);
for (const arg of args)
  assert.ok(
    arg === "--plan" || /^--(engine|reference|report)=.+/.test(arg),
    `Unknown option: ${arg}`,
  );
const option = (name) =>
  args.find((x) => x.startsWith(`--${name}=`))?.slice(name.length + 3);
function classifyEvidence(evidence) {
  const { prior, before, pre, focus, samples } = evidence;
  const valid = (x) =>
    x &&
    Number.isFinite(x.foregroundHandle) &&
    Number.isFinite(x.foregroundPid) &&
    Number.isFinite(x.lastInputTick);
  if (
    !prior ||
    !Number.isFinite(prior.nativeWindowHandle) ||
    !Number.isFinite(prior.processId) ||
    !valid(before) ||
    !valid(pre) ||
    !Array.isArray(samples) ||
    samples.length === 0 ||
    !samples.every(valid)
  )
    return {
      status: "inconclusive",
      reason: "Incomplete identity or observation",
    };
  if (
    before.foregroundHandle !== prior.nativeWindowHandle ||
    before.foregroundPid !== prior.processId ||
    pre.foregroundHandle !== prior.nativeWindowHandle ||
    pre.foregroundPid !== prior.processId
  )
    return {
      status: "inconclusive",
      reason: "Prior foreground identity changed before dispatch",
    };
  if (
    pre.lastInputTick !== before.lastInputTick ||
    samples.some((x) => x.lastInputTick !== pre.lastInputTick)
  )
    return { status: "inconclusive", reason: "Intervening input observed" };
  if (focus?.ok !== true || !samples.some((x) => x.activeEditor === true))
    return { status: "fail", reason: "Target focus not observed" };
  const preserved = samples.every(
    (x) =>
      x.foregroundHandle === prior.nativeWindowHandle &&
      x.foregroundPid === prior.processId,
  );
  return {
    status: preserved ? "pass" : "fail",
    foregroundPreserved: preserved,
  };
}
const reportPath = option("report");
if (reportPath) {
  assert.equal(args.length, 1, "report cannot be combined with other options");
  const { readFile } = await import("node:fs/promises");
  const outcome = classifyEvidence(
    JSON.parse(await readFile(reportPath, "utf8")),
  );
  console.log(JSON.stringify({ executed: false, ...outcome }));
  process.exit(outcome.status === "pass" ? 0 : 1);
}
const engine = option("engine") ?? "pi";
assert.ok(["pi", "reference"].includes(engine));
if (args.includes("--plan")) {
  console.log(
    JSON.stringify({
      executed: false,
      engine,
      physicalInput: false,
      foregroundChangesPossible: true,
      cases: ["cross-process-prior-foreground"],
    }),
  );
  process.exit(0);
}
assert.equal(
  process.env.PI_CU_WINDOW_MANAGEMENT_TEST,
  "1",
  "PI_CU_WINDOW_MANAGEMENT_TEST=1 requires an authorized idle desktop",
);
assert.equal(process.platform, "win32", "Windows Node required");
const referencePath = option("reference");
if (engine === "reference") assert.ok(referencePath, "reference path required");
const [
  { spawn, spawnSync },
  { once },
  { mkdtemp, rm },
  { tmpdir },
  { join },
  { createInterface },
  { setTimeout: delay },
  { fileURLToPath },
  { createComparisonClient },
] = await Promise.all([
  import("node:child_process"),
  import("node:events"),
  import("node:fs/promises"),
  import("node:os"),
  import("node:path"),
  import("node:readline"),
  import("node:timers/promises"),
  import("node:url"),
  import("./comparison-client.mjs"),
]);
const folder = await mkdtemp(join(tmpdir(), "pi-cu-cross-focus-"));
process.env.PI_CU_SETTINGS_FILE = join(folder, "settings.json");
const fixtures = [];
let client,
  result = {
    engine,
    physicalInput: false,
    foregroundChangesPossible: true,
    status: "running",
    phase: "setup",
  },
  cleanupConfirmed = false;
async function fixture(label) {
  const child = spawn(join(folder, "controls.exe"), [label], {
    cwd: folder,
    windowsHide: false,
    stdio: ["pipe", "pipe", "pipe"],
  });
  fixtures.push(child);
  child.stderr.resume();
  const iter = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
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
  async function command(s) {
    child.stdin.write(`${s}\n`);
    return next();
  }
  const hwnd = Number(await next());
  assert.ok(hwnd > 0 && child.pid > 0);
  return {
    child,
    identity: { nativeWindowHandle: hwnd, processId: child.pid },
    command,
    async observe() {
      const x = (await command("observe")).split(":");
      assert.equal(x[0], "state");
      return {
        activeEditor: x[7] === "True",
        foregroundHandle: Number(x[8]),
        lastInputTick: Number(x[9]),
        fixtureHandle: Number(x[10]),
        foregroundPid: Number(x[11]),
      };
    },
  };
}
try {
  const compiler = join(
    process.env.WINDIR,
    "Microsoft.NET",
    "Framework64",
    "v4.0.30319",
    "csc.exe",
  );
  const build = spawnSync(
    compiler,
    [
      "/nologo",
      "/target:exe",
      `/out:${join(folder, "controls.exe")}`,
      "/r:System.Windows.Forms.dll",
      "/r:System.Drawing.dll",
      fileURLToPath(new URL("./controls-fixture.cs", import.meta.url)),
    ],
    { encoding: "utf8", windowsHide: true, cwd: folder },
  );
  assert.equal(build.status, 0, build.stdout + build.stderr);
  const prior = await fixture("Pi CU prior foreground");
  const target = await fixture("Pi CU focus target");
  result.prior = prior.identity;
  result.target = target.identity;
  assert.notEqual(prior.identity.processId, target.identity.processId);
  client = await createComparisonClient({ engine, referencePath, cwd: folder });
  result.phase = "activation";
  const activation = await client.execute("activate_window", prior.identity);
  result.activation = activation;
  if (!activation.ok || !activation.activated) {
    const e = new Error("Prior fixture activation not confirmed");
    e.details = activation;
    throw e;
  }
  const before = await target.observe();
  result.before = before;
  assert.equal(before.foregroundHandle, prior.identity.nativeWindowHandle);
  assert.equal(before.foregroundPid, prior.identity.processId);
  assert.equal(await target.command("prepare-focus"), "focus-ready");
  result.phase = "find";
  const found = await client.execute("find", {
    ...target.identity,
    query: "Background editor",
    controlType: "Edit",
    ocrFallback: false,
    activate: false,
  });
  result.found = found;
  assert.equal(found.ok, true, JSON.stringify(found));
  assert.equal(found.matches?.length, 1, "Exact single owned editor required");
  const pre = await target.observe();
  result.pre = pre;
  if (pre.lastInputTick !== before.lastInputTick) {
    const e = new Error("Intervening input before action");
    e.inconclusive = true;
    throw e;
  }
  if (
    pre.foregroundHandle !== prior.identity.nativeWindowHandle ||
    pre.foregroundPid !== prior.identity.processId
  ) {
    const e = new Error("Prior foreground identity changed before dispatch");
    e.inconclusive = true;
    throw e;
  }
  result.phase = "focus";
  const dispatchedAt = performance.now();
  const focus = await client.execute("focus", {
    ...target.identity,
    elementId: found.matches[0].id,
    activate: false,
  });
  result.focus = focus;
  const samples = [];
  result.samples = samples;
  for (const wait of [0, 50, 200, 500]) {
    if (wait) await delay(wait);
    const observation = await target.observe();
    samples.push({
      afterDispatchMs: Math.round(performance.now() - dispatchedAt),
      ...observation,
    });
  }
  result.diagnostic =
    "public focus dispatch and independent after-return observations; no internal guard-phase observation";
  Object.assign(result, classifyEvidence(result));
  if (result.status !== "pass") process.exitCode = 1;
} catch (error) {
  result.status = error.inconclusive ? "inconclusive" : "fail";
  result.error = String(error);
  if (error.details) {
    result.status = "blocked";
    result.details = error.details;
  }
  process.exitCode = 1;
} finally {
  try {
    if (client) await client.dispose();
    for (const child of fixtures) {
      if (child.exitCode !== null || child.signalCode !== null) continue;
      const closed = once(child, "close");
      child.stdin.end("stop\n");
      let timer;
      try {
        await Promise.race([
          closed,
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("Fixture cleanup unconfirmed")),
              5000,
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    }
    await rm(folder, { recursive: true, force: true });
    cleanupConfirmed = true;
  } catch (error) {
    result.status = "fail";
    result.cleanupError = String(error);
    result.retainedFolder = folder;
    process.exitCode = 1;
  }
}
console.log(JSON.stringify({ ...result, cleanupConfirmed }));
