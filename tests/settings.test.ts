import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { WorkerClient } from "../src/client.js";

test("personal settings persist and disabled tools cannot bypass execution policy", async () => {
  const folder = await mkdtemp(join(tmpdir(), "pi-cu-settings-")),
    file = join(folder, "settings.json");
  const create = () =>
    new WorkerClient({
      launch: async () => ({
        executable: process.execPath,
        args: [
          "--import",
          "tsx",
          "--input-type=module",
          "-e",
          `process.env.PI_CU_SETTINGS_FILE=${JSON.stringify(file)};await import(${JSON.stringify(fileURLToPath(new URL("../src/worker.ts", import.meta.url)))});`,
        ],
      }),
    });
  const worker = create();
  try {
    const initial = await worker.execute("settings_get", {});
    assert.equal(initial.ok, true);
    assert.equal(
      (initial.settings as { toolPreset: string }).toolPreset,
      "full",
    );
    const changed = await worker.execute("settings_update", {
      changes: { toolPreset: "custom", enabledTools: ["tools"] },
    });
    assert.equal(changed.ok, true);
    const denied = await worker.execute("health", {});
    assert.equal(denied.ok, false);
    assert.match(String(denied.error), /TOOL_DISABLED_IN_SETTINGS/);
    const enable = await worker.execute("tools", {
      operation: "enable",
      names: ["health"],
    });
    assert.equal(enable.ok, false);
    assert.match(String(enable.error), /TOOL_DISABLED_IN_SETTINGS/);
    const reloaded = create();
    try {
      const settings = await reloaded.execute("settings_get", {});
      assert.equal(
        (settings.settings as { toolPreset: string }).toolPreset,
        "custom",
      );
    } finally {
      await reloaded.dispose();
    }
  } finally {
    await worker.dispose();
    await rm(folder, { recursive: true, force: true });
  }
});

test("lazy management changes are atomic and saved errors remain visible", async () => {
  const folder = await mkdtemp(join(tmpdir(), "pi-cu-settings-")),
    file = join(folder, "settings.json");
  const worker = new WorkerClient({
    launch: async () => ({
      executable: process.execPath,
      args: [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        `process.env.PI_CU_SETTINGS_FILE=${JSON.stringify(file)};await import(${JSON.stringify(fileURLToPath(new URL("../src/worker.ts", import.meta.url)))});`,
      ],
    }),
  });
  try {
    assert.equal(
      (
        await worker.execute("settings_update", {
          changes: { toolPreset: "lazy" },
        })
      ).ok,
      true,
    );
    assert.match(
      String((await worker.execute("health", {})).error),
      /TOOL_NOT_LOADED/,
    );
    assert.equal(
      (
        await worker.execute("tools", {
          operation: "enable",
          names: ["windows_computer_use_health"],
        })
      ).ok,
      true,
    );
    assert.equal((await worker.execute("health", {})).ok, true);
    const atomic = await worker.execute("tools", {
      operation: "disable",
      names: ["health", "invented"],
    });
    assert.equal(atomic.ok, false);
    assert.equal(
      (await worker.execute("health", {})).ok,
      true,
      "unknown names must not partially mutate selection",
    );
    assert.equal(
      (await worker.execute("tools", { operation: "reset" })).ok,
      true,
    );
    assert.match(
      String((await worker.execute("health", {})).error),
      /TOOL_NOT_LOADED/,
    );
    for (const changes of [
      { stopShortcut: "Esc" },
      { indicatorIdleMs: 1 },
      { indicatorText: "bad\ntext" },
      { browserApp: "invented" },
      { unknown: true },
    ])
      assert.equal(
        (await worker.execute("settings_update", { changes })).ok,
        false,
      );
    await writeFile(
      file,
      JSON.stringify({
        toolPreset: "old-mode",
        browserVisible: "yes",
        enabledTools: ["health", "removed-tool"],
      }),
    );
    const repaired = await worker.execute("settings_get", {});
    assert.equal(repaired.ok, true);
    assert.ok((repaired.notices as string[]).length >= 3);
    await writeFile(file, "broken JSON");
    const broken = await worker.execute("settings_get", {});
    assert.equal(broken.ok, false);
    assert.match(String(broken.error), /SETTINGS_READ_FAILED/);
    assert.equal("settings" in broken, false);
    const denied = await worker.execute("health", {});
    assert.equal(denied.ok, false);
    assert.match(String(denied.error), /SETTINGS_READ_FAILED/);
  } finally {
    await worker.dispose();
    await rm(folder, { recursive: true, force: true });
  }
});

