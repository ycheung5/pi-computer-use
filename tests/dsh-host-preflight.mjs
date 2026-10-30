// Offline SDK preflight: isolated profile, no prompt, model request or desktop use.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";

const argv = process.argv.slice(2);
const values = {};
for (let i = 0; i < argv.length; i++) {
  const flag = argv[i];
  assert.ok(["--host", "--reference"].includes(flag), `Unknown option ${flag}`);
  assert.ok(
    argv[i + 1] && !argv[i + 1].startsWith("--"),
    `${flag} needs a value`,
  );
  assert.equal(values[flag], undefined, `${flag} supplied twice`);
  values[flag] = resolve(argv[++i]);
}
assert.ok(values["--host"], "Pass --host <installed-dsh/lib/bin.js>");
const host = values["--host"];
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
  child = spawn(process.execPath, [host, "--profile", "sdk"], {
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
    provider: "pi-cu-nonexistent",
    model: "pi-cu-nonexistent",
  });
  assert.equal(
    init.error?.code,
    -32603,
    "Invalid local provider must be refused",
  );
  assert.match(
    init.error?.message ?? "",
    /no adapter registered for provider/i,
  );
  const shutdown = await request(2, "shutdown", {});
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
  result = {
    ok: true,
    hostVersion: pkg.version,
    sdkHandshake: "invalid-provider-refused",
    shutdown: "acknowledged-parent-exited",
    descendantCleanup: "not-verified",
    modelCalls: false,
    toolDiscovery: "not-tested",
    reference,
    wslAdapter: "not-verified",
  };
} catch (error) {
  failure = error;
} finally {
  try {
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
    if (child?.pid && !processClosed) {
      console.error(`DSH exit unconfirmed; isolated home retained: ${dir}`);
      failure ??= Error("DSH exit unconfirmed");
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
