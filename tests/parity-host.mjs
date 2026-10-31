// Compare public tool declarations without invoking desktop/browser actions.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import computerUse from "../dist/extension.js";
import { computerUseHost } from "./native-host.mjs";

assert.ok(process.argv[2], "Pass the reference checkout path");
const reference = resolve(process.argv[2]);
const child = spawn(process.execPath, [resolve(reference, "mcp/server.mjs")], {
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
  env: {
    ...process.env,
    WCU_TOOL_MODE: "full",
    WCU_ENABLED_TOOLS: JSON.stringify([
      "health",
      "snapshot",
      "accessibility_tree",
      "list_windows",
      "find",
      "element_info",
      "click",
      "double_click",
      "move",
      "drag",
      "scroll",
      "type_text",
      "keypress",
      "focus",
      "invoke",
      "set_value",
      "activate_window",
      "wait",
      "ocr",
      "screenshot",
      "wait_for",
      "close_window",
      "move_window",
      "launch_app",
      "tools",
    ]),
    WCU_SETTINGS_JSON: "{}",
  },
});
let output = "",
  diagnostic = "";
child.stdout.setEncoding("utf8");
child.stderr.on("data", (chunk) => {
  diagnostic += chunk;
});
const pending = new Map();
let id = 0;
child.stdout.on("data", (chunk) => {
  output += chunk;
  for (;;) {
    const end = output.indexOf("\n");
    if (end < 0) return;
    const line = output.slice(0, end);
    output = output.slice(end + 1);
    if (!line.trim()) continue;
    const message = JSON.parse(line),
      waiter = pending.get(message.id);
    if (waiter) {
      pending.delete(message.id);
      clearTimeout(waiter.timer);
      if (message.error)
        waiter.reject(new Error(JSON.stringify(message.error)));
      else waiter.resolve(message.result);
    }
  }
});
const fail = (error) => {
  for (const waiter of pending.values()) {
    clearTimeout(waiter.timer);
    waiter.reject(error);
  }
  pending.clear();
};
child.on("error", fail);
child.on("close", (code) =>
  fail(new Error(`Reference exited ${code}: ${diagnostic}`)),
);
const request = (method, params) =>
  new Promise((resolveRequest, reject) => {
    const current = ++id,
      timer = setTimeout(
        () => reject(new Error(`Reference schema timeout: ${method}`)),
        10000,
      );
    pending.set(current, { resolve: resolveRequest, reject, timer });
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: current, method, params })}\n`,
    );
  });
const host = computerUseHost();
computerUse(host.api);
try {
  await request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "pi-schema-parity", version: "1" },
  });
  const listed = await request("tools/list", {});
  assert.equal(listed.tools.length, 25);
  const missing = [],
    differences = [],
    accepted = [];
  const compare = (expected, actual, path) => {
    if (!actual) {
      missing.push(path);
      return;
    }
    for (const field of [
      "type",
      "default",
      "enum",
      "minimum",
      "maximum",
      "minItems",
      "maxItems",
      "minLength",
      "maxLength",
      "pattern",
      "additionalProperties",
    ]) {
      if (
        expected[field] !== undefined &&
        JSON.stringify(expected[field]) !== JSON.stringify(actual[field])
      )
        differences.push(`${path}.${field}`);
      else if (
        expected[field] === undefined &&
        actual[field] !== undefined &&
        ["minimum", "maximum"].includes(field)
      )
        accepted.push(`${path}.${field}: extra bounded native range`);
    }
    for (const key of expected.required ?? [])
      if (!(actual.required ?? []).includes(key))
        differences.push(`${path}.required:${key}`);
    for (const [key, value] of Object.entries(expected.properties ?? {}))
      compare(value, actual.properties?.[key], `${path}.${key}`);
    if (expected.items) compare(expected.items, actual.items, `${path}[]`);
  };
  for (const tool of listed.tools) {
    const current = host.tools.get(tool.name);
    if (!current) {
      missing.push(tool.name);
      continue;
    }
    compare(tool.inputSchema, current.parameters, tool.name);
  }
  const version = JSON.parse(
    await readFile(resolve(reference, "package.json"), "utf8"),
  ).version;
  console.log(
    JSON.stringify({
      ok: missing.length === 0 && differences.length === 0,
      referenceVersion: version,
      tools: 25,
      missing,
      differences,
      additionalBounds: accepted,
      scope:
        "Public declarations only; does not establish application/runtime behavior",
    }),
  );
  assert.deepEqual(
    missing,
    [],
    "All reference tools and supported parameters must exist",
  );
  assert.deepEqual(
    differences,
    [],
    "Reference argument types/defaults/bounds/restrictions must remain compatible",
  );
} finally {
  for (const handler of host.shutdown) await handler();
  child.stdin.end();
  const timer = setTimeout(() => child.kill(), 1000);
  timer.unref();
}