test("Pi settings command and tool exposure preserve unrelated tools without eagerly starting its worker", async () => {
  const { registerComputerUse } = await import("../src/extension.js");
  const folder = await mkdtemp(join(tmpdir(), "pi-cu-settings-pi-")),
    file = join(folder, "settings.json"),
    previous = process.env.PI_CU_SETTINGS_FILE;
  process.env.PI_CU_SETTINGS_FILE = file;
  await writeFile(file, JSON.stringify({ toolPreset: "lazy" }));
  const tools = new Map<
    string,
    import("@earendil-works/pi-coding-agent").ToolDefinition
  >();
  const commands = new Map<
    string,
    { handler: (args: string, ctx: unknown) => Promise<unknown> }
  >();
  const events = new Map<
    string,
    ((event: unknown, ctx: unknown) => Promise<unknown>)[]
  >();
  let active = ["read", "bash"],
    launches = 0;
  const notices: string[] = [];
  const ctx = {
    ui: { notify: (message: string) => notices.push(message) },
    abort: () => {},
  };
  const api = {
    registerTool: (
      tool: import("@earendil-works/pi-coding-agent").ToolDefinition,
    ) => {
      tools.set(tool.name, tool);
      active.push(tool.name);
    },
    registerCommand: (
      name: string,
      command: { handler: (args: string, ctx: unknown) => Promise<unknown> },
    ) => commands.set(name, command),
    on: (
      event: string,
      handler: (event: unknown, ctx: unknown) => Promise<unknown>,
    ) => {
      events.set(event, [...(events.get(event) ?? []), handler]);
      return () => {};
    },
    getActiveTools: () => active,
    setActiveTools: (names: string[]) => {
      active = names;
    },
  };
  registerComputerUse(api as Parameters<typeof registerComputerUse>[0], {
    launch: async () => {
      launches++;
      return {
        executable: process.execPath,
        args: [
          "--import",
          "tsx",
          "--input-type=module",
          "-e",
          `process.env.PI_CU_SETTINGS_FILE=${JSON.stringify(file)};await import(${JSON.stringify(fileURLToPath(new URL("../src/worker.ts", import.meta.url)))});`,
        ],
      };
    },
  });
  try {
    for (const event of events.get("session_start") ?? []) await event({}, ctx);
    assert.equal(launches, 0);
    assert.deepEqual(
      active.sort(),
      ["read", "bash", "windows_computer_use_tools"].sort(),
    );
    const management = tools.get("windows_computer_use_tools");
    assert.ok(management);
    const enabled = await management.execute(
      "enable",
      { operation: "enable", names: ["health"] },
      undefined,
      undefined,
      ctx as unknown as Parameters<typeof management.execute>[4],
    );
    assert.equal(enabled.isError, false);
    assert.ok(active.includes("windows_computer_use_health"));
    assert.ok(active.includes("read"));
    const command = commands.get("computer-settings");
    assert.ok(command);
    await command.handler('set {"toolPreset":"lite"}', ctx);
    assert.equal(active.includes("windows_computer_use_health"), false);
    await writeFile(file, "broken");
    await command.handler("show", ctx);
    assert.ok(
      notices.some((message) => message.includes("SETTINGS_READ_FAILED")),
    );
  } finally {
    for (const event of events.get("session_shutdown") ?? [])
      await event({}, ctx);
    if (previous === undefined) delete process.env.PI_CU_SETTINGS_FILE;
    else process.env.PI_CU_SETTINGS_FILE = previous;
    await rm(folder, { recursive: true, force: true });
  }
});

test("custom presets can deny management itself and queued saves apply after active calls", async () => {
  const folder = await mkdtemp(join(tmpdir(), "pi-cu-settings-")),
    file = join(folder, "settings.json");
  const worker = new WorkerClient({
    launch: async () => ({
      executable: process.execPath,
      args: [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        `process.env.PI_CU_SETTINGS_FILE=${JSON.stringify(file)};await import(${JSON.stringify(fileURLToPath(new URL("../src/worker.ts", import.meta.url)))});`,
      ],
    }),
  });
  try {
    const waiting = worker.execute("wait", { milliseconds: 120 });
    const saved = worker.execute("settings_update", {
      changes: { toolPreset: "custom", enabledTools: ["health"] },
    });
    assert.equal((await waiting).ok, true);
    assert.equal((await saved).ok, true);
    const denied = await worker.execute("tools", {});
    assert.equal(denied.ok, false);
    assert.match(String(denied.error), /TOOL_DISABLED_IN_SETTINGS/);
    assert.equal((await worker.execute("health", {})).ok, true);
    const reset = await worker.execute("settings_update", {
      changes: { toolPreset: "full" },
    });
    assert.equal(reset.ok, true);
    const described = await worker.execute("tools", {
      operation: "describe",
      names: ["ocr"],
    });
    assert.equal(described.ok, true);
    const definitions = described.tools as {
      parameters: { properties: Record<string, unknown> };
    }[];
    assert.ok(definitions[0]?.parameters.properties.query);
  } finally {
    await worker.dispose();
    await rm(folder, { recursive: true, force: true });
  }
});

test("experimental Firefox settings report automatic headless operation", async () => {
  const folder = await mkdtemp(join(tmpdir(), "pi-cu-firefox-settings-"));
  const file = join(folder, "settings.json");
  const worker = new WorkerClient({
    launch: async () => ({
      executable: process.execPath,
      args: [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        `process.env.PI_CU_SETTINGS_FILE=${JSON.stringify(file)};await import(${JSON.stringify(fileURLToPath(new URL("../src/worker.ts", import.meta.url)))});`,
      ],
    }),
  });
  try {
    const result = await worker.execute("settings_update", {
      changes: { browserApp: "firefox", browserVisible: true },
    });
    assert.equal(result.ok, true);
    assert.equal(
      (result.settings as { browserVisible: boolean }).browserVisible,
      false,
    );
  } finally {
    await worker.dispose();
    await rm(folder, { recursive: true, force: true });
  }
});
