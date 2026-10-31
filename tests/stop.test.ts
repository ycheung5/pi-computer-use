import assert from "node:assert/strict";
import test from "node:test";
import type {
  ExtensionAPI,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { registerComputerUse } from "../src/extension.js";

const peer = `const input=require('node:readline').createInterface({input:process.stdin}); let count=0;
input.on('line',line=>{const r=JSON.parse(line);if(r.stop){process.stdout.write(JSON.stringify({event:'stopped',operationId:r.stop})+'\\n');return;}if(r.cancel)return;
if(r.action==='list_windows'){count++;if(count===1)return;}
process.stdout.write(JSON.stringify({id:r.id,result:{ok:true,action:r.action,count}})+'\\n');});`;

test("explicit stop interrupts a busy peer, rejects queued calls and blocks retries until a new user operation", async () => {
  const tools = new Map<string, ToolDefinition>();
  const commands = new Map<
    string,
    { handler: (args: string, ctx: unknown) => Promise<unknown> }
  >();
  const events = new Map<string, Array<(event: unknown) => Promise<unknown>>>();
  const api = {
    registerTool(tool: ToolDefinition) {
      tools.set(tool.name, tool);
    },
    registerCommand(
      name: string,
      command: { handler: (args: string, ctx: unknown) => Promise<unknown> },
    ) {
      commands.set(name, command);
    },
    on(name: string, handler: (event: unknown) => Promise<unknown>) {
      const handlers = events.get(name) ?? [];
      handlers.push(handler);
      events.set(name, handlers);
      return () => {};
    },
  } as Pick<ExtensionAPI, "registerTool" | "on" | "registerCommand">;
  registerComputerUse(api, {
    launch: async () => ({ executable: process.execPath, args: ["-e", peer] }),
  });
  const emit = async (name: string, event: unknown = {}) => {
    for (const handler of events.get(name) ?? []) await handler(event);
  };
  const windows = tools.get("windows_computer_use_list_windows");
  assert.ok(windows);
  const stop = commands.get("computer-stop");
  assert.ok(stop, "default Pi exposes an explicit user stop command");
  const call = () =>
    windows.execute(
      "read",
      { maxWindows: 1 },
      undefined,
      undefined,
      {} as Parameters<typeof windows.execute>[4],
    );
  try {
    await emit("before_agent_start", { messageType: "user" });
    const active = call();
    const queued = call();
    const activeRejected = assert.rejects(active, /STOPPED|CANCELLED/);
    const queuedRejected = assert.rejects(queued, /STOPPED|CANCELLED/);
    await new Promise((resolve) => setTimeout(resolve, 100));
    await stop.handler("", {});
    await Promise.all([activeRejected, queuedRejected]);
    await assert.rejects(call(), /STOPPED/);
    await emit("before_agent_start", { messageType: "custom" });
    await assert.rejects(call(), /STOPPED/);
    await emit("before_agent_start", { messageType: "user" });
    const recovered = await call();
    assert.equal(recovered.isError, false);
    assert.equal(
      (recovered.details as { count: number }).count,
      2,
      "queued work was not sent or replayed",
    );
  } finally {
    await emit("session_shutdown");
  }
});

test("Pi abort stops the operation and cannot be cleared by a custom continuation", async () => {
  const tools = new Map<string, ToolDefinition>();
  const events = new Map<string, Array<(event: unknown) => Promise<unknown>>>();
  const api = {
    registerTool(tool: ToolDefinition) {
      tools.set(tool.name, tool);
    },
    on(name: string, handler: (event: unknown) => Promise<unknown>) {
      const handlers = events.get(name) ?? [];
      handlers.push(handler);
      events.set(name, handlers);
      return () => {};
    },
  } as Pick<ExtensionAPI, "registerTool" | "on">;
  registerComputerUse(api, {
    launch: async () => ({ executable: process.execPath, args: ["-e", peer] }),
  });
  const emit = async (name: string, event: unknown = {}) => {
    for (const handler of events.get(name) ?? []) await handler(event);
  };
  const windows = tools.get("windows_computer_use_list_windows");
  assert.ok(windows);
  const controller = new AbortController();
  const call = (signal?: AbortSignal) =>
    windows.execute(
      "read",
      {},
      signal,
      undefined,
      {} as Parameters<typeof windows.execute>[4],
    );
  try {
    const active = call(controller.signal);
    const rejected = assert.rejects(active, /STOPPED|CANCELLED|abort/i);
    await new Promise((resolve) => setTimeout(resolve, 100));
    controller.abort();
    await rejected;
    await emit("before_agent_start", { messageType: "custom" });
    await assert.rejects(call(), /STOPPED/);
    await emit("before_agent_start", { messageType: "user" });
    assert.equal((await call()).isError, false);
  } finally {
    await emit("session_shutdown");
  }
});

test("a cancelled unresponsive peer is retired before replacement work can proceed", async () => {
  const { WorkerClient } = await import("../src/client.js");
  const external = `const input=require('node:readline').createInterface({input:process.stdin});setInterval(()=>{},10000);input.on('line',line=>{const r=JSON.parse(line);if(r.action==='health')process.stdout.write(JSON.stringify({id:r.id,result:{ok:true,action:r.action,processId:process.pid}})+'\\n');});`;
  const worker = new WorkerClient({
    launch: async () => ({
      executable: process.execPath,
      args: ["-e", external],
    }),
    shutdownMs: 50,
  });
  try {
    const old = await worker.execute("health", {});
    const controller = new AbortController();
    const blocked = worker.execute("busy", {}, controller.signal);
    const rejected = assert.rejects(blocked, /abort|CANCELLED/i);
    await new Promise((resolve) => setTimeout(resolve, 30));
    controller.abort();
    await rejected;
    await worker.retire();
    assert.throws(() => process.kill(old.processId as number, 0), /ESRCH/);
    const next = await worker.execute("health", {});
    assert.notEqual(next.processId, old.processId);
  } finally {
    await worker.dispose();
  }
});

test("unconfirmed child exit stays failed and cannot silently release or replace the process", async () => {
  const { WorkerClient } = await import("../src/client.js");
  const external = `process.on('SIGTERM',()=>{});setInterval(()=>{},10000);require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);if(r.action==='health')process.stdout.write(JSON.stringify({id:r.id,result:{ok:true,action:r.action,processId:process.pid}})+'\\n');});`;
  const worker = new WorkerClient({
    launch: async () => ({
      executable: process.execPath,
      args: ["-e", external],
    }),
    shutdownMs: 20,
  });
  const initial = await worker.execute("health", {});
  let replacementPid: number | undefined;
  try {
    await assert.rejects(worker.retire(), /WORKER_RETIRE_FAILED/);
    const replacement = worker.execute("health", {});
    void replacement.then(
      (result) => {
        replacementPid = result.processId as number;
      },
      () => {},
    );
    await assert.rejects(
      replacement,
      /WORKER_RETIRE_FAILED/,
      "failed cleanup must not allow a replacement",
    );
    await assert.rejects(
      worker.retire(),
      /WORKER_RETIRE_FAILED/,
      "repeated retirement must keep tracking the live child",
    );
  } finally {
    process.kill(initial.processId as number, "SIGKILL");
    if (replacementPid) process.kill(replacementPid, "SIGKILL");
    await new Promise((resolve) => setTimeout(resolve, 30));
    await worker.dispose();
  }
});
