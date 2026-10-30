// Isolated SDK preflight; optional synthetic provider uses localhost only and never executes tools.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const values = {};
for (let i = 0; i < argv.length; i++) {
  const flag = argv[i];
  if (["--discover", "--model-roster"].includes(flag)) {
    assert.equal(values[flag], undefined, `${flag} supplied twice`);
    values[flag] = true;
    continue;
  }
  assert.ok(["--host", "--reference"].includes(flag), `Unknown option ${flag}`);
  assert.ok(
    argv[i + 1] && !argv[i + 1].startsWith("--"),
    `${flag} needs a value`,
  );
  assert.equal(values[flag], undefined, `${flag} supplied twice`);
  values[flag] = resolve(argv[++i]);
}
assert.ok(values["--host"], "Pass --host <installed-dsh/lib/bin.js>");
assert.ok(
  !values["--model-roster"] || values["--discover"],
  "--model-roster requires --discover",
);
const host = values["--host"];
assert.ok(
  !values["--discover"] || values["--reference"],
  "--discover requires --reference",
);
const pkg = JSON.parse(
  await readFile(join(dirname(dirname(host)), "package.json"), "utf8"),
);
assert.equal(pkg.name, "@deepseek-ai/dsh", "Host must be a DSH installation");
let reference = "not-requested";
if (values["--reference"]) {
  const root = values["--reference"];
  const refPkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const revision = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], {
    encoding: "utf8",
    timeout: 5000,
  }).trim();
  const dirtyTracked =
    execFileSync(
      "git",
      ["-C", root, "status", "--porcelain", "--untracked-files=no"],
      { encoding: "utf8", timeout: 5000 },
    ).trim().length > 0;
  reference = {
    version: refPkg.version,
    dirtyTracked,
    revision,
    pinned:
      !dirtyTracked &&
      refPkg.version === "0.5.3" &&
      revision === "6fb642129595a6357588c70812974951db304662",
  };
  assert.equal(
    reference.pinned,
    true,
    "Reference does not match the agreed DSH 0.5.3 revision",
  );
}
const dir = await mkdtemp(join(tmpdir(), "pi-cu-dsh-sdk-"));
let child;
let isolatedHomeRemoved = false;
let processClosed = false;
let ended;
let result;
let failure;
let observerCleanupConfirmed = !values["--discover"];
let fixtureServer;
let modelNames;
let fixtureRequests = 0;
let fixtureError;

