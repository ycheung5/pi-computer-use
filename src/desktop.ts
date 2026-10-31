import { nativeDesktop } from "./native.js";
import type { WorkerResult } from "./protocol.js";

export const listWindowsParameters = {
  type: "object",
  additionalProperties: false,
  properties: {
    includeInvisible: { type: "boolean", default: false },
    maxWindows: { type: "integer", minimum: 1, maximum: 200, default: 50 },
  },
};

export async function listWindows(
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<WorkerResult> {
  signal?.throwIfAborted();
  const maxWindows = args.maxWindows ?? 50;
  const includeInvisible = args.includeInvisible ?? false;
  if (
    Object.keys(args).some(
      (key) => !["maxWindows", "includeInvisible"].includes(key),
    ) ||
    !Number.isInteger(maxWindows) ||
    typeof maxWindows !== "number" ||
    maxWindows < 1 ||
    maxWindows > 200 ||
    typeof includeInvisible !== "boolean"
  ) {
    return {
      ok: false,
      action: "list_windows",
      error:
        "INVALID_ARGUMENTS: maxWindows must be an integer 1–200 and includeInvisible must be boolean",
    };
  }
  try {
    return await nativeDesktop.execute(
      "list_windows",
      { maxWindows, includeInvisible },
      signal,
    );
  } catch (error) {
    return {
      ok: false,
      action: "list_windows",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function disposeDesktop(): Promise<void> {
  await nativeDesktop.dispose();
}

export async function retireDesktop(): Promise<void> {
  await nativeDesktop.retire(
    "COMPUTER_USE_STOPPED: native desktop bridge retired after cancellation",
  );
}
