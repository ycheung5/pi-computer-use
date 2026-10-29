import { compileNative } from "./native.js";
import { executePointer } from "./pointer.js";
import type { WorkerResult } from "./protocol.js";

const target = {
  windowTitle: { type: "string" },
  processId: { type: "integer", minimum: 1 },
  nativeWindowHandle: { type: "integer", minimum: 1 },
  activate: { type: "boolean", default: false },
  browserTab: { type: "string", minLength: 1 },
};
export const textTools = [
  {
    action: "type_text",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        ...target,
        text: { type: "string", minLength: 1, maxLength: 1000000 },
        method: {
          type: "string",
          enum: ["auto", "clipboard", "sendinput", "background"],
          default: "auto",
        },
        focusMode: {
          type: "string",
          enum: ["preserve", "main"],
          default: "preserve",
        },
        restoreClipboard: { type: "boolean", default: true },
      },
      required: ["text"],
    },
  },
  {
    action: "keypress",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        ...target,
        keys: {
          type: "array",
          items: { type: "string", minLength: 1 },
          minItems: 1,
          maxItems: 4,
        },
        dispatch: {
          type: "string",
          enum: ["foreground", "background"],
          default: "foreground",
        },
      },
      required: ["keys"],
    },
  },
];
const modifiers = ["ctrl", "control", "alt", "option", "shift"];
const special = new Set([
  "enter",
  "return",
  "tab",
  "esc",
  "escape",
  "backspace",
  "delete",
  "del",
  "home",
  "end",
  "pageup",
  "pgup",
  "pagedown",
  "pgdn",
  "up",
  "down",
  "left",
  "right",
  "space",
  "insert",
  "ins",
  "pause",
  "capslock",
  "numlock",
  "scrolllock",
  ...Array.from({ length: 24 }, (_, i) => `f${i + 1}`),
]);
export function validateText(
  action: string,
  args: Record<string, unknown>,
): WorkerResult | undefined {
  const error = (message: string): WorkerResult => ({
    ok: false,
    action,
    error: message,
  });
  const bad = (message: string) => error(`INVALID_ARGUMENTS: ${message}`);
  const allowed = new Set([
    ...Object.keys(target),
    ...(action === "type_text"
      ? ["text", "method", "focusMode", "restoreClipboard"]
      : ["keys", "dispatch"]),
  ]);
  for (const key of Object.keys(args))
    if (!allowed.has(key)) return bad(`unknown option ${key}`);
  for (const key of ["processId", "nativeWindowHandle"])
    if (
      args[key] !== undefined &&
      (!Number.isSafeInteger(args[key]) || Number(args[key]) < 1)
    )
      return bad(`${key} must be a positive integer`);
  if (
    args.windowTitle !== undefined &&
    (typeof args.windowTitle !== "string" || !args.windowTitle.trim())
  )
    return bad("windowTitle must be nonempty");
  if (args.activate !== undefined && typeof args.activate !== "boolean")
    return bad("activate must be boolean");
  if (action === "type_text") {
    if (
      typeof args.text !== "string" ||
      !args.text.trim() ||
      args.text.length > 1000000 ||
      args.text.includes("\0")
    )
      return bad(
        "text must be nonempty, without NUL, at most 1000000 UTF-16 units",
      );
    if (
      args.method !== undefined &&
      !["auto", "clipboard", "sendinput", "background"].includes(
        String(args.method),
      )
    )
      return bad("unsupported method");
    if (
      args.focusMode !== undefined &&
      !["preserve", "main"].includes(String(args.focusMode))
    )
      return bad("unsupported focusMode");
    if (
      args.restoreClipboard !== undefined &&
      typeof args.restoreClipboard !== "boolean"
    )
      return bad("restoreClipboard must be boolean");
  } else {
    if (
      !Array.isArray(args.keys) ||
      args.keys.length < 1 ||
      args.keys.length > 4 ||
      args.keys.some((k) => typeof k !== "string" || !k.length)
    )
      return bad("keys requires 1–4 key names");
    let main = 0;
    const seen = new Set<string>();
    for (const raw of args.keys) {
      const key = raw.toLowerCase().trim();
      if (["win", "windows", "cmd", "meta"].includes(key))
        return error("KEY_BLOCKED: Windows key is blocked by design");
      if (modifiers.includes(key)) {
        const canonical =
          key === "control" ? "ctrl" : key === "option" ? "alt" : key;
        if (seen.has(canonical)) return bad("duplicate modifier");
        seen.add(canonical);
      } else {
        main++;
        if (
          !special.has(key) &&
          !(
            raw.length === 1 &&
            raw.charCodeAt(0) >= 32 &&
            raw.charCodeAt(0) !== 127
          )
        )
          return bad("unsupported key");
      }
    }
    if (main !== 1) return bad("exactly one non-modifier key is required");
    if (
      args.dispatch !== undefined &&
      !["foreground", "background"].includes(String(args.dispatch))
    )
      return bad("unsupported dispatch");
    if (
      args.dispatch === "background" &&
      (args.keys.length !== 1 ||
        args.keys[0].length !== 1 ||
        args.keys[0].charCodeAt(0) < 32)
    )
      return error(
        "BACKGROUND_UNAVAILABLE: only one printable character can be posted",
      );
  }
  return undefined;
}
export async function prepareTextInput(
  action: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  if (
    action === "type_text" &&
    ["auto", "clipboard"].includes(String(args.method ?? "auto"))
  )
    return {
      ...args,
      _clipboardExecutable: (await compileNative(["clipboard.cs"], [], signal))
        .executable,
    };
  return args;
}
export async function executeText(
  action: string,
  args: Record<string, unknown>,
  cancelEvent: string,
  operationId: string,
  listenerProcessId?: number,
  signal?: AbortSignal,
): Promise<WorkerResult> {
  return executePointer(
    action,
    args,
    cancelEvent,
    operationId,
    listenerProcessId,
    signal,
  );
}