try {
  // Deliberately do not inherit provider secrets, HOME, user DSH_HOME or cwd .env.
  const env = {
    PATH: process.env.PATH ?? "",
    LANG: "C.UTF-8",
    DSH_HOME: dir,
    DSH_PRIMARY_RUNTIME: "",
  };
  // Windows process startup requires these OS paths; no provider credentials are copied.
  for (const key of ["SystemRoot", "WINDIR", "TEMP", "TMP", "PATHEXT"])
    if (process.env[key]) env[key] = process.env[key];
  if (values["--model-roster"]) {
    env.PI_CU_FIXTURE_TOKEN = "synthetic-fixture-token";
    fixtureServer = createServer((req, res) => {
      fixtureRequests++;
      if (
        fixtureRequests !== 1 ||
        req.method !== "POST" ||
        req.url !== "/v1/chat/completions"
      ) {
        fixtureError = "Unexpected synthetic-provider request";
        res.writeHead(400).end();
        return;
      }
      let body = "";
      req.setEncoding("utf8");
      req.on("data", (chunk) => {
        body += chunk;
        if (body.length > 2_000_000) {
          fixtureError = "Synthetic-provider request exceeded size limit";
          req.destroy();
        }
      });
      req.on("end", () => {
        try {
          const parsed = JSON.parse(body);
          assert.ok(Array.isArray(parsed.tools));
          modelNames = parsed.tools.map((tool) => tool.function?.name);
          assert.ok(modelNames.every((name) => typeof name === "string"));
          res.writeHead(200, { "content-type": "text/event-stream" });
          res.end(
            `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 0, model: "fixture", choices: [{ index: 0, delta: { content: "Done." }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
          );
        } catch {
          fixtureError = "Invalid synthetic-provider request";
          res.writeHead(400).end();
        }
      });
    });
    await new Promise((resolveListen, reject) => {
      fixtureServer.once("error", reject);
      fixtureServer.listen(0, "127.0.0.1", resolveListen);
    });
  }
  const launchArgs = [host, "--profile", "sdk"];
  const trace = join(dir, "trace.jsonl");
  if (values["--discover"]) {
    const overlay = join(dir, "discovery.json");
    const observer = fileURLToPath(
      new URL("./dsh-mcp-observer.mjs", import.meta.url),
    );
    await writeFile(
      overlay,
      JSON.stringify([
        ...(values["--model-roster"]
          ? [
              {
                id: "llm-pi-ai",
                config: {
                  providers: {
                    "pi-cu-fixture": {
                      apiKeyEnv: "PI_CU_FIXTURE_TOKEN",
                      api: "openai-completions",
                      baseURL: `http://127.0.0.1:${fixtureServer.address().port}/v1`,
                      models: [{ id: "fixture", name: "Fixture" }],
                      retryPolicy: { mode: "normal", maxRetries: 0 },
                    },
                  },
                },
              },
            ]
          : []),
        {
          insert: [
            {
              id: "pi-cu-reference-discovery",
              name: "@deepseek-ai/dsh-mcp-client",
              config: {
                serverName: "wincu",
                transport: "stdio",
                command: process.execPath,
                args: [
                  observer,
                  join(values["--reference"], "mcp/server.mjs"),
                  trace,
                ],
                failOnStartupError: true,
                reconnect: { enabled: false },
              },
            },
          ],
        },
      ]),
    );
    launchArgs.push("--patch", overlay);
  }
  child = spawn(process.execPath, launchArgs, {
    cwd: dir,
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  ended = new Promise((resolveExit) =>
    child.once("close", (...args) => {
      processClosed = true;
      resolveExit(args);
    }),
  );
  child.stderr.resume();
  const lines = createInterface({ input: child.stdout });
  const pending = new Map();
  lines.on("line", (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      for (const p of pending.values())
        p.reject(Error("DSH emitted non-protocol output"));
      pending.clear();
      return;
    }
    const item = pending.get(message.id);
    if (item) {
      pending.delete(message.id);
      item.resolve(message);
    }
  });
  child.on("error", (error) => {
    for (const p of pending.values()) p.reject(error);
    pending.clear();
  });
  child.once("close", () => {
    for (const p of pending.values())
      p.reject(Error("DSH exited before replying"));
    pending.clear();
  });
  const request = async (id, method, params) => {
    let timer;
    try {
      const response = new Promise((resolveResponse, reject) => {
        pending.set(id, { resolve: resolveResponse, reject });
      });
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
      );
      return await Promise.race([
        response,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(Error(`DSH ${method} timed out`)),
            30000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
      pending.delete(id);
    }
  };
  const init = await request(1, "initialize", {
    cwd: dir,
    provider: values["--model-roster"]
      ? "pi-cu-fixture"
      : values["--discover"]
        ? "deepseek-official"
        : "pi-cu-nonexistent",
    model: values["--model-roster"]
      ? "fixture"
      : values["--discover"]
        ? "deepseek-flash"
        : "pi-cu-nonexistent",
  });
  if (values["--discover"]) {
    assert.ok(
      init.result?.serverInfo && !init.error,
      "SDK initialize must succeed",
    );
  } else {
    assert.equal(
      init.error?.code,
      -32603,
      "Invalid local provider must be refused",
    );
    assert.match(
      init.error?.message ?? "",
      /no adapter registered for provider/i,
    );
  }
  if (values["--model-roster"]) {
    const prompt = await request(2, "session/prompt", {
      sessionId: "pi-cu-fixture",
      contentBlocks: [{ type: "text", text: "Reply done." }],
    });
    assert.ok(
      prompt.result?.messageId && !prompt.error,
      "Synthetic prompt must be enqueued",
    );
    const wait = await request(3, "session/wait", {
      sessionId: "pi-cu-fixture",
    });
    assert.ok(wait.result && !wait.error, "Synthetic session must settle");
  }
  const shutdown = await request(4, "shutdown", {});
  assert.ok(
    shutdown.result && !shutdown.error,
    "SDK shutdown must be acknowledged",
  );
  child.stdin.end();
  let timer;
  const [code] = await Promise.race([
    ended,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error("DSH exit unconfirmed")), 10000);
    }),
  ]).finally(() => clearTimeout(timer));
  assert.equal(code, 0, "SDK must exit cleanly");
  lines.close();
  let discovery = "not-tested";
  if (values["--discover"]) {
    const events = (await readFile(trace, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const observations = events.filter(
      (event) => event.response === "tools/list",
    );
    assert.ok(
      observations.some((event) =>
        event.names?.includes("windows_computer_use_health"),
      ),
      "Reference health must be discovered through MCP",
    );
    assert.ok(
      !events.some((event) => event.request === "tools/call"),
      "No tool call is permitted",
    );
    const starts = events
      .filter((event) => event.observerStart)
      .map((event) => event.observerStart);
    observerCleanupConfirmed =
      starts.length > 0 &&
      starts.every((pid) =>
        events.some(
          (event) =>
            event.observer === pid && Object.hasOwn(event, "referenceExit"),
        ),
      );
    assert.ok(
      observerCleanupConfirmed,
      "All reference process exits must be observed",
    );
    assert.ok(
      starts.every((pid) =>
        events.some(
          (event) => event.observer === pid && event.referenceExit === 0,
        ),
      ),
      "All reference processes must exit cleanly",
    );
    if (values["--model-roster"]) {
      assert.equal(fixtureError, undefined, fixtureError);
      assert.equal(
        fixtureRequests,
        1,
        "Exactly one synthetic-provider request must be observed",
      );
      const discoveredNames = observations.at(-1).names;
      assert.ok(
        discoveredNames.length > 0,
        "Reference roster must not be empty",
      );
      assert.ok(
        discoveredNames.every((name) =>
          modelNames.includes(`mcp__wincu__${name}`),
        ),
        "Every discovered reference tool must be model-visible",
      );
    }
    discovery = {
      bridge: "generic-mcp",
      toolCount: observations.at(-1).names.length,
      modelVisibleRoster: values["--model-roster"]
        ? "synthetic-provider-verified"
        : "not-verified",
      windowsBackend: "not-tested",
    };
  }
  result = {
    ok: true,
    hostVersion: pkg.version,
    sdkHandshake: values["--discover"]
      ? "initialized"
      : "invalid-provider-refused",
    shutdown: "acknowledged-parent-exited",
    descendantCleanup: "not-verified",
    modelCalls: values["--model-roster"]
      ? "one-local-synthetic-request"
      : false,
    toolDiscovery: discovery,
    reference,
    wslAdapter: "not-verified",
  };
} catch (error) {
  failure = error;
} finally {
  try {
    if (fixtureServer) {
      fixtureServer.closeAllConnections();
      await new Promise((resolveClose) => fixtureServer.close(resolveClose));
    }
    const waitForExit = async () => {
      let timer;
      try {
        await Promise.race([
          ended,
          new Promise((resolveDelay) => {
            timer = setTimeout(resolveDelay, 3000);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    };
    if (child?.pid && !processClosed) {
      child.kill();
      await waitForExit();
      if (!processClosed) {
        child.kill("SIGKILL");
        await waitForExit();
      }
    }
    if ((child?.pid && !processClosed) || !observerCleanupConfirmed) {
      console.error(`DSH exit unconfirmed; isolated home retained: ${dir}`);
      failure ??= Error("DSH or reference process exit unconfirmed");
    } else {
      await rm(dir, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
      isolatedHomeRemoved = true;
    }
  } catch (error) {
    console.error(`DSH cleanup unconfirmed: ${String(error)}`);
    failure ??= error;
  }
}
if (failure) throw failure;
console.log(JSON.stringify({ ...result, isolatedHomeRemoved }));
