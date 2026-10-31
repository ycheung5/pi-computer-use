import { win32 } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { retireDesktop } from "./desktop.js";
import { nativeDesktop } from "./native.js";
import type { WorkerResult } from "./protocol.js";

type Rule = {
  type: "string" | "integer" | "boolean";
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  default?: unknown;
};
const target: Record<string, Rule> = {
  windowRef: { type: "string", minLength: 1 },
  windowTitle: { type: "string" },
  processId: { type: "integer", minimum: 1 },
  nativeWindowHandle: { type: "integer", minimum: 1 },
  activate: { type: "boolean", default: false },
};
const definitions: Record<
  string,
  { properties: Record<string, Rule>; required?: string[] }
> = {
  launch_app: {
    properties: {
      target: { type: "string", minLength: 1, maxLength: 32767 },
      arguments: { type: "string", maxLength: 32767, default: "" },
      workingDirectory: { type: "string", maxLength: 32767, default: "" },
      activate: { type: "boolean", default: false },
      waitMs: { type: "integer", minimum: 0, maximum: 10000, default: 1500 },
    },
    required: ["target"],
  },
  activate_window: { properties: { ...target } },
  move_window: {
    properties: {
      ...target,
      x: { type: "integer", minimum: -2147483648, maximum: 2147483647 },
      y: { type: "integer", minimum: -2147483648, maximum: 2147483647 },
    },
    required: ["x", "y"],
  },
  close_window: { properties: { ...target } },
};
export const windowTools = Object.entries(definitions).map(
  ([action, definition]) => ({
    action,
    parameters: {
      type: "object",
      additionalProperties: false,
      ...definition,
      ...(["activate_window", "close_window"].includes(action)
        ? {
            properties: {
              ...definition.properties,
              browserTab: { type: "string", minLength: 1 },
            },
          }
        : {}),
    },
  }),
);
const hosts = new Set([
  "cmd",
  "powershell",
  "pwsh",
  "wt",
  "wsl",
  "bash",
  "conhost",
  "wscript",
  "cscript",
  "mshta",
  "rundll32",
  "regsvr32",
  "msiexec",
  "forfiles",
  "schtasks",
]);
const controls = (value: string) =>
  [...value].some((character) => character.charCodeAt(0) < 32);

export async function manageWindow(
  action: string,
  input: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<WorkerResult> {
  const definition = definitions[action];
  const invalid = (message: string): WorkerResult => ({
    ok: false,
    action,
    error: `INVALID_ARGUMENTS: ${message}`,
  });
  if (!definition) return invalid("unknown window action");
  const args: Record<string, unknown> = {};
  for (const key of Object.keys(input))
    if (!(key in definition.properties))
      return invalid(`unknown option ${key}`);
  for (const [key, rule] of Object.entries(definition.properties)) {
    const value = Object.hasOwn(input, key) ? input[key] : rule.default;
    if (value === undefined) {
      if (definition.required?.includes(key))
        return invalid(`${key} is required`);
      continue;
    }
    if (
      rule.type === "integer"
        ? !Number.isSafeInteger(value)
        : typeof value !== rule.type
    )
      return invalid(`invalid ${key}`);
    if (
      typeof value === "number" &&
      ((rule.minimum !== undefined && value < rule.minimum) ||
        (rule.maximum !== undefined && value > rule.maximum))
    )
      return invalid(`${key} outside bounds`);
    if (typeof value === "string") {
      const length = [...value].length;
      if (
        (rule.minLength !== undefined && length < rule.minLength) ||
        (rule.maxLength !== undefined && length > rule.maxLength)
      )
        return invalid(`${key} outside bounds`);
    }
    if (
      typeof value === "string" &&
      ["target", "windowTitle", "windowRef"].includes(key) &&
      !value.trim()
    )
      return invalid(`${key} cannot be empty`);
    args[key] = value;
  }
  if (
    action !== "launch_app" &&
    args.windowRef === undefined &&
    args.windowTitle === undefined &&
    args.processId === undefined &&
    args.nativeWindowHandle === undefined
  )
    return invalid("provide an explicit window target");
  if (action === "launch_app") {
    if (
      controls(String(args.target)) ||
      controls(String(args.workingDirectory)) ||
      /[\r\n]/u.test(String(args.arguments)) ||
      String(args.arguments).includes(String.fromCharCode(0))
    )
      return invalid(
        "launch values must be single-line strings without control characters",
      );
    const name = win32
      .basename(String(args.target).trim())
      .replace(/\.(?:exe|com)$/iu, "")
      .toLowerCase();
    if (hosts.has(name) && String(args.arguments).trim())
      return {
        ok: false,
        action,
        error: `LAUNCH_COMMAND_REFUSED: ${name} accepts no arguments through launch_app; use Pi's shell tool for commands`,
      };
  }
  signal?.throwIfAborted();
  try {
    const before =
      action === "launch_app"
        ? await nativeDesktop.execute(
            "list_windows",
            { maxWindows: 1000, includeInvisible: false },
            signal,
          )
        : undefined;
    const result = await nativeDesktop.execute(action, args, signal);
    signal?.throwIfAborted();
    if (!result.ok && String(result.error).includes("LAUNCH_PENDING_TIMEOUT"))
      await retireDesktop();
    if (action === "launch_app" && result.ok) {
      if (Number(args.waitMs) > 0)
        await delay(Number(args.waitMs), undefined, { signal });
      const after = await nativeDesktop.execute(
        "list_windows",
        { maxWindows: 1000, includeInvisible: false },
        signal,
      );
      const prior = new Set(
        Array.isArray(before?.windows)
          ? before.windows.map(
              (window: Record<string, unknown>) => window.nativeWindowHandle,
            )
          : [],
      );
      result.observedNewWindows =
        after.ok && Array.isArray(after.windows)
          ? after.windows.filter(
              (window: Record<string, unknown>) =>
                !prior.has(window.nativeWindowHandle),
            )
          : [];
      if (!before?.ok || !after.ok || before.truncated || after.truncated)
        result.observationWarning =
          "Window enumeration was incomplete; new-window observations are not exhaustive.";
    }
    return result;
  } catch (error) {
    if (signal?.aborted) throw error;
    return {
      ok: false,
      action,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
