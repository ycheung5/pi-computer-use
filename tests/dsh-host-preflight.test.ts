import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
