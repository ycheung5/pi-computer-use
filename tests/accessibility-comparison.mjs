// Paired public desktop observations/background controls against owned fixtures.
import assert from "node:assert/strict";
import { execFile, spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

let activeCase;
const ownedPids = new Set(),
  ownedTitles = new Set();
function relevantEvidence(action, result) {
  if (action !== "list_windows" || !result || typeof result !== "object")
    return result;
  const retained = { ...result };
  if (Array.isArray(result.windows)) {
    retained.windows = result.windows.filter(
      (window) =>
        ownedPids.has(window.processId) ||
        [...ownedTitles].some((title) => window.name?.includes(title)),
    );
    retained.observedWindowCount = result.windows.length;
    retained.omittedUnrelatedWindowCount =
      result.windows.length - retained.windows.length;
  }
  if (result.mcpResult?.content)
    retained.mcpResult = {
      ...result.mcpResult,
      content: result.mcpResult.content.map((block) => {
        if (block.type !== "text") return block;
        try {
          return {
            ...block,
            text: JSON.stringify(
              relevantEvidence(action, JSON.parse(block.text)),
            ),
          };
        } catch {
          return block;
        }
      }),
    };
  return retained;
}
async function retainCall(action, args, invoke) {
  const observation = { action, args };
  activeCase?.observations.push(observation);
  try {
    const result = await invoke();
    observation.response = relevantEvidence(action, result);
    return result;
  } catch (error) {
    observation.error = String(error);
    if (error.rpcError) observation.rpcError = error.rpcError;
    throw error;
  }
}
async function recordCase(report, name, id, expected, run) {
  const row = {
    engine: name,
    id,
    expected,
    status: "pass",
    actual: null,
    observations: [],
  };
  const start = performance.now();
  let halt;
  activeCase = row;
  try {
    row.actual = await run();
  } catch (error) {
    row.status = error.prerequisiteBlocked ? "blocked" : "fail";
    row.error = String(error);
    row.actual = error.actual ?? null;
    if (error.observation) row.observation = error.observation;
    if (error.expected !== undefined) row.assertionExpected = error.expected;
    row.cause = "unknown";
    if (/cancel|stopp|cleanup unconfirmed/i.test(row.error)) halt = error;
  } finally {
    activeCase = undefined;
    row.durationMs = Math.round(performance.now() - start);
    report.cases.push(row);
  }
  if (halt) throw halt;
  return row;
}
if (process.argv.includes("--diagnostic-report")) {
  const diagnostic = { cases: [] };
  ownedPids.add(42);
  await recordCase(
    diagnostic,
    "synthetic",
    "depth",
    "Retain raw response",
    async () => {
      await retainCall("list_windows", {}, async () => ({
        windows: [
          { processId: 42, name: "owned" },
          { processId: 99, name: "private title" },
        ],
      }));
      const r = await retainCall(
        "accessibility_tree",
        { maxDepth: 0 },
        async () => ({ ok: true, truncated: false, tree: { name: "owned" } }),
      );
      assert.equal(r.truncated, true);
    },
  );
  try {
    await recordCase(
      diagnostic,
      "synthetic",
      "cancel",
      "Retain interrupted case",
      async () => {
        await retainCall("wait_for", {}, async () => {
          throw new Error("COMPUTER_USE_CANCELLED");
        });
      },
    );
  } catch (error) {
    diagnostic.halted = String(error);
  }
  console.log(JSON.stringify(diagnostic));
  process.exit(0);
}
// A real fixture entry is required before interpreting its public tool response.
function classifyUnavailable(entered, returned) {
  if (entered !== "provider:entered:unavailable")
    return {
      status: "blocked",
      message: "Owned provider fault entry not confirmed",
    };
  const result = returned?.result;
  const explicit = Boolean(
    ((result?.ok === true || result?.ok === false) && result?.providerError) ||
      (result?.ok === false &&
        /UIA_PROVIDER_ERROR|element.*unavailable|STALE_ELEMENT/i.test(
          String(result.error ?? ""),
        )) ||
      /UIA_PROVIDER_ERROR|element.*unavailable|STALE_ELEMENT/i.test(
        returned?.error ?? "",
      ),
  );
  if (!explicit)
    return {
      status: "blocked",
      message:
        "Provider unavailable fault was entered but explicit error propagation was not observed",
    };
  if (
    result?.ok === true &&
    (result.truncated !== true || result.conclusive !== false)
  )
    return {
      status: "fail",
      message: "Provider failure must be incomplete and inconclusive",
    };
  return { status: "pass", message: "Provider failure reported honestly" };
}
const providerReport = process.argv
  .slice(2)
  .find((arg) => arg.startsWith("--provider-unavailable-report="));
if (providerReport) {
  const evidence = JSON.parse(
    await readFile(
      providerReport.slice("--provider-unavailable-report=".length),
      "utf8",
    ),
  );
  const result = classifyUnavailable(evidence.entered, evidence.returned);
  console.log(
    JSON.stringify({
      ...result,
      executed: false,
      physicalInput: false,
      evidence,
    }),
  );
  process.exit(result.status === "pass" ? 0 : 1);
}
const nativeScrollOnly = process.argv.includes("--native-scroll-only");
const nativeChromiumOnly = process.argv.includes("--native-chromium-only");
if (nativeChromiumOnly) {
  assert.ok(
    process.argv
      .slice(2)
      .every(
        (arg) =>
          !arg.startsWith("--") ||
          ["--native-chromium-only", "--plan"].includes(arg),
      ),
    "Unknown native Chromium option",
  );
  if (process.argv.includes("--plan")) {
    console.log(
      JSON.stringify({
        executed: false,
        physicalInput: false,
        fallback: false,
        engines: ["reference", "pi"],
        cases: [
          "chromium.native-uia",
          "chromium.set-value",
          "chromium.focus",
          "chromium.invoke",
        ],
      }),
    );
    process.exit(0);
  }
}
const providerUnavailableOnly = process.argv.includes(
  "--provider-unavailable-only",
);
assert.ok(
  [nativeScrollOnly, providerUnavailableOnly, nativeChromiumOnly].filter(
    Boolean,
  ).length <= 1,
  "Choose only one isolated comparison",
);
if (providerUnavailableOnly) {
  const args = process.argv.slice(2);
  assert.ok(
    args.every(
      (arg) =>
        !arg.startsWith("--") ||
        arg === "--provider-unavailable-only" ||
        arg === "--plan",
    ),
    "Unknown provider probe option",
  );
  if (args.includes("--plan")) {
    console.log(
      JSON.stringify({
        executed: false,
        physicalInput: false,
        engines: ["reference", "pi"],
        cases: ["provider.unavailable"],
      }),
    );
    process.exit(0);
  }
}
const scrollArguments = process.argv.slice(2);
if (nativeScrollOnly) {
  assert.ok(
    scrollArguments.every(
      (arg) =>
        !arg.startsWith("--") ||
        arg === "--native-scroll-only" ||
        arg === "--plan",
    ),
    "Unknown native scroll option",
  );
  if (scrollArguments.includes("--plan")) {
    console.log(
      JSON.stringify({
        executed: false,
        physicalInput: "possible",
        engines: ["reference", "pi"],
        cases: ["native.scroll"],
        optIn: "PI_CU_DEDICATED_INPUT_DESKTOP=1",
      }),
    );
    process.exit(0);
  }
  assert.equal(
    process.env.PI_CU_DEDICATED_INPUT_DESKTOP,
    "1",
    "Set PI_CU_DEDICATED_INPUT_DESKTOP=1 on an authorized idle desktop for native element scroll",
  );
}
const cliReference =
  nativeScrollOnly || providerUnavailableOnly || nativeChromiumOnly
    ? scrollArguments.find((arg) => !arg.startsWith("--"))
    : process.argv[2];
assert.ok(cliReference, "Pass reference checkout");
// Planning and physical-input refusal above deliberately precede all backend imports.
const [
  { WorkerClient },
  { nativeWorkerLaunch },
  { ReferenceClient, referenceResult },
] = await Promise.all([
  import("../dist/client.js"),
  import("../dist/launcher.js"),
  import("./reference-client.mjs"),
]);
if (process.platform === "linux") {
  const run = promisify(execFile),
    launch = await nativeWorkerLaunch();
  const win = async (p) =>
    (await run("wslpath", ["-w", resolve(p)])).stdout.trim();
  const script = await win(fileURLToPath(import.meta.url)),
    reference = await win(cliReference);
  const output = process.env.PI_CU_RELEASE_OUTPUT
    ? await win(process.env.PI_CU_RELEASE_OUTPUT)
    : undefined;
  const code = `import{pathToFileURL}from'node:url';${output ? `process.env.PI_CU_RELEASE_OUTPUT=${JSON.stringify(output)};` : "delete process.env.PI_CU_RELEASE_OUTPUT;"}process.argv=[process.execPath,${JSON.stringify(script)},${JSON.stringify(reference)},...${JSON.stringify(nativeScrollOnly ? ["--native-scroll-only"] : providerUnavailableOnly ? ["--provider-unavailable-only"] : nativeChromiumOnly ? ["--native-chromium-only"] : process.argv.slice(3))}];await import(pathToFileURL(${JSON.stringify(script)}).href);`;
  const child = run(launch.executable, ["--input-type=module", "-e", code], {
    cwd: launch.cwd,
    ...(nativeScrollOnly
      ? {
          env: {
            ...process.env,
            WSLENV: `${process.env.WSLENV ? `${process.env.WSLENV}:` : ""}PI_CU_DEDICATED_INPUT_DESKTOP`,
          },
        }
      : {}),
    timeout: 300000,
    maxBuffer: 16 * 1024 * 1024,
  });
  child.child.stdin.end();
  try {
    const r = await child;
    await new Promise((done) => process.stdout.write(r.stdout, done));
    await new Promise((done) => process.stderr.write(r.stderr, done));
  } catch (error) {
    await new Promise((done) => process.stdout.write(error.stdout ?? "", done));
    await new Promise((done) =>
      process.stderr.write(error.stderr ?? String(error), done),
    );
    process.exitCode = Number.isInteger(error.code) ? error.code : 1;
  }
  process.exit(process.exitCode ?? 0);
}
assert.equal(process.platform, "win32");
const reference = resolve(cliReference),
  root = fileURLToPath(new URL("../", import.meta.url));
const folder = await mkdtemp(join(tmpdir(), "pi-cu-accessibility-compare-"));
process.env.PI_CU_SETTINGS_FILE = join(folder, "settings.json");
const report = {
  comparison: "accessibility",
  ok: false,
  physicalInput: nativeScrollOnly ? "possible" : false,
  clipboard: false,
  environment: {
    platform: process.platform,
    node: process.version,
    reference: JSON.parse(
      await readFile(join(reference, "package.json"), "utf8"),
    ).version,
    pi: JSON.parse(await readFile(join(root, "package.json"), "utf8")).version,
  },
  cases: [],
  notRun: [],
  cleanupConfirmed: false,
  controllerCleanupConfirmed: true,
};
report.artifacts = {};
for (const [name, path] of Object.entries({
  referenceServer: join(reference, "mcp", "server.mjs"),
  referenceBackend: join(reference, "scripts", "windows-uia.ps1"),
  piWorker: join(root, "dist", "worker.js"),
  piControls: join(root, "assets", "controls.cs"),
  fixture: join(root, "tests", "controls-fixture.cs"),
  providerFixture: join(root, "tests", "nullable-uia-fixture.cs"),
})) {
  report.artifacts[name] = createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}
const framework = join(
  process.env.WINDIR,
  "Microsoft.NET",
  "Framework64",
  "v4.0.30319",
);
const fixtures = [];
const browsers = [];
let browser;
async function stop(child, command = "stop\n") {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const closed = once(child, "close");
  child.stdin?.end(command);
  const force = setTimeout(() => child.kill(), 3000);
  let deadline;
  try {
    await Promise.race([
      closed,
      new Promise((_, reject) => {
        deadline = setTimeout(
          () => reject(new Error("Fixture cleanup unconfirmed")),
          7000,
        );
      }),
    ]);
  } finally {
    clearTimeout(force);
    clearTimeout(deadline);
  }
}
async function fixture(source, title, extra = []) {
  const executable = join(folder, `${source}-${fixtures.length}.exe`);
  const compiled = spawnSync(
    join(framework, "csc.exe"),
    [
      "/nologo",
      "/target:exe",
      `/out:${executable}`,
      "/r:System.Windows.Forms.dll",
      "/r:System.Drawing.dll",
      ...extra,
      fileURLToPath(new URL(`./${source}.cs`, import.meta.url)),
    ],
    { encoding: "utf8", windowsHide: true, cwd: folder },
  );
  assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
  const child = spawn(executable, [title], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    cwd: folder,
  });
  const lines = createInterface({ input: child.stdout });
  const pending = [],
    queue = [];
  lines.on("line", (line) =>
    pending.length ? pending.shift()(line.trim()) : queue.push(line.trim()),
  );
  const next = () =>
    queue.length
      ? Promise.resolve(queue.shift())
      : new Promise((resolveLine, reject) => {
          const timer = setTimeout(
            () => reject(new Error("Fixture response timeout")),
            10000,
          );
          pending.push((line) => {
            clearTimeout(timer);
            resolveLine(line);
          });
        });
  fixtures.push(child);
  ownedPids.add(child.pid);
  const first = await next();
  const target = {
    nativeWindowHandle: Number(first),
    processId: child.pid,
    activate: false,
  };
  assert.ok(target.nativeWindowHandle > 0, `Invalid fixture identity ${first}`);
  return {
    child,
    next,
    target,
    title,
    command: async (command) => {
      const result = next();
      child.stdin.write(`${command}\n`);
      return result;
    },
    observe: async () => {
      const result = next();
      child.stdin.write("observe\n");
      const raw = (await result).split(":");
      assert.equal(raw[0], "state");
      return {
        editor: Buffer.from(raw[1], "base64").toString("utf8"),
        clicks: Number(raw[2]),
        scroll: Number(raw[3]),
        focused: raw[4] === "True",
        readOnly: Buffer.from(raw[5], "base64").toString("utf8"),
        disabled: Buffer.from(raw[6], "base64").toString("utf8"),
        activeEditor: raw[7] === "True",
        foregroundHandle: Number(raw[8]),
        lastInputTick: Number(raw[9]),
        fixtureHandle: Number(raw[10]),
        foregroundPid: Number(raw[11]),
      };
    },
  };
}
async function engine(name) {
  if (name === "reference") {
    const client = new ReferenceClient(reference, { cwd: folder });
    try {
      await client.init();
    } catch (error) {
      try {
        await client.close();
      } catch {
        report.controllerCleanupConfirmed = false;
      }
      throw error;
    }
    return {
      call: async (action, args, signal) =>
        retainCall(action, args, async () =>
          referenceResult(await client.call(action, args, signal)),
        ),
      controllerPid: async () => client.child.pid,
      settle: async () => {},
      freshOperation: () => {},
      close: () => client.close(),
    };
  }
  const worker = new WorkerClient({
    launch: async () => ({
      executable: process.execPath,
      args: [join(root, "dist", "worker.js")],
      cwd: folder,
    }),
    timeoutMs: 60000,
  });
  let operation = randomUUID();
  return {
    call: (action, args, signal) =>
      retainCall(action, args, () =>
        worker.execute(action, args, signal, operation),
      ),
    controllerPid: async () => (await worker.execute("health", {})).processId,
    settle: () => worker.execute("operation_end", {}, undefined, operation),
    freshOperation: () => {
      operation = randomUUID();
    },
    close: () => worker.dispose(),
  };
}
async function closeClient(client) {
  try {
    await client.close();
  } catch (error) {
    report.controllerCleanupConfirmed = false;
    throw error;
  }
}
function success(result) {
  assert.equal(result.ok, true, JSON.stringify(result));
  return result;
}
function refused(result) {
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.ok(result.error, "Failure must include evidence");
  return result;
}
const record = (name, id, expected, run) =>
  recordCase(report, name, id, expected, run);
