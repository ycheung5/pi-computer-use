import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const preflight = fileURLToPath(
  new URL("./dsh-host-preflight.mjs", import.meta.url),
);

test("isolated DSH SDK preflight uses no inherited credentials or prompt", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-cu-dsh-test-"));
  try {
    const lib = join(dir, "host", "lib");
    mkdirSync(lib, { recursive: true });
    writeFileSync(
      join(dir, "host", "package.json"),
      JSON.stringify({
        name: "@deepseek-ai/dsh",
        version: "fixture",
        type: "module",
      }),
    );
    const host = join(lib, "bin.js");
    writeFileSync(
      host,
      `import {createInterface} from 'node:readline';
if (process.env.OPENROUTER_API_KEY || !process.env.DSH_HOME || process.argv.slice(2).join(' ') !== '--profile sdk') process.exit(9);
const lines=createInterface({input:process.stdin});let n=0;
for await (const line of lines) {const q=JSON.parse(line);n++;if(n===1 && q.method==='initialize' && q.params.provider==='pi-cu-nonexistent') console.log(JSON.stringify({jsonrpc:'2.0',id:q.id,error:{code:-32603,message:'no adapter registered for provider pi-cu-nonexistent'}}));else if(n===2 && q.method==='shutdown'){console.log(JSON.stringify({jsonrpc:'2.0',id:q.id,result:{}}));process.exit(0)}else process.exit(8)}
`,
    );
    const r = spawnSync(process.execPath, [preflight, "--host", host], {
      encoding: "utf8",
      env: { ...process.env, OPENROUTER_API_KEY: "MUST_NOT_LEAK" },
      timeout: 20000,
    });
    assert.equal(r.status, 0, r.stderr);
    const report = JSON.parse(r.stdout);
    assert.equal(report.hostVersion, "fixture");
    assert.equal(report.sdkHandshake, "invalid-provider-refused");
    assert.equal(report.shutdown, "acknowledged-parent-exited");
    assert.equal(report.modelCalls, false);
    assert.equal(report.toolDiscovery, "not-tested");
    assert.equal(report.reference, "not-requested");
    assert.equal(report.isolatedHomeRemoved, true);
    assert.ok(!r.stdout.includes("MUST_NOT_LEAK"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("SDK preflight refuses a false successful handshake for the dummy provider", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-cu-dsh-reject-"));
  try {
    const lib = join(dir, "host", "lib");
    mkdirSync(lib, { recursive: true });
    writeFileSync(
      join(dir, "host", "package.json"),
      JSON.stringify({
        name: "@deepseek-ai/dsh",
        version: "fixture",
        type: "module",
      }),
    );
    const host = join(lib, "bin.js");
    writeFileSync(
      host,
      `import {createInterface} from 'node:readline'; for await (const line of createInterface({input:process.stdin})) { const request=JSON.parse(line); console.log(JSON.stringify({jsonrpc:'2.0',id:request.id,result:{serverInfo:{name:'wrong',version:'fixture'}}})); }`,
    );
    const r = spawnSync(process.execPath, [preflight, "--host", host], {
      encoding: "utf8",
      timeout: 20000,
    });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /Invalid local provider must be refused/);
    assert.ok(!r.stdout.includes('"ok":true'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("synthetic model roster preflight requires reference discovery", () => {
  const r = spawnSync(
    process.execPath,
    [preflight, "--host", "/unused", "--model-roster"],
    {
      encoding: "utf8",
      timeout: 20000,
    },
  );
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /--model-roster requires --discover/);
});

test("synthetic provider sees every discovered reference tool", {
  skip: !process.env.PI_CU_DSH_HOST || !process.env.PI_CU_DSH_REFERENCE,
}, () => {
  const r = spawnSync(
    process.execPath,
    [
      preflight,
      "--host",
      process.env.PI_CU_DSH_HOST ?? "",
      "--reference",
      process.env.PI_CU_DSH_REFERENCE ?? "",
      "--discover",
      "--model-roster",
    ],
    { encoding: "utf8", timeout: 60000 },
  );
  assert.equal(r.status, 0, r.stderr);
  const report = JSON.parse(r.stdout);
  assert.equal(report.modelCalls, "one-local-synthetic-request");
  assert.equal(report.toolDiscovery.toolCount, 25);
  assert.equal(
    report.toolDiscovery.modelVisibleRoster,
    "synthetic-provider-verified",
  );
  assert.equal(report.toolDiscovery.windowsBackend, "not-tested");
  assert.equal(report.isolatedHomeRemoved, true);
});

test("model roster rejects missing, duplicate, and unexpected reference tools", async () => {
  const { validateModelRoster } = await import("./dsh-preflight-evidence.mjs");
  const discovered = ["one", "two"];
  validateModelRoster(discovered, [
    "other",
    "mcp__wincu__one",
    "mcp__wincu__two",
  ]);
  assert.throws(
    () => validateModelRoster(discovered, ["mcp__wincu__one"]),
    /match/,
  );
  assert.throws(
    () =>
      validateModelRoster(discovered, [
        "mcp__wincu__one",
        "mcp__wincu__one",
        "mcp__wincu__two",
      ]),
    /duplicate/,
  );
  assert.throws(
    () =>
      validateModelRoster(discovered, [
        "mcp__wincu__one",
        "mcp__wincu__two",
        "mcp__wincu__three",
      ]),
    /match/,
  );
});

test("discovery trace rejects a forbidden tool call", async () => {
  const { validateDiscoveryTrace } = await import(
    "./dsh-preflight-evidence.mjs"
  );
  assert.throws(
    () => validateDiscoveryTrace([{ request: "tools/call" }]),
    /No tool call is permitted/,
  );
});

test("preflight retains isolated home when an owned descendant survives shutdown", () => {
  if (process.platform === "win32") return;
  const dir = mkdtempSync(join(tmpdir(), "pi-cu-dsh-linger-"));
  let retained: string | undefined;
  let descendant: number | undefined;
  try {
    const lib = join(dir, "host", "lib");
    mkdirSync(lib, { recursive: true });
    writeFileSync(
      join(dir, "host", "package.json"),
      JSON.stringify({
        name: "@deepseek-ai/dsh",
        version: "fixture",
        type: "module",
      }),
    );
    const host = join(lib, "bin.js");
    const pidFile = join(dir, "pid");
    writeFileSync(
      host,
      `import {spawn} from 'node:child_process'; import {writeFileSync} from 'node:fs'; import {createInterface} from 'node:readline'; const child=spawn(process.execPath,['-e','setTimeout(()=>{},30000)'],{stdio:'ignore'}); child.unref(); writeFileSync(${JSON.stringify(pidFile)},String(child.pid)); for await (const line of createInterface({input:process.stdin})) {const q=JSON.parse(line); if(q.method==='initialize') console.log(JSON.stringify({jsonrpc:'2.0',id:q.id,error:{code:-32603,message:'no adapter registered for provider fixture'}}));else if(q.method==='shutdown'){console.log(JSON.stringify({jsonrpc:'2.0',id:q.id,result:{}}));process.exit(0)}}`,
    );
    const r = spawnSync(process.execPath, [preflight, "--host", host], {
      encoding: "utf8",
      timeout: 20000,
    });
    descendant = Number(readFileSync(pidFile, "utf8"));
    retained = r.stderr.match(/isolated home retained: (.+)/)?.[1];
    assert.notEqual(r.status, 0);
    assert.ok(retained, r.stderr);
    assert.ok(existsSync(retained));
    assert.match(r.stderr, /descendant process exit unconfirmed/);
  } finally {
    if (descendant) {
      try {
        process.kill(descendant, "SIGKILL");
      } catch {}
    }
    if (retained) rmSync(retained, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});
