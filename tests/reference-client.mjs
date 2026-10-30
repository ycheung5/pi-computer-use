// Test-only transport for the reference's public MCP interface. No action policy.
import { spawn } from "node:child_process";
import { resolve } from "node:path";

export class ReferenceClient {
  constructor(reference, { cwd, env = {}, timeoutMs = 60000 } = {}) {
    if (!reference) throw new Error("Pass the reference checkout path");
    this.pending = new Map();
    this.next = 0;
    this.timeoutMs = timeoutMs;
    this.output = "";
    this.diagnostic = "";
    this.child = spawn(
      process.execPath,
      [resolve(reference, "mcp/server.mjs")],
      {
        cwd,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          WCU_TOOL_MODE: "full",
          WCU_ENABLED_TOOLS: undefined,
          WCU_SETTINGS_JSON: "{}",
          ...env,
        },
      },
    );
    this.closed = new Promise((resolveClosed) =>
      this.child.once("close", resolveClosed),
    );
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => {
      this.output += chunk;
      for (;;) {
        const end = this.output.indexOf("\n");
        if (end < 0) break;
        const line = this.output.slice(0, end);
        this.output = this.output.slice(end + 1);
        if (!line.trim()) continue;
        let message;
        try {
          message = JSON.parse(line);
        } catch (error) {
          this.fail(error);
          this.child.kill();
          return;
        }
        const waiter = this.pending.get(message.id);
        if (!waiter) continue;
        this.pending.delete(message.id);
        clearTimeout(waiter.timer);
        if (message.error) {
          const error = new Error(
            `Reference RPC error: ${JSON.stringify(message.error)}`,
          );
          error.rpcError = message.error;
          waiter.reject(error);
        } else waiter.resolve(message.result);
      }
    });
    this.child.stderr.on("data", (chunk) => {
      this.diagnostic += chunk;
    });
    this.child.stdin.on("error", (error) => this.fail(error));
    this.child.on("error", (error) => this.fail(error));
    this.child.on("close", (code) =>
      this.fail(new Error(`Reference exited ${code}: ${this.diagnostic}`)),
    );
  }
  fail(error) {
    this.failure = error;
    for (const waiter of this.pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.pending.clear();
  }
  request(method, params) {
    if (this.failure) return Promise.reject(this.failure);
    const id = ++this.next;
    return new Promise((resolveRequest, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Reference timeout: ${method}; ${this.diagnostic}`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve: resolveRequest, reject, timer });
      this.child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
      );
    });
  }
  async init() {
    const result = await this.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "pi-reference-comparison", version: "1" },
    });
    this.child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
    );
    return result;
  }
  call(action, args) {
    return this.request("tools/call", {
      name: `windows_computer_use_${action}`,
      arguments: args,
    });
  }
  async close() {
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    this.child.stdin.end();
    const kill = setTimeout(() => this.child.kill(), 3000);
    let deadline;
    try {
      await Promise.race([
        this.closed,
        new Promise((_, reject) => {
          deadline = setTimeout(
            () => reject(new Error("Reference cleanup unconfirmed")),
            6000,
          );
        }),
      ]);
    } finally {
      clearTimeout(kill);
      clearTimeout(deadline);
    }
  }
}

export function referenceResult(response) {
  const text = (response.content ?? [])
    .filter((item) => item.type === "text")
    .map((item) => item.text);
  for (const block of text) {
    try {
      return JSON.parse(block);
    } catch {
      /* Non-JSON MCP error text is evidence too. */
    }
  }
  return { ok: false, error: text.join("\n"), mcpResult: response };
}
