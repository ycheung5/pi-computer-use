import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const client = pathToFileURL(resolve("tests/reference-client.mjs")).href;

test("a malformed reference response does not terminate an uncertain input owner", () => {
  const script = `
    import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
    import { tmpdir } from 'node:os';
    import { join } from 'node:path';
    import { ReferenceClient } from ${JSON.stringify(client)};
    const folder = await mkdtemp(join(tmpdir(), 'pi-cu-ref-malformed-'));
    await mkdir(join(folder, 'mcp'));
    await writeFile(join(folder, 'mcp/server.mjs'), \`
      import { createInterface } from 'node:readline';
      createInterface({input:process.stdin}).on('line', (line) => {
        const message = JSON.parse(line);
        if (message.method === 'initialize') console.log(JSON.stringify({jsonrpc:'2.0',id:message.id,result:{serverInfo:{name:'fixture'}}}));
        if (message.method === 'tools/call') console.log('{malformed');
      });
    \`);
    const owner = new ReferenceClient(folder, { timeoutMs: 2000 });
    try {
      await owner.init();
      let rejected = false;
      try { await owner.call('type_text', {}); } catch { rejected = true; }
      await new Promise((r) => setTimeout(r, 100));
      console.log(JSON.stringify({rejected, ownerAlive:owner.child.exitCode === null && owner.child.signalCode === null}));
    } finally { await owner.close(); await rm(folder,{recursive:true,force:true}); }
  `;
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", script],
    {
      encoding: "utf8",
      timeout: 5000,
    },
  );
  assert.equal(result.status, 0, result.stderr || String(result.error));
  assert.deepEqual(JSON.parse(result.stdout), {
    rejected: true,
    ownerAlive: true,
  });
});
