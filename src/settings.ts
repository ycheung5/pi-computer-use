import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { release } from "node:os";
import { dirname, join } from "node:path";
import { windowsHostEnvironment } from "./launcher.js";
import type { WorkerResult } from "./protocol.js";

export const TOOL_PREFIX = "windows_computer_use_";
export const TOOL_NAMES = [
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
];
const LITE = [
  "list_windows",
  "find",
  "click",
  "scroll",
  "type_text",
  "keypress",
  "ocr",
  "screenshot",
  "wait_for",
  "launch_app",
  "tools",
];
export const DEFAULT_SETTINGS = {
  browserFirst: true,
  browserVisible: true,
  browserApp: "default",
  browserSignIn: false,
  mode: "full",
  toolPreset: "full",
  enabledTools: TOOL_NAMES,
  indicatorEnabled: true,
  cursorIndicatorEnabled: true,
  remoteIndicatorVisible: true,
  indicatorText: "Pi is controlling the computer",
  indicatorPosition: "top",
  indicatorIdleMs: 800,
  stopShortcut: "",
  resumeToken: 0,
  previewToken: 0,
};
export type PersonalSettings = typeof DEFAULT_SETTINGS;
const choices: Record<string, string[]> = {
  browserApp: ["default", "edge", "chrome", "firefox"],
  mode: ["full", "lite"],
  toolPreset: ["auto", "full", "lite", "lazy", "custom"],
  indicatorPosition: ["top", "bottom"],
};
const switches = [
  "browserFirst",
  "browserVisible",
  "browserSignIn",
  "indicatorEnabled",
  "cursorIndicatorEnabled",
  "remoteIndicatorVisible",
];
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
function validate(
  input: unknown,
  repair: boolean,
): { settings: PersonalSettings; notices: string[] } {
  if (!object(input))
    throw new Error("SETTINGS_INVALID: settings must be an object");
  const settings: Record<string, unknown> = {
      ...DEFAULT_SETTINGS,
      enabledTools: [...TOOL_NAMES],
    },
    notices: string[] = [];
  const invalid = (key: string) => {
    throw new Error(`SETTINGS_INVALID: invalid ${key}`);
  };
  for (const [key, value] of Object.entries(input)) {
    if (!(key in DEFAULT_SETTINGS)) {
      if (repair) {
        notices.push(`Ignored unknown saved setting: ${key}`);
        continue;
      }
      invalid(key);
    }
    if (choices[key]) {
      if (!choices[key]?.includes(String(value)) || typeof value !== "string") {
        if (repair) {
          notices.push(`Reset unsupported saved ${key} to default`);
          continue;
        }
        invalid(key);
      }
    } else if (switches.includes(key)) {
      if (typeof value !== "boolean") {
        if (repair) {
          notices.push(`Reset invalid saved ${key} to default`);
          continue;
        }
        invalid(key);
      }
    } else if (key === "enabledTools") {
      if (!Array.isArray(value)) {
        if (repair) {
          notices.push("Reset invalid saved enabledTools to default");
          continue;
        }
        invalid(key);
      }
      const names = value as unknown[];
      if (
        names.length > 25 ||
        names.some(
          (name) => typeof name !== "string" || !TOOL_NAMES.includes(name),
        )
      ) {
        if (!repair) invalid(key);
        const known = TOOL_NAMES.filter((name) => names.includes(name));
        settings.enabledTools = known.length ? known : [...TOOL_NAMES];
        notices.push(
          "Dropped unknown saved tools or restored the default selection",
        );
        continue;
      }
      settings.enabledTools = TOOL_NAMES.filter((name) => names.includes(name));
      continue;
    } else if (key === "indicatorText") {
      if (
        typeof value !== "string" ||
        !value.trim() ||
        value.trim().length > 120 ||
        [...value].some(
          (character) =>
            character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
        )
      )
        invalid(key);
      settings[key] = (value as string).trim();
      continue;
    } else if (key === "stopShortcut") {
      if (typeof value !== "string") invalid(key);
      if (value !== "") {
        const parts = (value as string).split("+"),
          keyName = parts.pop() ?? "",
          mods = ["Ctrl", "Alt", "Shift", "Win"];
        if (
          parts.some((part) => !mods.includes(part)) ||
          new Set(parts).size !== parts.length ||
          !/^(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Space|Enter|Tab|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Up|Down|Left|Right|Pause|CapsLock|NumLock|ScrollLock)$/u.test(
            keyName,
          )
        )
          invalid(key);
        settings[key] = [
          ...mods.filter((part) => parts.includes(part)),
          keyName,
        ].join("+");
        continue;
      }
    } else if (key === "indicatorIdleMs") {
      if (
        !Number.isSafeInteger(value) ||
        Number(value) < 200 ||
        Number(value) > 3000
      )
        invalid(key);
    } else if (key === "resumeToken" || key === "previewToken") {
      if (!Number.isSafeInteger(value) || Number(value) < 0) invalid(key);
    }
    settings[key] = value;
  }
  if (settings.browserApp === "firefox" && settings.browserVisible) {
    settings.browserVisible = false;
    notices.push("Experimental Firefox automatic launches are headless");
  }
  if (settings.toolPreset === "auto")
    settings.toolPreset =
      (settings.enabledTools as string[]).length === TOOL_NAMES.length
        ? "full"
        : "custom";
  return { settings: settings as PersonalSettings, notices };
}

