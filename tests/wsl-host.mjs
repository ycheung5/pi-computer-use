// Public tool/worker smoke seam. Run by wsl-health on an interactive Windows host.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { WorkerClient } from "../dist/client.js";
import computerUse from "../dist/extension.js";
import { nativeWorkerLaunch } from "../dist/launcher.js";
import { computerUseHost } from "./native-host.mjs";

const run = promisify(execFile);
const assertExited = async (pid) => {
  const script = `$p=Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if ($p) {exit 1}; exit 0`;
  await run("powershell.exe", [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-EncodedCommand",
    Buffer.from(script, "utf16le").toString("base64"),
  ]);
};
const host = computerUseHost();
computerUse(host.api);
const health = host.tools.get("windows_computer_use_health");
assert.ok(health);
const call = (id, signal) => health.execute(id, {}, signal, undefined, {});
const read = (result) => JSON.parse(result.content[0].text);
const cancelled = new AbortController();
cancelled.abort();
await assert.rejects(call("cancelled", cancelled.signal), {
  name: "AbortError",
});
const first = read(await call("wsl-1"));
const second = read(await call("wsl-2"));
assert.equal(first.ok, true);
assert.equal(first.platform, "win32");
assert.equal(first.processId, second.processId);
if (process.argv.includes("--parent-exit")) {
  console.log(JSON.stringify({ workerPid: first.processId }));
  process.exit(0);
}
for (const handler of host.shutdown) await handler();
await assert.rejects(call("after-shutdown"), /disposed/i);
await assertExited(first.processId);

// A disposable cooperating peer exercises active transport cancellation/timeout,
// without adding test-only actions to the production Windows worker.
const fixture = `const input=require('node:readline').createInterface({input:process.stdin}); let timer; input.on('close',()=>process.exit(0)); input.on('line',line=>{const r=JSON.parse(line);if('cancel' in r){clearTimeout(timer);return;} if(r.action==='health')process.stdout.write(JSON.stringify({id:r.id,result:{ok:true,action:'health',processId:process.pid}})+'\\n');else timer=setTimeout(()=>process.stdout.write(JSON.stringify({id:r.id,result:{ok:true,action:r.action}})+'\\n'),30000);});`;
const worker = new WorkerClient({
  timeoutMs: 2000,
  launch: async (signal) => ({
    ...(await nativeWorkerLaunch(signal)),
    args: ["-e", fixture],
  }),
});
let fixturePid;
try {
  fixturePid = (await worker.execute("health", {})).processId;
  const signal = new AbortController();
  const pending = worker.execute("wait", {}, signal.signal);
  const rejection = assert.rejects(pending, /COMPUTER_USE_CANCELLED/);
  await new Promise((resolve) => setTimeout(resolve, 50));
  signal.abort();
  await rejection;
  assert.equal((await worker.execute("health", {})).processId, fixturePid);
  await assert.rejects(
    worker.execute("wait", {}),
    /WORKER_TIMEOUT.*not replayed/,
  );
} finally {
  await worker.dispose();
}
await assertExited(fixturePid);
console.log(
  JSON.stringify({
    ok: true,
    workerPid: first.processId,
    reuse: true,
    shutdown: true,
    activeCancellation: true,
    timeoutCleanup: true,
  }),
);
