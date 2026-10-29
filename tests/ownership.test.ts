import assert from "node:assert/strict";
import test from "node:test";
import { WorkerClient } from "../src/client.js";

const orderedPeer = `
const input = require('node:readline').createInterface({ input: process.stdin });
let queue = Promise.resolve(); let count = 0;
input.on('line', line => { const request = JSON.parse(line); if (request.cancel) return;
queue = queue.then(async () => { count++; await new Promise(resolve => setTimeout(resolve, request.args.delay || 0));
process.stdout.write(JSON.stringify({ id: request.id, result: {ok:true, action:request.action, count} })+'\\n'); }); });`;

test("owner calls retain order without charging queue time against execution deadlines", async () => {
  const client = new WorkerClient({
    launch: async () => ({
      executable: process.execPath,
      args: ["-e", orderedPeer],
    }),
    timeoutMs: 400,
  });
  try {
    const first = client.execute("first", { delay: 250 });
    const second = client.execute("second", { delay: 250 });
    assert.equal((await first).count, 1);
    assert.equal((await second).count, 2);
  } finally {
    await client.dispose();
  }
});

test("Pi retains an operation through model runs and releases it only at settlement", async () => {
  const { registerComputerUse } = await import("../src/extension.js");
  const tools = new Map<
    string,
    import("@earendil-works/pi-coding-agent").ToolDefinition
  >();
  const events = new Map<string, Array<(event: unknown) => Promise<unknown>>>();
  const peer = `const input = require('node:readline').createInterface({input:process.stdin});
  let ended = 0; input.on('line', line => { const r=JSON.parse(line); if(r.cancel) return;
  if(r.action==='operation_end') ended++;
  process.stdout.write(JSON.stringify({id:r.id,result:{ok:true,action:r.action,operationId:r.operationId,ended}})+'\\n'); });`;
  const api = {
    registerTool(
      tool: import("@earendil-works/pi-coding-agent").ToolDefinition,
    ) {
      tools.set(tool.name, tool);
    },
    on(event: string, handler: (event: unknown) => Promise<unknown>) {
      const handlers = events.get(event) ?? [];
      handlers.push(handler);
      events.set(event, handlers);
      return () => {};
    },
  } as Pick<
    import("@earendil-works/pi-coding-agent").ExtensionAPI,
    "registerTool" | "on"
  >;
  registerComputerUse(api, {
    launch: async () => ({ executable: process.execPath, args: ["-e", peer] }),
  });
  const emit = async (name: string, event: unknown = {}) => {
    for (const handler of events.get(name) ?? []) await handler(event);
  };
  const call = async () => {
    const tool = tools.get("windows_computer_use_list_windows");
    assert.ok(tool);
    return (
      await tool.execute(
        "call",
        {},
        undefined,
        undefined,
        {} as Parameters<typeof tool.execute>[4],
      )
    ).details as Record<string, unknown>;
  };
  try {
    await emit("before_agent_start", { messageType: "user" });
    const first = await call();
    assert.equal(typeof first.operationId, "string");
    await emit("turn_end");
    await emit("agent_end");
    await emit("before_agent_start", { messageType: "custom" });
    const retry = await call();
    assert.equal(retry.operationId, first.operationId);
    assert.equal(retry.ended, 0);
    await emit("agent_settled");
    await emit("before_agent_start", { messageType: "user" });
    const next = await call();
    assert.notEqual(next.operationId, first.operationId);
    assert.equal(next.ended, 1);
  } finally {
    await emit("session_shutdown");
  }
});

test("a cancelled queued call never reaches the worker or delays the next owner call", async () => {
  const client = new WorkerClient({
    launch: async () => ({
      executable: process.execPath,
      args: ["-e", orderedPeer],
    }),
    timeoutMs: 1000,
  });
  try {
    const first = client.execute("first", { delay: 200 });
    const controller = new AbortController();
    const cancelled = client.execute("cancelled", {}, controller.signal);
    controller.abort();
    await assert.rejects(cancelled, { name: "AbortError" });
    const next = client.execute("next", {});
    assert.equal((await first).count, 1);
    assert.equal(
      (await next).count,
      2,
      "cancelled queued work must not be sent",
    );
  } finally {
    await client.dispose();
  }
});
