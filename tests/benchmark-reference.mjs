// Windows-only same-fixture comparison. Background native editing only; no input/clipboard.
import assert from "node:assert/strict";
import { execFile, spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { cpus, release, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { WorkerClient } from "../dist/client.js";
import { nativeWorkerLaunch } from "../dist/launcher.js";

if (process.platform === "linux") {
  assert.ok(process.argv[2], "Pass the reference checkout path");
  const run = promisify(execFile),
    launch = await nativeWorkerLaunch();
  const translate = async (path) =>
    (await run("wslpath", ["-w", resolve(path)])).stdout.trim();
  const script = await translate(fileURLToPath(import.meta.url));
  const reference = await translate(process.argv[2]);
  const output = process.env.PI_CU_RELEASE_OUTPUT
    ? await translate(process.env.PI_CU_RELEASE_OUTPUT)
    : undefined;
  const code = `import{pathToFileURL}from'node:url';${output ? `process.env.PI_CU_RELEASE_OUTPUT=${JSON.stringify(output)};` : "delete process.env.PI_CU_RELEASE_OUTPUT;"}process.argv=[process.execPath,${JSON.stringify(script)},${JSON.stringify(reference)},...${JSON.stringify(process.argv.slice(3))}];await import(pathToFileURL(${JSON.stringify(script)}).href);`;
  const child = run(launch.executable, ["--input-type=module", "-e", code], {
    cwd: launch.cwd,
    timeout: 240000,
    maxBuffer: 8 * 1024 * 1024,
  });
  child.child.stdin.end();
  try {
    const result = await child;
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
  } catch (error) {
    process.stdout.write(error.stdout ?? "");
    process.stderr.write(error.stderr ?? String(error));
    process.exitCode = Number.isInteger(error.code) ? error.code : 1;
  }
  process.exit(process.exitCode ?? 0);
}

assert.equal(process.platform, "win32", "Run the benchmark with Windows Node");
assert.ok(process.argv[2], "Pass the dsh-computer-use-win checkout path");
const reference = resolve(process.argv[2]);
const repetitions = Number(process.argv[3] ?? 3);
assert.ok(
  Number.isSafeInteger(repetitions) && repetitions >= 3 && repetitions <= 10,
  "Use 3–10 repetitions",
);
const root = fileURLToPath(new URL("../", import.meta.url));
const folder = await mkdtemp(join(tmpdir(), "pi-cu-benchmark-"));
process.env.PI_CU_SETTINGS_FILE = join(folder, "settings.json");
const executable = join(folder, "fixture.exe");
const compiler = join(
  process.env.WINDIR,
  "Microsoft.NET",
  "Framework64",
  "v4.0.30319",
  "csc.exe",
);
let fixture, target;
let fixtureOutput = "",
  fixtureId = 0;
const fixturePending = new Map();
const fixtureRequest = (action) =>
  new Promise((resolveRequest, reject) => {
    const id = ++fixtureId;
    const timer = setTimeout(() => {
      fixturePending.delete(id);
      reject(new Error(`Fixture ${action} timed out`));
    }, 5000);
    fixturePending.set(id, { resolve: resolveRequest, reject, timer });
    fixture.stdin.write(`${id} ${action}\n`);
  });
const closeProcess = async (child, command) => {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const ended = once(child, "close");
  child.stdin.end(command);
  const force = setTimeout(() => child.kill(), 3000);
  let deadline;
  try {
    await Promise.race([
      ended,
      new Promise((_, reject) => {
        deadline = setTimeout(
          () => reject(new Error("Process cleanup unconfirmed")),
          6000,
        );
      }),
    ]);
  } finally {
    clearTimeout(force);
    clearTimeout(deadline);
  }
};
const startFixture = async () => {
  const built = spawnSync(
    compiler,
    [
      "/nologo",
      "/target:exe",
      `/out:${executable}`,
      "/r:System.Windows.Forms.dll",
      fileURLToPath(new URL("./benchmark-fixture.cs", import.meta.url)),
    ],
    { encoding: "utf8", cwd: folder, windowsHide: true },
  );
  assert.equal(built.status, 0, built.stdout + built.stderr);
  fixture = spawn(executable, [`Pi benchmark ${randomUUID()}`], {
    stdio: ["pipe", "pipe", "pipe"],
    cwd: folder,
    windowsHide: true,
  });
  await new Promise((resolveReady, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Fixture startup timed out")),
      10000,
    );
    const fail = (error) => {
      clearTimeout(timeout);
      reject(error);
      for (const waiter of fixturePending.values()) {
        clearTimeout(waiter.timer);
        waiter.reject(error);
      }
      fixturePending.clear();
    };
    fixture.on("error", fail);
    fixture.on("close", () => fail(new Error("Fixture closed")));
    fixture.stdout.setEncoding("utf8");
    fixture.stdout.on("data", (chunk) => {
      fixtureOutput += chunk;
      for (;;) {
        const end = fixtureOutput.indexOf("\n");
        if (end < 0) break;
        const line = fixtureOutput.slice(0, end).trim();
        fixtureOutput = fixtureOutput.slice(end + 1);
        if (!line) continue;
        if (!target) {
          const handle = Number(line);
          if (!Number.isSafeInteger(handle) || handle <= 0) {
            fail(new Error("Invalid fixture identity"));
            return;
          }
          target = { nativeWindowHandle: handle, processId: fixture.pid };
          clearTimeout(timeout);
          resolveReady();
          continue;
        }
        try {
          const message = JSON.parse(line),
            waiter = fixturePending.get(message.id);
          if (!waiter) continue;
          fixturePending.delete(message.id);
          clearTimeout(waiter.timer);
          waiter.resolve(
            Buffer.from(message.valueBase64, "base64").toString("utf8"),
          );
        } catch (error) {
          fail(error);
        }
      }
    });
  });
};

class ReferenceClient {
  pending = new Map();
  next = 0;
  output = "";
  diagnostic = "";
  constructor() {
    this.child = spawn(
      process.execPath,
      [join(reference, "mcp", "server.mjs")],
      {
        cwd: reference,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          NODE_ENV: "test",
          WCU_TEST_NO_TAKEOVER: "1",
          WCU_INDICATOR: "0",
          WCU_TOOL_MODE: "full",
        },
      },
    );
    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk) => {
      this.diagnostic = (this.diagnostic + chunk).slice(-4096);
    });
    this.child.stdout.on("data", (chunk) => {
      this.output += chunk;
      for (;;) {
        const end = this.output.indexOf("\n");
        if (end < 0) break;
        const line = this.output.slice(0, end);
        this.output = this.output.slice(end + 1);
        if (!line.trim()) continue;
        const message = JSON.parse(line),
          waiter = this.pending.get(message.id);
        if (!waiter) continue;
        this.pending.delete(message.id);
        clearTimeout(waiter.timer);
        if (message.error)
          waiter.reject(new Error(JSON.stringify(message.error)));
        else waiter.resolve(message.result);
      }
    });
    const fail = (error) => {
      for (const wait of this.pending.values()) {
        clearTimeout(wait.timer);
        wait.reject(error);
      }
      this.pending.clear();
    };
    this.child.on("error", fail);
    this.child.on("close", (code) =>
      fail(new Error(`Reference exited ${code}: ${this.diagnostic}`)),
    );
  }
  request(method, params) {
    if (this.injectStop && method === "tools/call") {
      this.injectStop = false;
      return Promise.resolve({
        isError: true,
        content: [
          { type: "text", text: "CANCELLED: deliberate reference stop" },
          { type: "text", text: "Stop requested by test fixture" },
        ],
      });
    }
    const id = ++this.next;
    return new Promise((resolveRequest, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Reference timeout: ${method}`));
      }, 60000);
      this.pending.set(id, { resolve: resolveRequest, reject, timer });
      this.child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
      );
    });
  }
  async init() {
    await this.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "pi-cu-benchmark", version: "1" },
    });
    this.child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
    );
  }
  async call(action, args) {
    const response = await this.request("tools/call", {
      name: `windows_computer_use_${action}`,
      arguments: args,
    });
    if (response.isError === true) {
      const error = new Error(
        `Reference ${action} failed: ${JSON.stringify(response)}`,
      );
      error.referenceResult = response;
      throw error;
    }
    const content = response.content.find(
      (block) => block.type === "text" && block.text.trim().startsWith("{"),
    );
    const result = JSON.parse(content.text);
    assert.equal(result.ok, true, `${action}: ${JSON.stringify(result)}`);
    return result;
  }
  async close() {
    await closeProcess(this.child);
  }
}
const engines = {
  reference: async () => {
    const client = new ReferenceClient();
    try {
      await client.init();
      return client;
    } catch (error) {
      try {
        await client.close();
      } catch {
        error.cleanupUnconfirmed = true;
      }
      throw error;
    }
  },
  pi: async () => {
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
      call: async (action, args) => {
        const result = await worker.execute(action, args, undefined, operation);
        assert.equal(result.ok, true, `${action}: ${JSON.stringify(result)}`);
        return result;
      },
      close: () => worker.dispose(),
    };
  },
};
const measurements = { reference: [], pi: [] };
const timed = async (operation) => {
  const start = performance.now();
  const result = await operation();
  return { result, ms: Math.round((performance.now() - start) * 100) / 100 };
};
const find = async (client) => {
  const result = await client.call("find", {
    ...target,
    query: "Benchmark editor",
    controlType: "Edit",
    ocrFallback: false,
    maxDepth: 4,
    maxNodes: 120,
    maxResults: 5,
  });
  const matches = result.matches ?? result.results;
  assert.equal(matches.length, 1);
  return matches[0].id;
};
const set = async (client, elementId, value) => {
  const result = await client.call("set_value", {
    ...target,
    elementId,
    value,
    fallbackType: false,
    restoreClipboard: true,
  });
  assert.ok(
    ["EM_REPLACESEL", "native_edit"].includes(result.method),
    "Benchmark must use direct background Edit messages, never typing/clipboard fallback",
  );
  return result;
};
const verify = async (client, elementId, value) => {
  const result = await client.call("element_info", {
    ...target,
    elementId,
    detailLevel: "full",
  });
  assert.equal(result.element.value, value);
};
const cases = [];
const warmup = [];
const cleanup = { fixtureConfirmed: false, folderRemoved: false };
const injectMismatch = process.argv.includes("--verify-failure-collection");
const injectStop = process.argv.includes("--verify-stop-collection");
let haltReason;
const stopped = (error) =>
  /(?:CANCELLED|CANCELED|STOPPED|stop requested|CLEANUP[_ ]UNCONFIRMED)/i.test(
    String(error),
  ) || error.cleanupUnconfirmed;
const sample = async (name, index, isWarmup = false) => {
  const row = {
    id: isWarmup ? `warmup-${name}` : `edit-${index}-${name}`,
    engine: name,
    repetition: index,
    status: "not-run",
    cause: null,
    expected: isWarmup ? "warmup" : `workflow-${index}`,
    actual: null,
    initial: null,
    cleanup: { confirmed: false },
    timings: {},
  };
  let client,
    controllerCleanupUnconfirmed = false;
  try {
    row.initial = await fixtureRequest("reset");
    assert.equal(
      row.initial,
      "initial",
      "Fixture must start from known reset text",
    );
    const start = performance.now();
    client = await engines[name]();
    if (injectStop && !isWarmup && cases.length === 0 && name === "reference") {
      client.injectStop = true;
      row.injected = true;
      row.cause = "test-defect";
    }
    await client.call("health", {});
    row.timings.processColdHealthMs =
      Math.round((performance.now() - start) * 100) / 100;
    const id = await find(client);
    row.timings.processColdNativeReadyMs =
      Math.round((performance.now() - start) * 100) / 100;
    if (!isWarmup) {
      const warmRead = await timed(() => find(client));
      const dispatch = await timed(() => set(client, id, `dispatch-${index}`));
      await verify(client, id, `dispatch-${index}`);
      assert.equal(
        await fixtureRequest("read"),
        `dispatch-${index}`,
        "Fixture must independently observe dispatch",
      );
      row.timings.warmReadMs = warmRead.ms;
      row.timings.backgroundDispatchMs = dispatch.ms;
    }
    const value = row.expected;
    const workflow = await timed(async () => {
      const fresh = await find(client);
      await set(client, fresh, value);
      await verify(client, fresh, value);
    });
    row.timings.observedWorkflowMs = workflow.ms;
    row.actual = await fixtureRequest("read");
    if (injectMismatch && !isWarmup && cases.length === 0) {
      row.expected = "deliberate verification mismatch";
      row.cause = "test-defect";
      row.injected = true;
    }
    assert.equal(
      row.actual,
      row.expected,
      "Owned fixture must independently observe workflow text",
    );
    row.status = "pass";
  } catch (error) {
    row.status = row.initial === null ? "blocked" : "fail";
    row.cause ??= row.initial === null ? "environment" : "unknown";
    row.error = String(error);
    if (error.referenceResult) row.referenceResult = error.referenceResult;
    controllerCleanupUnconfirmed = error.cleanupUnconfirmed === true;
    if (row.initial !== null && row.actual === null) {
      try {
        row.actual = await fixtureRequest("read");
      } catch (observationError) {
        row.observationError = String(observationError);
      }
    }
    if (stopped(error))
      haltReason =
        "Operation stopped or cleanup unconfirmed; dependent cases blocked";
  } finally {
    if (controllerCleanupUnconfirmed) {
      row.cleanup.error = "Controller cleanup unconfirmed after failed startup";
      row.status = "fail";
    } else
      try {
        if (client) await client.close();
        assert.equal(
          await fixtureRequest("reset"),
          "initial",
          "Fixture reset must be independently confirmed",
        );
        row.cleanup.confirmed = true;
        row.cleanup.scope = "controller disposal and owned editor reset";
      } catch (error) {
        row.cleanup.error = String(error);
        row.status = "fail";
        row.cause ??= "unknown";
        haltReason =
          "Controller cleanup or fixture reset unconfirmed; dependent cases blocked";
      }
  }
  return row;
};
try {
  await startFixture();
  for (const name of Object.keys(engines)) {
    if (haltReason) break;
    warmup.push(await sample(name, -1, true));
  }
  for (let index = 0; index < repetitions; index++) {
    for (const name of index % 2 ? ["pi", "reference"] : ["reference", "pi"]) {
      if (haltReason) {
        cases.push({
          id: `edit-${index}-${name}`,
          engine: name,
          repetition: index,
          status: "blocked",
          cause: "unknown",
          reason: haltReason,
        });
        continue;
      }
      const row = await sample(name, index);
      cases.push(row);
      if (row.status === "pass") measurements[name].push(row.timings);
    }
  }
} catch (error) {
  haltReason = String(error);
  for (let index = 0; index < repetitions; index++) {
    for (const name of index % 2 ? ["pi", "reference"] : ["reference", "pi"]) {
      cases.push({
        id: `edit-${index}-${name}`,
        engine: name,
        repetition: index,
        status: "blocked",
        cause: "environment",
        reason: haltReason,
      });
    }
  }
} finally {
  try {
    await closeProcess(fixture, "stop\n");
    cleanup.fixtureConfirmed = true;
    await rm(folder, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
    cleanup.folderRemoved = true;
  } catch (error) {
    cleanup.error = String(error);
  }
}
const describe = (samples) =>
  samples.length === 0
    ? {}
    : Object.fromEntries(
        Object.keys(samples[0]).map((key) => {
          const sorted = samples.map((row) => row[key]).sort((a, b) => a - b);
          return [
            key,
            {
              meanMs:
                Math.round(
                  (sorted.reduce((a, b) => a + b, 0) / sorted.length) * 100,
                ) / 100,
              medianMs: sorted[Math.floor(sorted.length / 2)],
              minMs: sorted[0],
              maxMs: sorted.at(-1),
            },
          ];
        }),
      );
const artifact = async (path) =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
const report = {
  ok:
    cases.every((row) => row.status === "pass") &&
    warmup.every((row) => row.status === "pass") &&
    cleanup.fixtureConfirmed &&
    cleanup.folderRemoved,
  node: process.version,
  windows: release(),
  cpu: cpus()[0]?.model,
  repetitions,
  packages: {
    pi: JSON.parse(await readFile(join(root, "package.json"), "utf8")).version,
    reference: JSON.parse(
      await readFile(join(reference, "package.json"), "utf8"),
    ).version,
  },
  artifactSha256: {
    piWorker: await artifact(join(root, "dist", "worker.js")),
    referenceServer: await artifact(join(reference, "mcp", "server.mjs")),
    referenceBackend: await artifact(
      join(reference, "scripts", "windows-uia.ps1"),
    ),
    piNative: await artifact(join(root, "assets", "windows.cs")),
    piControls: await artifact(join(root, "assets", "controls.cs")),
    fixture: await artifact(
      fileURLToPath(new URL("./benchmark-fixture.cs", import.meta.url)),
    ),
  },
  methodology:
    "Same Windows Node and owned non-activating native Edit. Reset independently before/after each engine; fixture observes actual text independently of tool readback. Alternating engines. Process-cold uses warm caches, excludes installation and model overhead. Health payloads differ. Only background set_value with fallbackType:false; no physical input/clipboard. Failed cases retained; timing summaries contain passing samples only. Cleanup means controller disposal, owned editor reset and fixture removal, not whole-product cleanup acceptance.",
  diagnosticInjection: injectMismatch || injectStop,
  warmup,
  cases,
  cleanup,
  samples: measurements,
  summary: {
    reference: describe(measurements.reference),
    pi: describe(measurements.pi),
  },
};
if (process.env.PI_CU_RELEASE_OUTPUT) {
  await mkdir(process.env.PI_CU_RELEASE_OUTPUT, { recursive: true });
  await writeFile(
    join(process.env.PI_CU_RELEASE_OUTPUT, "benchmark.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
}
console.log(JSON.stringify(report));
if (!report.ok) process.exitCode = 1;