// Each engine owns a fresh fixture. This element action may escalate to guarded
// physical wheel input, so it is reachable only through the dedicated gate.
async function runNativeScroll(name) {
  const owned = await fixture(
    "controls-fixture",
    `Pi paired scroll ${name} ${randomUUID()}`,
  );
  let client;
  try {
    client = await engine(name);
    await record(
      name,
      "native.scroll",
      "Fixture scroll offset increases from its reset state",
      async () => {
        const before = await owned.observe();
        assert.equal(
          before.scroll,
          0,
          "fresh fixture must start at scroll offset zero",
        );
        const found = success(
          await client.call("find", {
            ...owned.target,
            query: "Background scroller",
            controlType: "Pane",
            ocrFallback: false,
          }),
        );
        const matches = found.matches ?? found.results;
        assert.ok(
          Array.isArray(matches) && matches.length === 1,
          "require one fresh owned scroll target",
        );
        let result;
        try {
          result = await client.call("scroll", {
            ...owned.target,
            elementId: matches[0].id,
            deltaY: 240,
          });
        } catch (error) {
          report.inputCleanupUnconfirmed = true;
          throw new Error(
            `Element scroll response uncertain; cleanup unconfirmed: ${String(error)}`,
          );
        }
        if (result.cleanupConfirmed === false || !result.ok) {
          report.inputCleanupUnconfirmed = true;
          throw new Error(
            `Element scroll failed or cleanup unconfirmed: ${JSON.stringify(result)}`,
          );
        }
        let after;
        try {
          after = await owned.observe();
        } catch (error) {
          report.inputCleanupUnconfirmed = true;
          throw new Error(
            `Post-scroll observation unavailable; cleanup unconfirmed: ${String(error)}`,
          );
        }
        try {
          assert.ok(
            after.scroll > before.scroll,
            "fixture independently observed panel scrolling",
          );
        } catch (error) {
          error.observation = { before, after, toolResult: result };
          throw error;
        }
        return {
          before,
          after,
          toolResult: result,
          cleanupConfirmation: result.cleanupConfirmed ?? "not provided",
        };
      },
    );
    const settled = await client.settle();
    if (settled?.cleanupConfirmed === false)
      throw new Error(
        `Operation cleanup unconfirmed: ${JSON.stringify(settled)}`,
      );
  } finally {
    if (client) await closeClient(client);
    await stop(owned.child);
  }
}
async function runNative(name) {
  const prefix = `Pi paired ${name} ${randomUUID()}`;
  const owned = await fixture("controls-fixture", prefix);
  const alternate = await fixture("controls-fixture", `${prefix} alternate`);
  const small = await fixture("benchmark-fixture", `${prefix} small`);
  const client = await engine(name),
    args = owned.target;
  const call = (action, extra = {}) =>
    client.call(action, { ...args, ...extra });
  const find = async (query, controlType) => {
    const result = success(
      await call("find", {
        query,
        controlType,
        ocrFallback: false,
      }),
    );
    const matches = result.matches ?? result.results;
    assert.ok(Array.isArray(matches), JSON.stringify(result));
    assert.equal(matches.length, 1, JSON.stringify(result));
    return matches[0];
  };
  try {
    await record(name, "native.discovery", "Owned HWND/PID found", async () => {
      const r = success(await client.call("list_windows", { maxWindows: 200 }));
      const w = r.windows.find(
        (w) =>
          w.nativeWindowHandle === args.nativeWindowHandle &&
          w.processId === args.processId,
      );
      assert.ok(w);
      return { found: true, identity: true };
    });
    await record(
      name,
      "native.ambiguous",
      "Ambiguous prefix rejected",
      async () => {
        const r = refused(
          await client.call("accessibility_tree", {
            windowTitle: prefix,
            activate: false,
          }),
        );
        return { error: r.error };
      },
    );
    await record(
      name,
      "native.snapshot",
      "Tree without screenshot",
      async () => {
        const r = success(
          await call("snapshot", {
            includeScreenshot: false,
            maxDepth: 8,
            maxNodes: 500,
          }),
        );
        assert.ok(r.tree);
        assert.match(JSON.stringify(r.tree), /Background editor/);
        return { nodeCount: r.nodeCount, truncated: r.truncated, tree: true };
      },
    );
    await record(name, "native.tree", "Named editor in full tree", async () => {
      const r = success(
        await call("accessibility_tree", {
          detailLevel: "full",
          maxDepth: 8,
          maxNodes: 500,
        }),
      );
      assert.match(JSON.stringify(r.tree), /Background editor/);
      return { nodeCount: r.nodeCount, truncated: r.truncated };
    });
    await record(
      name,
      "native.node-budget",
      "Node-limit truncation",
      async () => {
        const r = await call("accessibility_tree", { maxNodes: 1 });
        assert.equal(r.truncated, true);
        return { nodeCount: r.nodeCount, truncationReason: r.truncationReason };
      },
    );
    await record(
      name,
      "native.depth-budget",
      "Depth-limit truncation",
      async () => {
        const r = await call("accessibility_tree", { maxDepth: 0 });
        assert.equal(r.truncated, true);
        return { nodeCount: r.nodeCount, truncationReason: r.truncationReason };
      },
    );
    await record(
      name,
      "native.time-budget",
      "Explicit 100 ms budget reported",
      async () => {
        const r = await call("accessibility_tree", { treeTimeoutMs: 100 });
        assert.equal(r.treeTimeoutMs, 100);
        return {
          durationMs: r.durationMs,
          truncated: r.truncated,
          truncationReason: r.truncationReason ?? null,
        };
      },
    );
    let editor;
    await record(
      name,
      "native.find-info",
      "Unique editor and full value",
      async () => {
        editor = await find("Background editor", "Edit");
        const r = success(
          await call("element_info", {
            elementId: editor.id,
            detailLevel: "full",
          }),
        );
        assert.equal(r.element.value, "original");
        return {
          name: r.element.name,
          value: r.element.value,
          controlType: r.element.controlType,
        };
      },
    );
    await record(
      name,
      "native.set-value",
      "Independent editor equals Pi 中文 café 😀",
      async () => {
        assert.ok(editor);
        const r = success(
          await call("set_value", {
            elementId: editor.id,
            value: "Pi 中文 café 😀",
            fallbackType: false,
          }),
        );
        assert.equal(r.verification, "sent");
        const actual = await owned.observe();
        assert.equal(actual.editor, "Pi 中文 café 😀");
        return actual;
      },
    );
    const focusRow = await record(
      name,
      "native.focus",
      "Intended editor is the logical active child; foreground effects recorded",
      async () => {
        assert.ok(editor);
        const before = await owned.observe();
        const result = success(await call("focus", { elementId: editor.id }));
        let after = await owned.observe();
        const until = Date.now() + 500;
        while (!after.activeEditor && Date.now() < until) {
          await delay(50);
          after = await owned.observe();
        }
        assert.equal(after.activeEditor, true);
        return {
          before,
          after,
          requestedTarget: args,
          requestedElementId: editor.id,
          toolResult: result,
          foregroundPreserved:
            before.foregroundHandle === after.foregroundHandle,
          interveningInput: before.lastInputTick !== after.lastInputTick,
          toolForeground: result.foreground ?? null,
          toolPointer: result.pointer ?? null,
          toolCleanupConfirmed: result.cleanupConfirmed ?? null,
          inputTargetHandle: result.inputTargetHandle ?? null,
          inputTargetProcessId: result.inputTargetProcessId ?? null,
          verification: result.verification ?? null,
        };
      },
    );
    if (!focusRow.actual?.before || focusRow.actual.interveningInput) {
      report.cases.push({
        engine: name,
        id: "native.focus-restoration",
        status: "blocked",
        cause: "environment",
        expected: "Prior foreground preserved when no intervening user input",
        actual: focusRow.actual,
        reason: "No reliable focus observation or intervening input detected",
      });
    } else {
      await record(
        name,
        "native.focus-restoration",
        "Prior foreground preserved when activate:false and input tick unchanged",
        async () => {
          try {
            assert.equal(focusRow.actual.foregroundPreserved, true);
          } catch (error) {
            error.observation = focusRow.actual;
            throw error;
          }
          return focusRow.actual;
        },
      );
    }
    let button;
    await record(
      name,
      "native.invoke",
      "Independent click counter is 1",
      async () => {
        button = await find("Background action", "Button");
        const r = success(
          await call("invoke", { elementId: button.id, fallbackClick: false }),
        );
        assert.equal(r.verification, "sent");
        const actual = await owned.observe();
        assert.equal(actual.clicks, 1);
        return actual;
      },
    );
    report.cases.push({
      engine: name,
      id: "native.scroll",
      status: "blocked",
      cause: "environment",
      expected: "Background-only element scroll",
      actual: null,
      reason:
        "User deferred physical input; public scroll has no no-fallback option, so this collector does not risk wheel escalation.",
    });
    await record(
      name,
      "native.read-only",
      "Read-only value preserved",
      async () => {
        const el = await find("Read only editor", "Edit");
        const r = refused(
          await call("set_value", {
            elementId: el.id,
            value: "forbidden",
            fallbackType: false,
          }),
        );
        const actual = await owned.observe();
        assert.equal(actual.readOnly, "fixed");
        return { error: r.error, readOnly: actual.readOnly };
      },
    );
    await record(
      name,
      "native.disabled",
      "Disabled value preserved",
      async () => {
        const el = await find("Disabled editor", "Edit");
        const r = refused(
          await call("set_value", {
            elementId: el.id,
            value: "forbidden",
            fallbackType: false,
          }),
        );
        const actual = await owned.observe();
        assert.equal(actual.disabled, "disabled fixed");
        return { error: r.error, disabled: actual.disabled };
      },
    );
    await record(
      name,
      "native.unsupported",
      "No click fallback for unsupported control",
      async () => {
        const el = await find("Unsupported label", "Text");
        const r = refused(
          await call("invoke", { elementId: el.id, fallbackClick: false }),
        );
        return { error: r.error };
      },
    );
    await record(name, "native.wrong-owner", "Wrong PID rejected", async () => {
      assert.ok(editor);
      const r = refused(
        await call("element_info", {
          elementId: editor.id,
          processId: args.processId + 1,
        }),
      );
      return { error: r.error };
    });
    await record(
      name,
      "native.unseen",
      "Unobserved runtime reference rejected",
      async () => {
        const r = refused(
          await call("element_info", { elementId: "uia:rt:999-888-777" }),
        );
        return { error: r.error };
      },
    );
    await record(
      name,
      "native.wait-present",
      "Present editor observed",
      async () => {
        const r = await call("wait_for", {
          condition: "element",
          query: "Background editor",
          controlType: "Edit",
          timeoutMs: 1000,
          intervalMs: 100,
        });
        assert.equal(r.verification, "observed", JSON.stringify(r));
        return {
          verification: r.verification,
          found: r.found,
          conclusive: r.conclusive,
        };
      },
    );
    let absenceEvidence;
    await record(
      name,
      "native.absent-element-observation",
      "Complete empty element observation on stable small fixture",
      async () => {
        const result = success(
          await client.call("find", {
            ...small.target,
            query: `absent-${prefix}`,
            ocrFallback: false,
            maxDepth: 8,
            maxNodes: 500,
            treeTimeoutMs: 5000,
          }),
        );
        const matches = result.matches ?? result.results;
        assert.equal(matches.length, 0);
        assert.equal(result.truncated, false, JSON.stringify(result));
        absenceEvidence = {
          complete: true,
          nodeCount: result.nodeCount ?? result.scannedNodes,
          durationMs: result.durationMs,
        };
        return absenceEvidence;
      },
    );
    await record(
      name,
      "native.wait-absent",
      "Complete absent element wait times out conclusively on unchanged fixture",
      async () => {
        assert.ok(absenceEvidence, "Complete initial observation prerequisite");
        const r = await client.call("wait_for", {
          ...small.target,
          condition: "element",
          query: `absent-${prefix}`,
          timeoutMs: 5000,
          treeTimeoutMs: 3000,
          intervalMs: 100,
          maxDepth: 8,
          maxNodes: 500,
        });
        try {
          assert.equal(r.found, false);
          assert.equal(r.conclusive, true);
          assert.equal(r.timedOut, true);
        } catch (error) {
          error.observation = { initial: absenceEvidence, wait: r };
          throw error;
        }
        return {
          initial: absenceEvidence,
          verification: r.verification,
          conclusive: r.conclusive,
          timedOut: r.timedOut,
        };
      },
    );
    await record(
      name,
      "native.wait-window-absent",
      "Absent owned-nonce window predicate times out conclusively",
      async () => {
        const r = await client.call("wait_for", {
          condition: "window",
          windowTitle: `absent-${prefix}`,
          activate: false,
          timeoutMs: 300,
          intervalMs: 100,
        });
        assert.equal(r.found, false);
        assert.equal(r.conclusive, true);
        assert.equal(r.timedOut, true);
        return {
          verification: r.verification,
          conclusive: r.conclusive,
          timedOut: r.timedOut,
        };
      },
    );
    await record(
      name,
      "native.wait-incomplete",
      "Truncated absence is inconclusive",
      async () => {
        const r = await call("wait_for", {
          condition: "element",
          query: `absent-${prefix}`,
          appear: false,
          timeoutMs: 300,
          intervalMs: 100,
          maxNodes: 1,
        });
        assert.equal(r.conclusive, false, JSON.stringify(r));
        assert.equal(r.found, false, JSON.stringify(r));
        assert.equal(r.timedOut, true, JSON.stringify(r));
        return {
          verification: r.verification,
          conclusive: r.conclusive,
          observationTruncated: r.observationTruncated,
        };
      },
    );
    await record(
      name,
      "native.stale",
      "Removed button reference rejected",
      async () => {
        assert.ok(button);
        await owned.command("remove");
        const r = refused(await call("element_info", { elementId: button.id }));
        return { error: r.error };
      },
    );
    await record(
      name,
      "native.final-preservation",
      "Read-only/disabled values preserved",
      async () => {
        const actual = await owned.observe();
        assert.equal(actual.readOnly, "fixed");
        assert.equal(actual.disabled, "disabled fixed");
        return actual;
      },
    );
  } finally {
    await closeClient(client);
    await stop(alternate.child);
    await stop(small.child);
    await stop(owned.child);
  }
}
async function runProvider(name) {
  const refs = [
    "UIAutomationClient.dll",
    "UIAutomationProvider.dll",
    "UIAutomationTypes.dll",
    "WindowsBase.dll",
  ].map((n) => `/r:${join(framework, "WPF", n)}`);
  const owned = await fixture("nullable-uia-fixture", "", refs),
    client = await engine(name);
  try {
    await record(
      name,
      "provider.unknown-type",
      "Known controls remain traversable around unsupported control type",
      async () => {
        const r = await client.call("snapshot", {
          ...owned.target,
          includeScreenshot: false,
        });
        assert.equal(r.ok, true, JSON.stringify(r));
        assert.ok(r.tree);
        const tree = JSON.stringify(r.tree);
        assert.match(tree, /Before custom provider/);
        assert.match(tree, /After custom provider/);
        const customControlTypes = [];
        const visit = (node) => {
          if (node.name === "Newer UIA control")
            customControlTypes.push(node.controlType);
          for (const child of node.children ?? []) visit(child);
        };
        visit(r.tree);
        return {
          ok: r.ok,
          customControlTypes,
          nodeCount: r.nodeCount,
          truncated: r.truncated,
          truncationReason: r.truncationReason ?? null,
          unknownControlTypes: r.unknownControlTypes ?? 0,
        };
      },
    );
  } finally {
    await closeClient(client);
    await stop(owned.child, "\n");
  }
}
// OS observations identify owned descendants by parent/creation identity only.
// No executable names, private handles or production test-only APIs are used.
async function processSnapshot() {
  const script =
    "@(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,@{n='created';e={$_.CreationDate.ToUniversalTime().ToString('o')}}) | ConvertTo-Json -Compress";
  const { stdout } = await promisify(execFile)(
    "powershell.exe",
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(script, "utf16le").toString("base64"),
    ],
    { timeout: 5000, windowsHide: true },
  );
  return JSON.parse(stdout.replace(/^\uFEFF/, ""));
}
function descendants(processes, controllerPid) {
  const ids = new Set([controllerPid]);
  let changed;
  do {
    changed = false;
    for (const process of processes) {
      if (ids.has(process.ParentProcessId) && !ids.has(process.ProcessId)) {
        ids.add(process.ProcessId);
        changed = true;
      }
    }
  } while (changed);
  return processes.filter(
    (process) =>
      process.ProcessId !== controllerPid && ids.has(process.ProcessId),
  );
}
const sameProcess = (a, b) =>
  a.ProcessId === b.ProcessId && a.created === b.created;
