import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { WorkerClient } from "../src/client.js";

test("health reaches a lazy reusable worker and disposal closes it", async () => {
  let launches = 0;
  const worker = new WorkerClient({
    launch: async () => {
      launches++;
      return {
        executable: process.execPath,
        args: [
          "--import",
          "tsx",
          fileURLToPath(new URL("../src/worker.ts", import.meta.url)),
        ],
      };
    },
  });
  assert.equal(launches, 0);
  try {
    const first = await worker.execute("health", {});
    assert.equal(first.ok, true);
    assert.equal(first.action, "health");
    assert.equal(typeof first.processId, "number");
    const second = await worker.execute("health", {});
    assert.equal(second.processId, first.processId);
    assert.equal(launches, 1);
  } finally {
    await worker.dispose();
  }
  await assert.rejects(worker.execute("health", {}), /disposed/i);
});

test("session disposal cancels runtime provisioning without launching a late worker", async () => {
  let receivedSignal: AbortSignal | undefined;
  const worker = new WorkerClient({
    launch: async (signal) => {
      receivedSignal = signal;
      return new Promise(() => {});
    },
  });
  const pending = worker.execute("health", {});
  await new Promise((resolve) => setImmediate(resolve));
  const outcome = assert.rejects(pending, /closed|abort/i);
  await Promise.race([
    worker.dispose(),
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error("disposal hung during provisioning")),
        100,
      ),
    ),
  ]);
  await outcome;
  assert.equal(receivedSignal?.aborted, true);
});

test("failed startup is reported and a later call can launch a replacement", async () => {
  let attempt = 0;
  const worker = new WorkerClient({
    launch: async () => {
      attempt++;
      return attempt === 1
        ? { executable: "/definitely-missing-pi-worker", args: [] }
        : {
            executable: process.execPath,
            args: [
              "--import",
              "tsx",
              fileURLToPath(new URL("../src/worker.ts", import.meta.url)),
            ],
          };
    },
  });
  try {
    await assert.rejects(worker.execute("health", {}), /WORKER_START_FAILED/);
    const result = await worker.execute("health", {});
    assert.equal(result.ok, true);
  } finally {
    await worker.dispose();
  }
});

test("cancellation before startup never launches the worker", async () => {
  let launched = false;
  const worker = new WorkerClient({
    launch: async () => {
      launched = true;
      return { executable: process.execPath, args: [] };
    },
  });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(worker.execute("health", {}, controller.signal), {
    name: "AbortError",
  });
  assert.equal(launched, false);
  await worker.dispose();
});

test("an unresponsive worker times out without replay and later health can recover", async () => {
  const folder = await mkdtemp(join(tmpdir(), "pi-cu-timeout-audit-"));
  const audit = join(folder, "requests.jsonl");
  // The external protocol peer records received requests before becoming stuck.
  // Keep this evidence across replacement processes so replay cannot hide there.
  const peer = `const fs=require('node:fs');
const input=require('node:readline').createInterface({input:process.stdin});
input.on('line',line=>{const r=JSON.parse(line);if(!r.action)return;
fs.appendFileSync(process.argv[1],JSON.stringify({action:r.action,pid:process.pid})+'\\n');
if(r.action==='health')process.stdout.write(JSON.stringify({id:r.id,result:{ok:true,action:r.action,processId:process.pid}})+'\\n');});`;
  const worker = new WorkerClient({
    timeoutMs: 300,
    launch: async () => ({
      executable: process.execPath,
      args: ["-e", peer, audit],
    }),
  });
  try {
    await assert.rejects(
      worker.execute("uncertain-action", {}),
      /WORKER_TIMEOUT.*not replayed/,
    );
    const recovered = await worker.execute("health", {});
    assert.equal(recovered.ok, true);
    const received = (await readFile(audit, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(
      received.map((request) => request.action),
      ["uncertain-action", "health"],
    );
    assert.notEqual(received[0].pid, received[1].pid);
    assert.equal(recovered.processId, received[1].pid);
    assert.throws(() => process.kill(received[0].pid, 0), /ESRCH/);
  } finally {
    await worker.dispose();
    await rm(folder, { recursive: true, force: true });
  }
});

test("abort during provisioning cancels the call and later health can start", async () => {
  let first = true;
  const worker = new WorkerClient({
    launch: async () => {
      if (first) {
        first = false;
        return new Promise(() => {});
      }
      return {
        executable: process.execPath,
        args: [
          "--import",
          "tsx",
          fileURLToPath(new URL("../src/worker.ts", import.meta.url)),
        ],
      };
    },
  });
  const controller = new AbortController();
  const pending = worker.execute("health", {}, controller.signal);
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  try {
    assert.equal((await worker.execute("health", {})).ok, true);
  } finally {
    await worker.dispose();
  }
});
