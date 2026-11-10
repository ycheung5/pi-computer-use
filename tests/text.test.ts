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
      ["keypress", { keys: ["Ctrl", "Shift"] }],
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

test("Pi exposes shared text/pointer declarations and reports key refusal through normal execution", async () => {
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
    for (const action of [
      "type_text",
      "keypress",
      "click",
      "double_click",
      "drag",
    ]) {
      const matches = tools.filter(
        (tool) => tool.name === `windows_computer_use_${action}`,
      );
      assert.equal(matches.length, 1);
      const parameters = JSON.parse(JSON.stringify(matches[0]?.parameters));
      if (["type_text", "keypress"].includes(action))
        assert.ok(parameters.properties.browserTab);
      assert.ok(parameters.properties.nativeWindowHandle);
      if (action === "keypress" || action === "click") {
        assert.equal(parameters.properties.holdMs.minimum, 0);
        assert.equal(
          parameters.properties.timeoutMs.maximum,
          Number.MAX_SAFE_INTEGER,
        );
      } else if (action === "type_text") {
        assert.equal(parameters.properties.holdMs, undefined);
        assert.equal(parameters.properties.inputDelayMs.minimum, 0);
        assert.equal(
          parameters.properties.timeoutMs.maximum,
          Number.MAX_SAFE_INTEGER,
        );
      } else {
        assert.equal(parameters.properties.holdMs, undefined);
        assert.equal(parameters.properties.inputDelayMs, undefined);
        assert.equal(parameters.properties.timeoutMs, undefined);
      }
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

test("standalone generic modifier aliases reach native input validation", async () => {
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
    for (const key of ["Ctrl", "Control", "Alt", "Option", "Shift"]) {
      const result = await worker.execute("keypress", { keys: [key] });
      assert.doesNotMatch(String(result.error), /INVALID_ARGUMENTS/);
      assert.match(String(result.error), /UNSUPPORTED_HOST/);
    }
  } finally {
    await worker.dispose();
  }
});

test("keypress timing validates before input and keeps native foreground semantics", async () => {
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
    for (const timing of [
      { holdMs: 0 },
      { holdMs: 60000 },
      { timeoutMs: 0 },
      { timeoutMs: 1 },
      { holdMs: 2147483648, timeoutMs: 0 },
    ]) {
      const result = await worker.execute("keypress", {
        keys: ["Ctrl"],
        ...timing,
      });
      assert.doesNotMatch(String(result.error), /INVALID_ARGUMENTS/);
      assert.match(String(result.error), /UNSUPPORTED_HOST|WORKER_TIMEOUT/);
    }
    for (const field of ["holdMs", "timeoutMs"])
      for (const value of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, "1", null]) {
        const result = await worker.execute("keypress", {
          keys: ["A"],
          [field]: value,
        });
        assert.match(String(result.error), /INVALID_ARGUMENTS/);
      }
    for (const target of [
      { dispatch: "background" },
      { browserTab: "owned:1" },
    ]) {
      const result = await worker.execute("keypress", {
        keys: ["A"],
        holdMs: 0,
        ...target,
      });
      assert.match(String(result.error), /TIMING_UNSUPPORTED/);
    }
    const overflow = await worker.execute("keypress", {
      keys: ["A"],
      holdMs: Number.MAX_SAFE_INTEGER,
    });
    assert.match(String(overflow.error), /INVALID_ARGUMENTS.*representable/);
  } finally {
    await worker.dispose();
  }
});

test("SendInput pacing accepts safe explicit intervals and refuses incapable routes before input", async () => {
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
    for (const timing of [
      {},
      { inputDelayMs: 0 },
      { inputDelayMs: 25 },
      { inputDelayMs: 2147483648, timeoutMs: 0 },
    ]) {
      const result = await worker.execute("type_text", {
        text: "a\r\n🙂\t",
        method: "sendinput",
        ...timing,
      });
      assert.match(String(result.error), /UNSUPPORTED_HOST/);
    }
    for (const method of [
      undefined,
      "auto",
      "clipboard",
      "background",
      "sendinput",
    ])
      for (const browserTab of method === "sendinput"
        ? ["owned:1"]
        : [undefined]) {
        const result = await worker.execute("type_text", {
          text: "no input",
          ...(method ? { method } : {}),
          ...(browserTab ? { browserTab } : {}),
          inputDelayMs: 0,
          timeoutMs: 0,
        });
        assert.match(String(result.error), /TIMING_UNSUPPORTED/);
      }
    for (const field of ["inputDelayMs", "timeoutMs"])
      for (const value of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, "1", null]) {
        const result = await worker.execute("type_text", {
          text: "x",
          method: "sendinput",
          [field]: value,
        });
        assert.match(String(result.error), /INVALID_ARGUMENTS/);
      }
    for (const args of [
      { text: "xy", inputDelayMs: Number.MAX_SAFE_INTEGER, timeoutMs: 0 },
      { text: "x", inputDelayMs: Number.MAX_SAFE_INTEGER },
    ]) {
      const result = await worker.execute("type_text", {
        method: "sendinput",
        ...args,
      });
      assert.match(String(result.error), /INVALID_ARGUMENTS.*representable/);
    }
  } finally {
    await worker.dispose();
  }
});
