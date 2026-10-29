import { confirmInputCleanup, nativeDesktop, retainInput } from "./native.js";
import type { WorkerResult } from "./protocol.js";

const integer = { type: "integer" };
const target = {
  windowTitle: { type: "string" },
  processId: { ...integer, minimum: 1 },
  nativeWindowHandle: { ...integer, minimum: 1 },
  activate: { type: "boolean", default: false },
};
const point = {
  type: "object",
  additionalProperties: false,
  properties: { x: integer, y: integer },
  required: ["x", "y"],
};
export const pointerTools = ["click", "double_click", "move", "drag"].map(
  (action) => ({
    action,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        ...target,
        ...(action === "drag"
          ? {
              path: {
                type: "array",
                items: point,
                minItems: 2,
                maxItems: 1000,
              },
            }
          : {
              elementId: { type: "string", minLength: 1 },
              x: integer,
              y: integer,
              viewMode: {
                type: "string",
                enum: ["control", "content", "raw"],
                default: "control",
              },
              includeOffscreen: { type: "boolean", default: false },
            }),
        ...(action !== "move"
          ? {
              button: {
                type: "string",
                enum: ["left", "right", "middle"],
                default: "left",
              },
            }
          : {}),
        ...(["click", "double_click"].includes(action)
          ? {
              dispatch: {
                type: "string",
                enum: ["auto", "background", "foreground"],
                default: "auto",
              },
            }
          : {}),
      },
      ...(action === "drag" ? { required: ["path"] } : {}),
    },
  }),
);

export function validatePointer(
  action: string,
  args: Record<string, unknown>,
): WorkerResult | undefined {
  const bad = (message: string): WorkerResult => ({
    ok: false,
    action,
    error: `INVALID_ARGUMENTS: ${message}`,
  });
  const keys = new Set([
    "windowTitle",
    "processId",
    "nativeWindowHandle",
    "activate",
    ...(action === "drag"
      ? ["path", "button"]
      : [
          "elementId",
          "x",
          "y",
          "viewMode",
          "includeOffscreen",
          ...(action === "move" ? [] : ["button", "dispatch"]),
        ]),
    ...(action === "scroll" ? ["deltaX", "deltaY", "browserTab"] : []),
  ]);
  for (const key of Object.keys(args))
    if (!keys.has(key)) return bad(`unknown option ${key}`);
  for (const key of ["processId", "nativeWindowHandle"])
    if (
      args[key] !== undefined &&
      (!Number.isSafeInteger(args[key]) || Number(args[key]) < 1)
    )
      return bad(`${key} must be a positive integer`);
  for (const key of ["x", "y", "deltaX", "deltaY"])
    if (
      args[key] !== undefined &&
      (!Number.isSafeInteger(args[key]) ||
        Math.abs(Number(args[key])) > 2147483647)
    )
      return bad(`${key} must be a 32-bit integer`);
  for (const key of ["activate", "includeOffscreen"])
    if (args[key] !== undefined && typeof args[key] !== "boolean")
      return bad(`${key} must be boolean`);
  if (args.windowTitle !== undefined && typeof args.windowTitle !== "string")
    return bad("windowTitle must be a string");
  if (
    args.viewMode !== undefined &&
    !["control", "content", "raw"].includes(String(args.viewMode))
  )
    return bad("unsupported viewMode");
  if (
    args.button !== undefined &&
    !["left", "right", "middle"].includes(String(args.button))
  )
    return bad("unsupported button");
  if (
    args.dispatch !== undefined &&
    !["auto", "background", "foreground"].includes(String(args.dispatch))
  )
    return bad("unsupported dispatch");
  if (action === "drag") {
    if (
      !Array.isArray(args.path) ||
      args.path.length < 2 ||
      args.path.length > 1000
    )
      return bad("path needs 2–1000 screen points");
    for (const p of args.path)
      if (
        !p ||
        typeof p !== "object" ||
        Object.keys(p).some((k) => k !== "x" && k !== "y") ||
        !Number.isInteger(p.x) ||
        !Number.isInteger(p.y) ||
        Math.abs(p.x) > 2147483647 ||
        Math.abs(p.y) > 2147483647
      )
        return bad("path requires integer x/y screen points");
  } else {
    if (
      args.elementId !== undefined &&
      (typeof args.elementId !== "string" || !args.elementId.length)
    )
      return bad("elementId must be nonempty");
    if (!args.elementId && (args.x === undefined || args.y === undefined))
      return bad("provide elementId or both x and y");
    if ((args.x === undefined) !== (args.y === undefined))
      return bad("provide both x and y");
  }
  return undefined;
}

// A missing native acknowledgment keeps the lease held. Never kill a bridge that
// could still have a button down, including after a timeout/transport failure.
let cleanup: Promise<void> | undefined;
let cleanupFailure: unknown;
export async function awaitPointerCleanup(): Promise<void> {
  await cleanup;
  if (cleanupFailure) throw cleanupFailure;
}
export async function executePointer(
  action: string,
  args: Record<string, unknown>,
  cancelEvent: string,
  operationId: string,
  listenerProcessId?: number,
  signal?: AbortSignal,
): Promise<WorkerResult> {
  await awaitPointerCleanup();
  if (!cancelEvent)
    return nativeDesktop.execute(
      action,
      { ...args, _cancelEvent: "" },
      signal,
      operationId,
    );
  retainInput();
  const execution = nativeDesktop.execute(
    action,
    { ...args, _cancelEvent: cancelEvent, _stopProcessId: listenerProcessId },
    undefined,
    operationId,
  );
  cleanup = execution
    .then((result) => {
      if (result.cleanupConfirmed !== true)
        throw new Error("INPUT_CLEANUP_UNCONFIRMED: retain desktop ownership");
      confirmInputCleanup();
    })
    .catch((error) => {
      cleanupFailure = error;
      throw error;
    });
  // Attach immediately; dispatch will await the same completion below.
  void cleanup.catch(() => undefined);
  const result = await execution;
  await cleanup;
  return result;
}
