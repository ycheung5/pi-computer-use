import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("DSH discovery observer forwards discovery, blocks tool calls, and stops a stalled child", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-cu-observer-test-"));
  const server = join(dir, "server.mjs");
  const trace = join(dir, "trace");
  const received = join(dir, "received");
  try {
    await writeFile(
      server,
      `import {appendFileSync} from 'node:fs'; import {createInterface} from 'node:readline'; process.on('SIGTERM',()=>{}); createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);appendFileSync(${JSON.stringify(received)},m.method+'\\n');if(m.method==='tools/list') console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{tools:[{name:'windows_computer_use_health'}]}}));}); setInterval(()=>{},1000);`,
    );
    const child = spawn(
      process.execPath,
      ["tests/dsh-mcp-observer.mjs", server, trace],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    let output = "";
    child.stdout.on("data", (part) => {
      output += part;
      if (output.includes("windows_computer_use_health")) {
        child.stdin.write(
          JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call" }) +
            "\n",
        );
        child.stdin.end();
      }
    });
    child.stderr.resume();
    child.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) + "\n",
    );
    const result = await new Promise<number | null>((resolveExit, reject) => {
      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
        reject(Error("observer did not stop"));
      }, 8000);
      child.on("error", reject);
      child.on("close", (code) => {
        clearTimeout(timeout);
        resolveExit(code);
      });
    });
    assert.notEqual(result, 0);
    assert.match(output, /windows_computer_use_health/);
    assert.equal(await readFile(received, "utf8"), "tools/list\n");
    const events = (await readFile(trace, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.ok(
      events.some(
        (event) => event.referenceExit === null && event.signal === "SIGKILL",
      ),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("DSH discovery observer closes open input and stops its child on SIGTERM", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-cu-observer-signal-"));
  const server = join(dir, "server.mjs");
  const trace = join(dir, "trace");
  try {
    await writeFile(
      server,
      `process.on('SIGTERM',()=>{}); console.log(JSON.stringify({jsonrpc:'2.0',method:'ready'})); setInterval(()=>{},1000);`,
    );
    const child = spawn(
      process.execPath,
      ["tests/dsh-mcp-observer.mjs", server, trace],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    child.stderr.resume();
    child.stdout.once("data", () => child.kill("SIGTERM"));
    const result = await new Promise<number | null>((resolveExit, reject) => {
      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
        reject(Error("observer did not stop with input open"));
      }, 8000);
      child.on("error", reject);
      child.on("close", (code) => {
        clearTimeout(timeout);
        resolveExit(code);
      });
    });
    assert.notEqual(result, 0);
    const events = (await readFile(trace, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.ok(
      events.some(
        (event) => event.referenceExit === null && event.signal === "SIGKILL",
      ),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