async function runProviderFailures(name) {
  const refs = [
    "UIAutomationClient.dll",
    "UIAutomationProvider.dll",
    "UIAutomationTypes.dll",
    "WindowsBase.dll",
  ].map((n) => `/r:${join(framework, "WPF", n)}`);
  for (const mode of providerUnavailableOnly
    ? ["unavailable"]
    : ["fault", "hang"]) {
    const owned = await fixture("nullable-uia-fixture", "", refs);
    const client = await engine(name);
    try {
      await record(
        name,
        `provider.${mode}`,
        mode === "unavailable"
          ? "Owned UIA unavailable fault triggers explicit provider-error evidence or records normalization as blocked"
          : mode === "fault"
            ? "Owned fault trigger and honest returned metadata"
            : "Bound caller cancellation of an entered provider, then release fixture",
        async () => {
          const controllerPid =
            mode === "hang" ? await client.controllerPid() : undefined;
          const beforeWarm =
            mode === "hang"
              ? descendants(await processSnapshot(), controllerPid)
              : [];
          success(
            await client.call("snapshot", {
              ...owned.target,
              includeScreenshot: false,
            }),
          );
          let reader, readerRetirement, readerCandidates;
          if (mode === "hang") {
            // operation_end exposes the mutex holder's PID through the normal
            // worker response; releasing the mutex keeps that helper alive.
            const settlement = await client.settle();
            readerCandidates = (processes) =>
              descendants(processes, controllerPid).filter(
                (p) =>
                  p.ParentProcessId === controllerPid &&
                  p.ProcessId !== settlement?.processId &&
                  !beforeWarm.some((q) => sameProcess(p, q)),
              );
            const first = readerCandidates(await processSnapshot());
            await delay(100);
            const second = readerCandidates(await processSnapshot());
            const persistent = second.filter((p) =>
              first.some((q) => sameProcess(p, q)),
            );
            readerRetirement = {
              controllerPid,
              beforeWarm,
              ownershipHolderPid: settlement?.processId,
              candidates: persistent,
              confirmed: false,
            };
            if (
              first.length !== 1 ||
              second.length !== 1 ||
              persistent.length !== 1
            ) {
              const error = new Error(
                "Reader identification blocked prerequisite: expected one new persistent owned direct child after warm read and ownership-holder exclusion",
              );
              error.prerequisiteBlocked = true;
              error.observation = { readerRetirement };
              throw error;
            }
            reader = persistent[0];
            client.freshOperation();
          }
          assert.equal(await owned.command(`arm:${mode}`), "armed");
          const controller = new AbortController();
          const started = performance.now();
          let returned;
          const pending = client
            .call(
              "snapshot",
              {
                ...owned.target,
                includeScreenshot: false,
                treeTimeoutMs: 3000,
              },
              controller.signal,
            )
            .then(
              (result) => {
                returned = { result };
              },
              (error) => {
                returned = { error: String(error) };
              },
            );
          let entered, settledBeforeAbort;
          const outcome = () => ({
            entered,
            settledBeforeAbort,
            readerRetirement,
            elapsedMs: Math.round(performance.now() - started),
            ...returned,
          });
          try {
            entered = await owned.next();
            assert.equal(entered, `provider:entered:${mode}`);
            if (mode === "hang") {
              const firstActive = readerCandidates(await processSnapshot());
              await delay(100);
              const secondActive = readerCandidates(await processSnapshot());
              readerRetirement.activeCandidates = secondActive.filter((p) =>
                firstActive.some((q) => sameProcess(p, q)),
              );
              readerRetirement.liveBeforeAbort =
                firstActive.some((p) => sameProcess(p, reader)) &&
                secondActive.some((p) => sameProcess(p, reader));
              readerRetirement.providerStateBeforeAbort =
                await owned.command("provider-state");
              if (
                !readerRetirement.liveBeforeAbort ||
                readerRetirement.activeCandidates.length !== 1 ||
                !sameProcess(readerRetirement.activeCandidates[0], reader) ||
                readerRetirement.providerStateBeforeAbort !==
                  "provider-state:1:False"
              ) {
                const error = new Error(
                  "Reader identification blocked prerequisite: warmed reader must remain uniquely persistent inside the entered provider before abort",
                );
                error.prerequisiteBlocked = true;
                throw error;
              }
              settledBeforeAbort = returned !== undefined;
              controller.abort(new Error("Owned provider cancellation"));
            }
            await pending;
            if (mode === "unavailable") {
              const classification = classifyUnavailable(entered, returned);
              if (classification.status !== "pass") {
                const error = new Error(classification.message);
                if (classification.status === "blocked")
                  error.prerequisiteBlocked = true;
                throw error;
              }
            }
            if (mode === "hang") {
              assert.equal(
                settledBeforeAbort,
                false,
                "Provider call must still be pending at cancellation",
              );
              assert.ok(
                performance.now() - started < 8000,
                "Cancellation must bound the blocked call before automatic release",
              );
              assert.ok(
                returned.error || returned.result?.ok === false,
                "Cancelled call must not claim successful observation",
              );
            }
            if (mode === "hang") {
              const deadline = performance.now() + 4000;
              let alive;
              do {
                alive = (await processSnapshot()).some((p) =>
                  sameProcess(p, reader),
                );
                if (!alive) break;
                await delay(100);
              } while (performance.now() < deadline);
              readerRetirement.exitObservedMs = Math.round(
                performance.now() - started,
              );
              readerRetirement.providerState =
                await owned.command("provider-state");
              readerRetirement.oldReaderAlive = alive;
              readerRetirement.confirmed =
                readerRetirement.liveBeforeAbort &&
                !alive &&
                readerRetirement.providerState === "provider-state:1:False" &&
                performance.now() - started < 12000;
              assert.equal(
                readerRetirement.confirmed,
                true,
                "Old reader must exit while the provider is still blocked and unreleased",
              );
            }
            return outcome();
          } catch (error) {
            error.observation = outcome();
            throw error;
          } finally {
            // Independent fixture IPC always releases the owned provider before disposal.
            owned.child.stdin.write("release\n");
            await pending;
            if (mode === "hang") {
              const released = [await owned.next(), await owned.next()];
              assert.deepEqual(released.sort(), [
                "provider:released",
                "release:ack",
              ]);
              await client.settle();
              client.freshOperation();
              const recovered = await client.call("snapshot", {
                ...owned.target,
                includeScreenshot: false,
              });
              success(recovered);
              assert.ok(recovered.tree);
              assert.match(
                JSON.stringify(recovered.tree),
                /Before custom provider/,
              );
              readerRetirement.freshReadRecovered = true;
            }
          }
        },
      );
    } finally {
      await closeClient(client);
      await stop(owned.child, "\n");
    }
  }
}
async function runChromium() {
  const title = `Pi paired Chromium ${randomUUID()}`,
    html = join(folder, "page.html");
  ownedTitles.add(title);
  let executable;
  for (const candidate of [
    join(
      process.env["ProgramFiles(x86)"] ?? "",
      "Microsoft",
      "Edge",
      "Application",
      "msedge.exe",
    ),
    join(
      process.env.ProgramFiles ?? "",
      "Google",
      "Chrome",
      "Application",
      "chrome.exe",
    ),
  ]) {
    try {
      await access(candidate);
      executable = candidate;
      break;
    } catch {}
  }
  if (!executable) {
    report.notRun.push({
      id: "chromium.native-uia",
      reason: "No installed fixture browser",
    });
    return;
  }
  let receipt, currentEngine;
  const token = randomUUID();
  const page = `<!doctype html><meta charset="utf-8"><title>${title}</title><label>Fixture browser editor<input id="editor" value="browser fixture text"></label><button id="action">Fixture browser action</button><script>
    let clicks=0,sequence=0;const run=location.search.slice(1);
    const editor=document.getElementById('editor'),button=document.getElementById('action');
    function report(){fetch('/${token}/receipt',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({run,sequence:++sequence,value:editor.value,activeControl:document.activeElement.id||'body',clicks})}).catch(()=>{});}
    button.addEventListener('click',()=>{clicks++;report();});
    document.addEventListener('focusin',report);
    setInterval(report,100);report();
  </script>`;
  await writeFile(html, page);
  const server = createServer(async (request, response) => {
    if (
      request.method === "GET" &&
      request.url === `/${token}/page?${currentEngine}`
    ) {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(
        page.replace(
          `<title>${title}</title>`,
          `<title>${title} ${currentEngine}</title>`,
        ),
      );
      return;
    }
    if (request.method === "POST" && request.url === `/${token}/receipt`) {
      let data = "";
      for await (const chunk of request) {
        data += chunk;
        if (data.length > 8192) {
          response.writeHead(413);
          response.end();
          return;
        }
      }
      try {
        const next = JSON.parse(data);
        if (
          next.run === currentEngine &&
          Number.isSafeInteger(next.sequence) &&
          (!receipt || next.sequence > receipt.sequence)
        )
          receipt = next;
        response.writeHead(204);
        response.end();
      } catch {
        response.writeHead(400);
        response.end();
      }
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/${token}/page`;
  const observed = async (predicate) => {
    const until = Date.now() + 3000;
    while (!predicate(receipt)) {
      if (Date.now() >= until)
        throw new Error(
          `Owned page observation not satisfied: ${JSON.stringify(receipt)}`,
        );
      await delay(20);
    }
    return { ...receipt };
  };
  const observer = await fixture(
    "controls-fixture",
    `Pi Chromium input observer ${randomUUID()}`,
  );
  ownedTitles.add(observer.title);
  try {
    for (const name of ["pi", "reference"]) {
      currentEngine = name;
      receipt = undefined;
      const targetTitle = `${title} ${name}`;
      ownedTitles.add(targetTitle);
      browser = spawn(
        executable,
        [
          `--user-data-dir=${join(folder, `profile-${name}`)}`,
          "--no-first-run",
          "--no-default-browser-check",
          "--disable-background-mode",
          "--disable-features=CalculateNativeWinOcclusion",
          "--disable-backgrounding-occluded-windows",
          "--disable-renderer-backgrounding",
          `--app=${url}?${name}`,
        ],
        { stdio: ["ignore", "ignore", "pipe"], windowsHide: true, cwd: folder },
      );
      browsers.push(browser);
      const client = await engine(name);
      let args, button;
      try {
        await record(
          name,
          "chromium.native-uia",
          "Native UIA finds fixture page button",
          async () => {
            let target;
            const until = Date.now() + 15000;
            while (Date.now() < until) {
              const r = success(
                await client.call("list_windows", {
                  maxWindows: 200,
                  includeInvisible: true,
                }),
              );
              assert.ok(
                Array.isArray(r.windows),
                JSON.stringify({ keys: Object.keys(r), error: r.error }),
              );
              target = r.windows.find((w) => w.name.includes(targetTitle));
              if (target) break;
              await delay(150);
            }
            assert.ok(target, "Owned browser window not discoverable");
            args = {
              nativeWindowHandle: target.nativeWindowHandle,
              processId: target.processId,
              activate: false,
            };
            let r;
            const ready = Date.now() + 10000;
            do {
              r = await client.call("find", {
                ...args,
                query: "Fixture browser action",
                ocrFallback: false,
                includeOffscreen: true,
              });
              if (
                (r.matches ?? r.results)?.some(
                  (x) => x.name === "Fixture browser action",
                )
              )
                break;
              if (!r.ok) break;
              await delay(150);
            } while (Date.now() < ready);
            success(r);
            const el = (r.matches ?? r.results ?? []).find(
              (x) => x.name === "Fixture browser action",
            );
            assert.ok(el, JSON.stringify(r));
            const info = success(
              await client.call("element_info", { ...args, elementId: el.id }),
            );
            assert.equal(info.element.controlType, "Button");
            button = el;
            const initialPage = await observed(
              (current) => current?.run === name,
            );
            try {
              assert.equal(initialPage.value, "browser fixture text");
              assert.equal(initialPage.activeControl, "body");
              assert.equal(initialPage.clicks, 0);
            } catch (error) {
              error.observation = { initialPage };
              throw error;
            }
            return {
              initialPage,
              name: info.element.name,
              controlType: info.element.controlType,
              webContent: r.webContent ?? null,
              attemptDeadlineMs: 10000,
            };
          },
        );
        if (!button || !args) continue;
        const findEditor = async () => {
          const found = success(
            await client.call("find", {
              ...args,
              query: "Fixture browser editor",
              controlType: "Edit",
              ocrFallback: false,
              includeOffscreen: true,
            }),
          );
          const matches = found.matches ?? found.results ?? [];
          assert.equal(matches.length, 1, JSON.stringify(found));
          return matches[0];
        };
        let editor;
        const actionCase = async (id, expected, run) =>
          record(name, id, expected, async () => {
            const before = await observer.observe();
            const pageBefore = await observed((value) => Boolean(value));
            let effect, after;
            try {
              effect = await run();
              after = await observer.observe();
              assert.equal(
                after.lastInputTick,
                before.lastInputTick,
                "Unexpected input activity; quiet native UIA delivery is unconfirmed",
              );
              return { before, after, pageBefore, ...effect };
            } catch (error) {
              error.observation = {
                ...effect,
                before,
                after: after ?? (await observer.observe()),
                pageBefore,
                pageAfter: effect?.pageAfter ?? receipt,
              };
              throw error;
            }
          });
        await actionCase(
          "chromium.focus",
          "Native UIA focus changes the logical active control without input fallback",
          async () => {
            editor = await findEditor();
            const first = success(
              await client.call("focus", { ...args, elementId: button.id }),
            );
            await observed((value) => value?.activeControl === "action");
            const result = success(
              await client.call("focus", { ...args, elementId: editor.id }),
            );
            const pageAfter = await observed(
              (value) => value?.activeControl === "editor",
            );
            return { toolResults: [first, result], pageAfter };
          },
        );
        const value = `Native UIA ${name} 中文 café 😀`;
        await actionCase(
          "chromium.set-value",
          "Native UIA value matches the independent page value",
          async () => {
            assert.ok(editor, "Editor discovery prerequisite failed");
            const result = success(
              await client.call("set_value", {
                ...args,
                elementId: editor.id,
                value,
                fallbackType: false,
              }),
            );
            assert.match(
              result.method,
              /^(uia_value|ValuePattern)$/,
              "fallback or unexpected native method is not accepted",
            );
            const pageAfter = await observed(
              (current) => current?.value === value,
            );
            return { toolResult: result, pageAfter };
          },
        );
        await actionCase(
          "chromium.invoke",
          "Native UIA invokes once and page reports exact field payload",
          async () => {
            const baseline = await observed((current) => Boolean(current));
            const result = success(
              await client.call("invoke", {
                ...args,
                elementId: button.id,
                fallbackClick: false,
              }),
            );
            assert.match(
              result.method,
              /^(uia_invoke|Invoke)$/,
              "fallback or unexpected native method is not accepted",
            );
            const pageAfter = await observed(
              (current) => current?.clicks === baseline.clicks + 1,
            );
            assert.equal(pageAfter.value, value);
            return {
              toolResult: result,
              pageAfter,
              clickIncrement: pageAfter.clicks - baseline.clicks,
            };
          },
        );
      } finally {
        await closeClient(client);
      }
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}
try {
  for (const name of nativeChromiumOnly ? [] : ["reference", "pi"]) {
    if (nativeScrollOnly) {
      await runNativeScroll(name);
      continue;
    }
    if (providerUnavailableOnly) {
      await runProviderFailures(name);
      continue;
    }
    if (!process.argv.includes("--provider-failures")) {
      await runNative(name);
      await runProvider(name);
    }
    await runProviderFailures(name);
  }
  if (
    nativeChromiumOnly ||
    (!nativeScrollOnly &&
      !providerUnavailableOnly &&
      !process.argv.includes("--provider-failures"))
  )
    await runChromium();
} catch (error) {
  report.fatal = String(error);
} finally {
  let clean =
    report.controllerCleanupConfirmed && !report.inputCleanupUnconfirmed;
  for (const child of fixtures) {
    try {
      await stop(child);
    } catch (error) {
      clean = false;
      report.cleanupError = String(error);
    }
  }
  for (const browser of browsers) {
    if (browser?.pid) {
      const exited = browser.exitCode !== null || browser.signalCode !== null;
      const closed = exited ? Promise.resolve() : once(browser, "close");
      // An already-exited child no longer authorizes terminating its old PID.
      if (!exited) {
        const killed = spawnSync(
          "taskkill.exe",
          ["/PID", String(browser.pid), "/T", "/F"],
          { encoding: "utf8", windowsHide: true },
        );
        if (killed.status !== 0) report.browserCleanupWarning = killed.stderr;
      }
      let timer;
      try {
        await Promise.race([
          closed,
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("Owned browser exit unconfirmed")),
              6000,
            );
          }),
        ]);
      } catch (error) {
        clean = false;
        report.browserCleanupError = String(error);
      } finally {
        clearTimeout(timer);
      }
    }
  }
  try {
    await rm(folder, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 200,
    });
  } catch (error) {
    clean = false;
    report.directoryCleanupError = String(error);
  }
  report.cleanupConfirmed = clean;
}
report.ok =
  !report.fatal &&
  report.cleanupConfirmed &&
  report.cases.every((row) => row.status === "pass") &&
  report.notRun.length === 0;
if (process.env.PI_CU_RELEASE_OUTPUT) {
  await mkdir(process.env.PI_CU_RELEASE_OUTPUT, { recursive: true });
  await writeFile(
    join(process.env.PI_CU_RELEASE_OUTPUT, "accessibility-comparison.json"),
    JSON.stringify(report, null, 2),
  );
}
console.log(JSON.stringify(report));
if (!report.ok) process.exitCode = 1;
