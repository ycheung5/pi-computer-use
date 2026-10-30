import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const moduleUrl = pathToFileURL(resolve("tests/pointer-input-safety.mjs")).href;

test("uncertain pointer dispatch prevents teardown while acknowledged cleanup allows it", () => {
  const script = `
    import { runPointerInput } from ${JSON.stringify(moduleUrl)};
    const results = [];
    for (const fn of [async () => ({ok:true, cleanupConfirmed:true}), async () => ({ok:true}), async () => ({ok:true, cleanupConfirmed:true, buttonCleanupConfirmed:false}), async () => {throw Error('timeout')}]) {
      const state={unconfirmed:false};
      try { await runPointerInput(state,fn); } catch {}
      results.push(state.unconfirmed);
    }
    console.log(JSON.stringify(results));
  `;
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", script],
    { encoding: "utf8", timeout: 2000 },
  );
  assert.equal(result.status, 0, result.stderr || String(result.error));
  assert.deepEqual(JSON.parse(result.stdout), [false, true, true, true]);
});

test("unconfirmed pointer owner stays alive without other handles", async () => {
  const script = `import { retainPointerOwner } from ${JSON.stringify(moduleUrl)}; console.log('ready'); await retainPointerOwner();`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await once(child.stdout, "data");
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(child.exitCode, null);
    assert.equal(child.signalCode, null);
  } finally {
    const closed = once(child, "close");
    child.kill();
    await closed;
  }
});
