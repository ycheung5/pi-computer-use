import { access } from "node:fs/promises";
import { join } from "node:path";
import { WorkerClient } from "./client.js";
import { compileNative, nativeDesktop } from "./native.js";
import type { WorkerResult } from "./protocol.js";

function createWgc(): WorkerClient {
  return new WorkerClient({
    launch: async (signal) => {
      const windows = process.env.WINDIR;
      if (!windows)
        throw new Error("WGC_UNAVAILABLE: Windows directory is unknown");
      const framework = join(
        windows,
        "Microsoft.NET",
        "Framework64",
        "v4.0.30319",
      );
      const metadata = join(windows, "System32", "WinMetadata");
      const graphics: string[] = [];
      for (const name of [
        "Windows.Graphics.winmd",
        "Windows.Graphics.Capture.winmd",
        "Windows.Graphics.DirectX.winmd",
        "Windows.Graphics.DirectX.Direct3D11.winmd",
        "Windows.Graphics.Imaging.winmd",
      ]) {
        const candidate = join(metadata, name);
        try {
          await access(candidate);
          graphics.push(candidate);
        } catch {
          /* Optional split/consolidated metadata differs across Windows versions. */
        }
      }
      if (graphics.length === 0)
        throw new Error(
          "WGC_UNAVAILABLE: Windows graphics metadata is missing",
        );
      return compileNative(
        ["wgc.cs"],
        [
          "System.Drawing.dll",
          join(framework, "System.Runtime.dll"),
          join(framework, "System.Runtime.WindowsRuntime.dll"),
          join(metadata, "Windows.Foundation.winmd"),
          ...graphics,
        ],
        signal,
      );
    },
    timeoutMs: 8000,
  });
}

export async function screenshot(
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<WorkerResult> {
  signal?.throwIfAborted();
  const maxWidth = args.maxWidth ?? 1600;
  const scope = args.scope ?? "active_window";
  const allowed = new Set([
    "maxWidth",
    "scope",
    "windowTitle",
    "processId",
    "nativeWindowHandle",
    "activate",
  ]);
  const invalid =
    Object.keys(args).some((key) => !allowed.has(key)) ||
    !Number.isSafeInteger(maxWidth) ||
    typeof maxWidth !== "number" ||
    maxWidth < 0 ||
    maxWidth > 7680 ||
    (scope !== "active_window" && scope !== "desktop") ||
    (args.windowTitle !== undefined &&
      (typeof args.windowTitle !== "string" || !args.windowTitle.trim())) ||
    [args.processId, args.nativeWindowHandle].some(
      (value) =>
        value !== undefined &&
        (typeof value !== "number" ||
          !Number.isSafeInteger(value) ||
          value < 1),
    ) ||
    (args.activate !== undefined && typeof args.activate !== "boolean");
  if (invalid)
    return {
      ok: false,
      action: "screenshot",
      error:
        "INVALID_ARGUMENTS: invalid screenshot target, scope or maxWidth (integer 0–7680)",
    };
  try {
    const result = await nativeDesktop.execute(
      "screenshot",
      { ...args, scope, maxWidth },
      signal,
    );
    const target = result.wgcTarget;
    delete result.wgcTarget;
    if (
      result.ok &&
      target &&
      typeof target === "object" &&
      !Array.isArray(target)
    ) {
      let failure: string;
      const wgc = createWgc();
      try {
        const composited = await wgc.execute(
          "screenshot",
          { ...target, maxWidth },
          signal,
        );
        if (composited.ok) return composited;
        failure = String(composited.error);
      } catch (error) {
        if (signal?.aborted) throw error;
        failure = error instanceof Error ? error.message : String(error);
      } finally {
        await wgc.dispose();
      }
      if (result.screenshot && typeof result.screenshot === "object") {
        const capture = result.screenshot as Record<string, unknown>;
        capture.captureWarnings = [
          ...(Array.isArray(capture.captureWarnings)
            ? capture.captureWarnings
            : []),
          `WGC_UNAVAILABLE: ${failure}`,
        ];
      }
    }
    return result;
  } catch (error) {
    return {
      ok: false,
      action: "screenshot",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function screenshotContent(result: WorkerResult) {
  const capture = result.screenshot;
  if (
    !capture ||
    typeof capture !== "object" ||
    !("base64" in capture) ||
    typeof capture.base64 !== "string"
  ) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
      details: result,
      isError: !result.ok,
    };
  }
  const { base64, ...metadata } = capture;
  const details = { ...result, screenshot: metadata };
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(details) },
      { type: "image" as const, data: base64, mimeType: "image/png" },
    ],
    details,
    isError: !result.ok,
  };
}
