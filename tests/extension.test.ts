import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type {
  ExtensionAPI,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { registerComputerUse } from "../src/extension.js";

test("Pi health tool reaches worker and session shutdown rejects subsequent calls", async () => {
  const tools: ToolDefinition[] = [];
  const shutdown: Array<() => Promise<void>> = [];
  const host = {
    registerTool: (tool: ToolDefinition) => {
      tools.push(tool);
    },
    on: (event: string, handler: () => Promise<void>) => {
      if (event === "session_shutdown") shutdown.push(handler);
      return () => {};
    },
  } as Pick<ExtensionAPI, "registerTool" | "on">;
  registerComputerUse(host, {
    launch: async () => ({
      executable: process.execPath,
      args: [
        "--import",
        "tsx",
        fileURLToPath(new URL("../src/worker.ts", import.meta.url)),
      ],
    }),
  });
  const health = tools.find(
    (tool) => tool.name === "windows_computer_use_health",
  );
  assert.ok(health);
  const windows = tools.find(
    (tool) => tool.name === "windows_computer_use_list_windows",
  );
  assert.ok(windows, "Pi exposes the reference window-listing tool");
  const invalid = await windows.execute(
    "invalid-windows",
    { maxWindows: 0 },
    undefined,
    undefined,
    {} as Parameters<typeof windows.execute>[4],
  );
  assert.equal(invalid.isError, true);
  assert.match(JSON.stringify(invalid.details), /INVALID_ARGUMENTS/);
  const context = {} as Parameters<typeof health.execute>[4];
  const result = await health.execute(
    "call-1",
    {},
    undefined,
    undefined,
    context,
  );
  assert.equal(result.isError, false);
  const text = result.content[0];
  assert.equal(text?.type, "text");
  if (text?.type === "text") assert.equal(JSON.parse(text.text).ok, true);
  for (const handler of shutdown) await handler();
  await assert.rejects(
    health.execute("call-2", {}, undefined, undefined, context),
    /disposed/i,
  );
});

test("Pi observation tools expose argument failures through normal execution", async () => {
  const tools: ToolDefinition[] = [];
  const shutdown: Array<() => Promise<void>> = [];
  const host = {
    registerTool: (tool: ToolDefinition) => {
      tools.push(tool);
    },
    on: (event: string, handler: () => Promise<void>) => {
      if (event === "session_shutdown") shutdown.push(handler);
      return () => {};
    },
  } as Pick<ExtensionAPI, "registerTool" | "on">;
  registerComputerUse(host, {
    launch: async () => ({
      executable: process.execPath,
      args: [
        "--import",
        "tsx",
        fileURLToPath(new URL("../src/worker.ts", import.meta.url)),
      ],
    }),
  });
  try {
    for (const action of [
      "snapshot",
      "accessibility_tree",
      "find",
      "element_info",
    ]) {
      const tool = tools.find(
        (item) => item.name === `windows_computer_use_${action}`,
      );
      assert.ok(tool, `${action} is callable from Pi`);
      const result = await tool.execute(
        "bad",
        { viewMode: "unsupported" },
        undefined,
        undefined,
        {} as Parameters<typeof tool.execute>[4],
      );
      assert.equal(result.isError, true);
      assert.match(JSON.stringify(result.details), /INVALID_ARGUMENTS/);
    }
  } finally {
    for (const handler of shutdown) await handler();
  }
});

test("Pi browser navigation is exposed without adding a separate MCP extension", async () => {
  const tools: ToolDefinition[] = [];
  const shutdown: Array<() => Promise<void>> = [];
  const host = {
    registerTool: (tool: ToolDefinition) => {
      tools.push(tool);
    },
    on: (event: string, handler: () => Promise<void>) => {
      if (event === "session_shutdown") shutdown.push(handler);
      return () => {};
    },
  } as Pick<ExtensionAPI, "registerTool" | "on">;
  registerComputerUse(host, {
    launch: async () => ({
      executable: process.execPath,
      args: [
        "--import",
        "tsx",
        fileURLToPath(new URL("../src/worker.ts", import.meta.url)),
      ],
    }),
  });
  try {
    const navigation = tools.find(
      (tool) => tool.name === "windows_computer_use_set_value",
    );
    assert.ok(navigation, "browser navigation uses reference set_value tool");
    const result = await navigation.execute(
      "invalid-browser-url",
      { elementId: "new-tab", value: "javascript:alert(1)" },
      undefined,
      undefined,
      {} as Parameters<typeof navigation.execute>[4],
    );
    assert.equal(result.isError, true);
    assert.match(JSON.stringify(result.details), /INVALID_ARGUMENTS.*URL/);
    const tree = tools.find(
      (tool) => tool.name === "windows_computer_use_accessibility_tree",
    );
    assert.ok(tree);
    assert.ok(
      "browserTab" in
        (tree.parameters as { properties: Record<string, unknown> }).properties,
    );
  } finally {
    for (const handler of shutdown) await handler();
  }
});
