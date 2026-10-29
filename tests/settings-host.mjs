// WSL2 + Windows peer, isolated personal-settings file; no input or daily settings.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { registerComputerUse } from "../dist/extension.js";
import {
  nativeWorkerLaunch,
  windowsHostEnvironment,
} from "../dist/launcher.js";
import { computerUseHost } from "./native-host.mjs";

assert.equal(process.platform, "linux", "Run the cross-host fixture from WSL2");
const run = promisify(execFile),
  begin = performance.now();
const environment = await windowsHostEnvironment();
const discoveryMs = Math.round(performance.now() - begin);
const folder = await mkdtemp(
    join(environment.localData, "pi-cu-settings-fixture-"),
  ),
  file = join(folder, "settings.json"),
  previous = process.env.PI_CU_SETTINGS_FILE;
const translate = async (path) =>
  (await run("wslpath", ["-w", path])).stdout.trim();
const windowsFile = await translate(file),
  peer = await translate(
    fileURLToPath(new URL("./settings-peer.mjs", import.meta.url)),
  );
const launch = await nativeWorkerLaunch();
let launches = 0;
process.env.PI_CU_SETTINGS_FILE = file;
const host = computerUseHost(),
  commands = new Map(),
  notices = [];
let active = ["read", "bash"];
const originalRegister = host.api.registerTool;
host.api.registerTool = (tool) => {
  originalRegister(tool);
  active.push(tool.name);
};
host.api.registerCommand = (name, definition) => commands.set(name, definition);
host.api.getActiveTools = () => active;
host.api.setActiveTools = (names) => {
  active = names;
};
registerComputerUse(host.api, {
  launch: async () => {
    launches++;
    return {
      ...launch,
      args: [
        "--input-type=module",
        "-e",
        `import{pathToFileURL}from'node:url';process.env.PI_CU_SETTINGS_FILE=${JSON.stringify(windowsFile)};await import(pathToFileURL(${JSON.stringify(launch.args[0])}).href);`,
      ],
    };
  },
});
const native = async (changes) =>
  JSON.parse(
    (
      await run(
        launch.executable,
        [peer, windowsFile, JSON.stringify(changes ?? null)],
        { timeout: 20000, cwd: environment.localData },
      )
    ).stdout.trim(),
  );
const ctx = {
  abort: () => {},
  ui: { notify: (message) => notices.push(message) },
};
try {
  const saved = await native({
    toolPreset: "lazy",
    indicatorText: "Pi fixture",
    stopShortcut: "Alt+Ctrl+F9",
  });
  assert.equal(saved.ok, true, JSON.stringify(saved));
  assert.equal(saved.settings.stopShortcut, "Ctrl+Alt+F9");
  await host.emit("session_start", {}, ctx);
  assert.equal(launches, 0);
  assert.deepEqual(
    active.sort(),
    ["read", "bash", "windows_computer_use_tools"].sort(),
  );
  const tools = host.tools.get("windows_computer_use_tools");
  const enabled = await tools.execute(
    "enable",
    { operation: "enable", names: ["health"] },
    undefined,
    undefined,
    ctx,
  );
  assert.equal(enabled.isError, false);
  assert.ok(active.includes("windows_computer_use_health"));
  const command = commands.get("computer-settings");
  assert.ok(command);
  await command.handler(
    'set {"toolPreset":"custom","enabledTools":["tools"],"indicatorIdleMs":900}',
    ctx,
  );
  const read = await native();
  assert.equal(read.ok, true);
  assert.equal(read.settings.toolPreset, "custom");
  assert.equal(read.settings.indicatorIdleMs, 900);
  assert.equal(read.settings.indicatorText, "Pi fixture");
  const denied = await host.tools
    .get("windows_computer_use_health")
    .execute("denied", {}, undefined, undefined, ctx);
  assert.equal(denied.isError, true);
  assert.match(String(denied.details.error), /TOOL_DISABLED_IN_SETTINGS/);
  await writeFile(file, "malformed-json");
  await command.handler("show", ctx);
  assert.ok(
    notices.some((message) => message.includes("SETTINGS_READ_FAILED")),
  );
  console.log(
    JSON.stringify({
      ok: true,
      check: "cross-host personal settings",
      nativeWriteWslRead: true,
      wslWriteNativeRead: true,
      workerLazy: true,
      disabledExecution: true,
      unrelatedToolsPreserved: true,
      malformedVisible: true,
      windowsDiscoveryMs: discoveryMs,
      physicalInput: false,
    }),
  );
} finally {
  for (const shutdown of host.shutdown) await shutdown();
  if (previous === undefined) delete process.env.PI_CU_SETTINGS_FILE;
  else process.env.PI_CU_SETTINGS_FILE = previous;
  await rm(folder, { recursive: true, force: true });
}
