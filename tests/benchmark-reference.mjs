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
  const result = await child;
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exit(0);
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
const fixture = spawn(executable, [`Pi benchmark ${randomUUID()}`], {
  stdio: ["pipe", "pipe", "pipe"],
  cwd: folder,
  windowsHide: true,
});
const [ready] = await once(fixture.stdout, "data");
const target = {
  nativeWindowHandle: Number(ready.toString().trim()),
  processId: fixture.pid,
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
    assert.notEqual(response.isError, true, `Reference ${action} failed`);
    const content = response.content.find(
      (block) => block.type === "text" && block.text.trim().startsWith("{"),
    );
    const result = JSON.parse(content.text);
    assert.equal(result.ok, true, `${action}: ${JSON.stringify(result)}`);
    return result;
  }
  async close() {
    if (this.child.exitCode !== null) return;
    const ended = once(this.child, "close");
    this.child.stdin.end();
    const timer = setTimeout(() => this.child.kill(), 3000);
    await ended;
    clearTimeout(timer);
  }
}
const engines = {
  reference: async () => {
    const client = new ReferenceClient();
    await client.init();
    return client;
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
try {
  // Warm file/assembly caches equally; measured cold samples always create new controller processes.
  for (const create of Object.values(engines)) {
    const client = await create();
    try {
      await client.call("health", {});
      const id = await find(client);
      await set(client, id, "warmup");
      await verify(client, id, "warmup");
    } finally {
      await client.close();
    }
  }
  for (let index = 0; index < repetitions; index++) {
    for (const name of index % 2 ? ["pi", "reference"] : ["reference", "pi"]) {
      const start = performance.now(),
        client = await engines[name]();
      try {
        await client.call("health", {});
        const processColdHealthMs =
          Math.round((performance.now() - start) * 100) / 100;
        const id = await find(client);
        const processColdNativeReadyMs =
          Math.round((performance.now() - start) * 100) / 100;
        const warmRead = await timed(() => find(client));
        const dispatch = await timed(() =>
          set(client, id, `dispatch-${index}`),
        );
        await verify(client, id, `dispatch-${index}`);
        const workflow = await timed(async () => {
          const fresh = await find(client);
          const value = `workflow-${index}`;
          await set(client, fresh, value);
          await verify(client, fresh, value);
        });
        measurements[name].push({
          processColdHealthMs,
          processColdNativeReadyMs,
          warmReadMs: warmRead.ms,
          backgroundDispatchMs: dispatch.ms,
          observedWorkflowMs: workflow.ms,
        });
      } finally {
        await client.close();
      }
    }
  }
  const describe = (samples) =>
    Object.fromEntries(
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
    ok: true,
    node: process.version,
    windows: release(),
    cpu: cpus()[0]?.model,
    repetitions,
    packages: {
      pi: JSON.parse(await readFile(join(root, "package.json"), "utf8"))
        .version,
      reference: JSON.parse(
        await readFile(join(reference, "package.json"), "utf8"),
      ).version,
    },
    artifactSha256: {
      piWorker: await artifact(join(root, "dist", "worker.js")),
      referenceServer: await artifact(join(reference, "mcp", "server.mjs")),
    },
    methodology:
      "Same Windows Node, disposable native edit, alternating engines. Process-cold samples use warm runtime/compiler/assembly caches; no install/download timing. Reference MCP handshake+PowerShell path versus Pi worker request path; Pi agent/model overhead excluded. Health payloads differ; native-ready/find and verified edit workflow provide comparable effects. Only background set_value with fallbackType:false; no physical input or clipboard mutation.",
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
} finally {
  if (fixture.exitCode === null) {
    const ended = once(fixture, "close");
    fixture.stdin.end("stop\n");
    const timer = setTimeout(() => fixture.kill(), 1000);
    await ended;
    clearTimeout(timer);
  }
  await rm(folder, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}
