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
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { WorkerClient } from "../dist/client.js";
import { nativeWorkerLaunch } from "../dist/launcher.js";
import { ReferenceClient, referenceResult } from "./reference-client.mjs";

let activeCase;
async function retainCall(action, args, invoke) {
  const observation = { action, args };
  activeCase?.observations.push(observation);
  try {
    const result = await invoke();
    observation.response = result;
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
    row.status = "fail";
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
  await recordCase(
    diagnostic,
    "synthetic",
    "depth",
    "Retain raw response",
    async () => {
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
if (process.platform === "linux") {
  const run = promisify(execFile),
    launch = await nativeWorkerLaunch();
  const win = async (p) =>
    (await run("wslpath", ["-w", resolve(p)])).stdout.trim();
  const script = await win(fileURLToPath(import.meta.url)),
    reference = await win(process.argv[2]);
  const output = process.env.PI_CU_RELEASE_OUTPUT
    ? await win(process.env.PI_CU_RELEASE_OUTPUT)
    : undefined;
  const code = `import{pathToFileURL}from'node:url';${output ? `process.env.PI_CU_RELEASE_OUTPUT=${JSON.stringify(output)};` : "delete process.env.PI_CU_RELEASE_OUTPUT;"}process.argv=[process.execPath,${JSON.stringify(script)},${JSON.stringify(reference)}];await import(pathToFileURL(${JSON.stringify(script)}).href);`;
  const child = run(launch.executable, ["--input-type=module", "-e", code], {
    cwd: launch.cwd,
    timeout: 300000,
    maxBuffer: 16 * 1024 * 1024,
  });
  child.child.stdin.end();
  try {
    const r = await child;
    process.stdout.write(r.stdout);
    process.stderr.write(r.stderr);
  } catch (error) {
    process.stdout.write(error.stdout ?? "");
    process.stderr.write(error.stderr ?? String(error));
    process.exitCode = Number.isInteger(error.code) ? error.code : 1;
  }
  process.exit(process.exitCode ?? 0);
}
assert.equal(process.platform, "win32");
assert.ok(process.argv[2], "Pass reference checkout");
const reference = resolve(process.argv[2]),
  root = fileURLToPath(new URL("../", import.meta.url));
const folder = await mkdtemp(join(tmpdir(), "pi-cu-accessibility-compare-"));
process.env.PI_CU_SETTINGS_FILE = join(folder, "settings.json");
const report = {
  comparison: "accessibility",
  ok: false,
  physicalInput: false,
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
  const first = await next();
  const target = {
    nativeWindowHandle: Number(first),
    processId: child.pid,
    activate: false,
  };
  assert.ok(target.nativeWindowHandle > 0, `Invalid fixture identity ${first}`);
  return {
    child,
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
      call: async (action, args) =>
        retainCall(action, args, async () =>
          referenceResult(await client.call(action, args)),
        ),
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
  const operation = randomUUID();
  return {
    call: (action, args) =>
      retainCall(action, args, () =>
        worker.execute(action, args, undefined, operation),
      ),
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
async function runChromium() {
  const title = `Pi paired Chromium ${randomUUID()}`,
    html = join(folder, "page.html");
  await writeFile(
    html,
    `<!doctype html><title>${title}</title><label>Fixture browser editor<input value="browser fixture text"></label><button>Fixture browser action</button>`,
  );
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
  browser = spawn(
    executable,
    [
      `--user-data-dir=${join(folder, "profile")}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-mode",
      "--disable-features=CalculateNativeWinOcclusion",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      `--app=${pathToFileURL(html).href}`,
    ],
    { stdio: ["ignore", "ignore", "pipe"], windowsHide: true, cwd: folder },
  );
  for (const name of ["pi", "reference"]) {
    const client = await engine(name);
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
            target = r.windows.find((w) => w.name.includes(title));
            if (target) break;
            await delay(150);
          }
          assert.ok(target, "Owned browser window not discoverable");
          const args = {
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
          return {
            name: info.element.name,
            controlType: info.element.controlType,
            webContent: r.webContent ?? null,
            attemptDeadlineMs: 10000,
          };
        },
      );
    } finally {
      await closeClient(client);
    }
  }
}
try {
  for (const name of ["reference", "pi"]) {
    await runNative(name);
    await runProvider(name);
  }
  await runChromium();
} catch (error) {
  report.fatal = String(error);
} finally {
  let clean = report.controllerCleanupConfirmed;
  for (const child of fixtures) {
    try {
      await stop(child);
    } catch (error) {
      clean = false;
      report.cleanupError = String(error);
    }
  }
  if (browser?.pid) {
    const closed =
      browser.exitCode !== null || browser.signalCode !== null
        ? Promise.resolve()
        : once(browser, "close");
    const killed = spawnSync(
      "taskkill.exe",
      ["/PID", String(browser.pid), "/T", "/F"],
      { encoding: "utf8", windowsHide: true },
    );
    if (killed.status !== 0) report.browserCleanupWarning = killed.stderr;
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
report.notRun.push({
  id: "provider.explicit-failure",
  reason:
    "The unknown-control provider returned a traversable tree in both engines; a deliberately failing provider and its explicit error metadata were not exercised.",
});
report.notRun.push({
  id: "provider.hung-call",
  reason:
    "No deliberately hanging provider injected; configured traversal budget is reported but cannot bound a synchronous provider call.",
});
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