export async function personalSettingsPath(
  host = false,
): Promise<string | undefined> {
  if (process.env.PI_CU_SETTINGS_FILE) return process.env.PI_CU_SETTINGS_FILE;
  if (process.platform === "win32") {
    if (!process.env.LOCALAPPDATA)
      throw new Error("SETTINGS_PATH_FAILED: Windows LOCALAPPDATA is missing");
    return join(process.env.LOCALAPPDATA, "pi-computer-use", "settings.json");
  }
  if (
    host &&
    process.platform === "linux" &&
    /microsoft.*wsl2/i.test(release())
  ) {
    const { localData } = await windowsHostEnvironment();
    return join(localData, "pi-computer-use", "settings.json");
  }
  return undefined;
}
export async function readPersonalSettings(host = false) {
  const path = await personalSettingsPath(host);
  if (!path)
    return {
      ...validate({}, false),
      path: undefined,
      exists: false,
      source: "unsupported-host-defaults",
    };
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    return {
      ...validate(parsed, true),
      path,
      exists: true,
      source: "personal-file",
    };
  } catch (error) {
    if (object(error) && error.code === "ENOENT")
      return {
        ...validate({}, false),
        path,
        exists: false,
        source: "new-personal-defaults",
      };
    throw new Error(
      `SETTINGS_READ_FAILED: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function updatePersonalSettings(changes: unknown) {
  const path = await personalSettingsPath();
  if (!path)
    throw new Error(
      "SETTINGS_PATH_FAILED: settings require a Windows data directory or explicit test file",
    );
  if (!object(changes))
    throw new Error("SETTINGS_INVALID: changes must be an object");
  await mkdir(dirname(path), { recursive: true });
  const lock = `${path}.lock`;
  let locked = false;
  try {
    try {
      await mkdir(lock);
      locked = true;
    } catch (error) {
      if (!object(error) || error.code !== "EEXIST") throw error;
      let stale = false;
      try {
        const owner = JSON.parse(
          await readFile(join(lock, "owner.json"), "utf8"),
        ) as { pid: number };
        if (!Number.isSafeInteger(owner.pid) || owner.pid < 1)
          throw new Error("invalid lock owner");
        try {
          process.kill(owner.pid, 0);
        } catch (cause) {
          if (object(cause) && cause.code === "ESRCH") stale = true;
        }
      } catch {
        stale = Date.now() - (await stat(lock)).mtimeMs > 30000;
      }
      if (!stale)
        throw new Error(
          "SETTINGS_BUSY: another process is saving personal settings",
        );
      await rm(lock, { recursive: true, force: true });
      await mkdir(lock);
      locked = true;
    }
    await writeFile(
      join(lock, "owner.json"),
      JSON.stringify({ pid: process.pid }),
      { flag: "wx" },
    );
    const current = await readPersonalSettings();
    const validated = validate({ ...current.settings, ...changes }, false);
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(
        temporary,
        `${JSON.stringify(validated.settings, null, 2)}\n`,
        { flag: "wx" },
      );
      await rename(temporary, path);
    } finally {
      await rm(temporary, { force: true });
    }
    return readPersonalSettings();
  } finally {
    if (locked) await rm(lock, { recursive: true, force: true });
  }
}

export function allowedToolNames(settings: PersonalSettings): string[] {
  return settings.toolPreset === "full" || settings.toolPreset === "lazy"
    ? [...TOOL_NAMES]
    : settings.toolPreset === "lite"
      ? [...LITE]
      : [...new Set(settings.enabledTools)];
}
export const managementParameters = {
  type: "object",
  additionalProperties: false,
  properties: {
    operation: {
      type: "string",
      enum: ["list", "describe", "enable", "disable", "reset"],
      default: "list",
    },
    names: { type: "array", items: { type: "string" }, maxItems: 25 },
  },
};

export class PersonalSettingsManager {
  currentSettings: PersonalSettings | undefined;
  currentFileExists = false;
  currentNotices: string[] = [];
  currentSource = "not-read";
  private selection = "";
  private enabled = new Set<string>();
  private allowed = new Set<string>();
  constructor(
    private readonly available: Map<
      string,
      { description: string; parameters?: unknown }
    >,
  ) {
    this.available.set("tools", {
      description:
        "Inspect or change the loaded tools allowed by personal settings",
      parameters: managementParameters,
    });
  }
  async synchronize() {
    const current = await readPersonalSettings();
    this.currentSettings = current.settings;
    this.currentFileExists = current.exists;
    this.currentNotices = current.notices;
    this.currentSource = current.source;
    const key = JSON.stringify({
      preset: current.settings.toolPreset,
      tools: allowedToolNames(current.settings),
    });
    if (key !== this.selection) {
      this.selection = key;
      this.allowed = new Set(allowedToolNames(current.settings));
      this.enabled = new Set(
        (current.settings.toolPreset === "lazy"
          ? ["tools"]
          : [...this.allowed]
        ).filter((name) => this.available.has(name)),
      );
    }
    return current;
  }
  async authorize(action: string): Promise<string | undefined> {
    await this.synchronize();
    if (action === "prepare_input") return undefined;
    if (!TOOL_NAMES.includes(action)) return "UNKNOWN_ACTION";
    if (!this.allowed.has(action))
      return "TOOL_DISABLED_IN_SETTINGS: this tool is disabled by the user's personal selection";
    if (!this.available.has(action))
      return "TOOL_UNAVAILABLE: this capability is not implemented in this build";
    if (!this.enabled.has(action))
      return "TOOL_NOT_LOADED: enable an allowed tool through windows_computer_use_tools";
    return undefined;
  }
  private toolList() {
    return TOOL_NAMES.map((name) => ({
      name: `${TOOL_PREFIX}${name}`,
      shortName: name,
      available: this.available.has(name),
      allowed: this.allowed.has(name),
      enabled: this.enabled.has(name),
      ...this.available.get(name),
    }));
  }
  async handle(
    action: string,
    args: Record<string, unknown>,
  ): Promise<WorkerResult> {
    try {
      const current = await this.synchronize();
      if (action === "settings_get") {
        if (Object.keys(args).length)
          throw new Error("INVALID_ARGUMENTS: settings_get takes no options");
        return { ok: true, action, ...current, tools: this.toolList() };
      }
      if (action === "settings_update") {
        if (Object.keys(args).some((key) => key !== "changes"))
          throw new Error(
            "INVALID_ARGUMENTS: settings_update accepts changes only",
          );
        const updated = await updatePersonalSettings(args.changes);
        this.selection = "";
        await this.synchronize();
        return { ok: true, action, ...updated, tools: this.toolList() };
      }
      if (!this.allowed.has("tools"))
        throw new Error(
          "TOOL_DISABLED_IN_SETTINGS: management is disabled in personal settings",
        );
      if (!this.enabled.has("tools"))
        throw new Error(
          "TOOL_NOT_LOADED: management is unloaded; restore the preset through /computer-settings",
        );
      if (
        Object.keys(args).some((key) => key !== "operation" && key !== "names")
      )
        throw new Error("INVALID_ARGUMENTS: unknown management option");
      const operation = args.operation ?? "list";
      if (
        !["list", "describe", "enable", "disable", "reset"].includes(
          String(operation),
        ) ||
        typeof operation !== "string"
      )
        throw new Error("INVALID_ARGUMENTS: unknown management operation");
      if (
        args.names !== undefined &&
        (!Array.isArray(args.names) ||
          args.names.length > 25 ||
          args.names.some((name) => typeof name !== "string"))
      )
        throw new Error("INVALID_ARGUMENTS: names must be at most 25 strings");
      const names = ((args.names ?? []) as string[]).map((name) =>
        name.startsWith(TOOL_PREFIX) ? name.slice(TOOL_PREFIX.length) : name,
      );
      if (
        names.includes("*") &&
        (names.length !== 1 || !["enable", "disable"].includes(operation))
      )
        throw new Error(
          "INVALID_ARGUMENTS: wildcard only supports enable/disable alone",
        );
      if (operation === "describe" && names.length !== 1)
        throw new Error("INVALID_ARGUMENTS: describe requires one name");
      if (operation === "reset" && names.length)
        throw new Error("INVALID_ARGUMENTS: reset takes no names");
      if (["enable", "disable"].includes(operation) && !names.length)
        throw new Error("INVALID_ARGUMENTS: enable/disable requires names");
      for (const name of names)
        if (name !== "*" && !TOOL_NAMES.includes(name))
          throw new Error(`UNKNOWN_TOOL: ${name}`);
      const selected =
        names[0] === "*"
          ? [...this.allowed].filter((name) => this.available.has(name))
          : names;
      if (operation === "enable")
        for (const name of selected) {
          if (!this.allowed.has(name))
            throw new Error(`TOOL_DISABLED_IN_SETTINGS: ${name}`);
          if (!this.available.has(name))
            throw new Error(`TOOL_UNAVAILABLE: ${name}`);
        }
      if (operation === "enable")
        for (const name of selected) this.enabled.add(name);
      if (operation === "disable")
        for (const name of selected) this.enabled.delete(name);
      if (operation === "reset") {
        this.selection = "";
        await this.synchronize();
      }
      const tools = this.toolList();
      return {
        ok: true,
        action: "tools",
        operation,
        preset: current.settings.toolPreset,
        notices: current.notices,
        tools:
          operation === "describe"
            ? tools.filter((tool) => tool.shortName === names[0])
            : tools,
      };
    } catch (error) {
      return {
        ok: false,
        action,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
