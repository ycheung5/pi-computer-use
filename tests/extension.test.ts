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
