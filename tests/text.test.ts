import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { WorkerClient } from "../src/client.js";

test("text and key tools reject malformed or unsafe input before touching the desktop or clipboard", async () => {
  const worker = new WorkerClient({
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
    for (const [action, args] of [
      ["type_text", {}],
      ["type_text", { text: "" }],
      ["type_text", { text: "hello", method: "shell" }],
      ["type_text", { text: "hello", focusMode: "guess" }],
      ["type_text", { text: "hello", restoreClipboard: 1 }],
      ["keypress", { keys: [] }],
      ["keypress", { keys: ["Ctrl"] }],
      ["keypress", { keys: ["Ctrl", "A", "B"] }],
      ["keypress", { keys: ["Win", "R"] }],
      ["keypress", { keys: ["Escape"], dispatch: "background" }],
    ] as const) {
      const result = await worker.execute(action, args);
      assert.equal(result.ok, false);
      assert.match(
        String(result.error),
        /INVALID_ARGUMENTS|KEY_BLOCKED|BACKGROUND_UNAVAILABLE/,
      );
    }
  } finally {
    await worker.dispose();
  }
});

test("Pi exposes one shared native/browser text declaration and reports key refusal through normal execution", async () => {
  const { registerComputerUse } = await import("../src/extension.js");
  const tools: import("@earendil-works/pi-coding-agent").ToolDefinition[] = [];
  const shutdown: Array<() => Promise<void>> = [];
  const api = {
    registerTool: (
      tool: import("@earendil-works/pi-coding-agent").ToolDefinition,
    ) => {
      tools.push(tool);
    },
    on: (event: string, handler: () => Promise<void>) => {
      if (event === "session_shutdown") shutdown.push(handler);
      return () => {};
    },
  } as Pick<
    import("@earendil-works/pi-coding-agent").ExtensionAPI,
    "registerTool" | "on"
  >;
  registerComputerUse(api, {
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
    for (const action of ["type_text", "keypress"]) {
      const matches = tools.filter(
        (tool) => tool.name === `windows_computer_use_${action}`,
      );
      assert.equal(matches.length, 1);
      const parameters = JSON.parse(JSON.stringify(matches[0]?.parameters));
      assert.ok(parameters.properties.browserTab);
      assert.ok(parameters.properties.nativeWindowHandle);
    }
    const keypress = tools.find(
      (tool) => tool.name === "windows_computer_use_keypress",
    );
    assert.ok(keypress);
    const result = await keypress.execute(
      "blocked",
      { keys: ["Win", "R"] },
      undefined,
      undefined,
      {} as Parameters<typeof keypress.execute>[4],
    );
    assert.equal(result.isError, true);
    assert.match(JSON.stringify(result.details), /KEY_BLOCKED/);
  } finally {
    for (const handler of shutdown) await handler();
  }
});
