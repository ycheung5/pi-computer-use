import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type {
  ExtensionAPI,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { registerComputerUse } from "../src/extension.js";

test("Pi exposes browser actions through the existing computer-use tools", async () => {
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
    const keypress = tools.find(
      (tool) => tool.name === "windows_computer_use_keypress",
    );
    assert.ok(keypress);
    const result = await keypress.execute(
      "invalid-keys",
      { browserTab: "t123", keys: ["ctrl", "a", "b"] },
      undefined,
      undefined,
      {} as Parameters<typeof keypress.execute>[4],
    );
    assert.equal(result.isError, true);
    assert.match(
      JSON.stringify(result.details),
      /INVALID_ARGUMENTS.*one non-modifier/,
    );
    for (const action of [
      "click",
      "double_click",
      "move",
      "scroll",
      "type_text",
      "keypress",
      "focus",
      "invoke",
      "set_value",
      "activate_window",
      "close_window",
      "wait_for",
    ]) {
      assert.equal(
        tools.filter((tool) => tool.name === `windows_computer_use_${action}`)
          .length,
        1,
        `${action} has one registration shared by desktop and browser`,
      );
    }
  } finally {
    for (const handler of shutdown) await handler();
  }
});
