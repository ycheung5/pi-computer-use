import { join } from "node:path";
import { screenshot } from "./capture.js";
import { WorkerClient } from "./client.js";
import { compileNative, nativeDesktop } from "./native.js";
import type { WorkerResult } from "./protocol.js";

type Box = { x: number; y: number; width: number; height: number };
type Word = Box & { text: string };
type Line = { text: string; words: Word[]; boundingBox?: Box | null };

export const ocrParameters = {
  type: "object",
  additionalProperties: false,
  properties: {
    windowTitle: { type: "string", minLength: 1 },
    processId: { type: "integer", minimum: 1 },
    nativeWindowHandle: { type: "integer", minimum: 1 },
    activate: { type: "boolean", default: false },
    scope: {
      type: "string",
      enum: ["active_window", "desktop"],
      default: "active_window",
    },
    maxWidth: { type: "integer", minimum: 0, maximum: 7680, default: 1920 },
    query: { type: "string", minLength: 1 },
    resolveControl: { type: "boolean", default: false },
    includeScreenshot: { type: "boolean", default: false },
  },
};

const createEngine = () =>
  new WorkerClient({
    launch: async (signal) => {
      const windows = process.env.WINDIR;
      if (!windows)
        throw new Error("OCR_UNAVAILABLE: Windows metadata is unavailable");
      const framework = join(
        windows,
        "Microsoft.NET",
        "Framework64",
        "v4.0.30319",
      );
      const metadata = join(windows, "System32", "WinMetadata");
      return compileNative(
        ["ocr.cs"],
        [
          "System.Drawing.dll",
          "System.Core.dll",
          ...["System.Runtime.dll", "System.Runtime.WindowsRuntime.dll"].map(
            (name) => join(framework, name),
          ),
          ...[
            "Windows.Foundation.winmd",
            "Windows.Media.winmd",
            "Windows.Graphics.winmd",
            "Windows.Globalization.winmd",
          ].map((name) => join(metadata, name)),
        ],
        signal,
      );
    },
    timeoutMs: 20_000,
  });
let engine = createEngine();

function union(words: Word[]): Box | null {
  if (words.length === 0) return null;
  const x = Math.min(...words.map((word) => word.x)),
    y = Math.min(...words.map((word) => word.y));
  return {
    x,
    y,
    width: Math.max(...words.map((word) => word.x + word.width)) - x,
    height: Math.max(...words.map((word) => word.y + word.height)) - y,
  };
}
const normalize = (text: string) => text.replace(/\s/gu, "").toLowerCase();

export async function ocrDesktop(
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<WorkerResult> {
  const fail = (error: string): WorkerResult => ({
    ok: false,
    action: "ocr",
    error,
    conclusive: false,
  });
  for (const [key, value] of Object.entries(args)) {
    const rule =
      ocrParameters.properties[key as keyof typeof ocrParameters.properties];
    if (!rule) return fail(`INVALID_ARGUMENTS: unknown option ${key}`);
    if (
      rule.type === "integer"
        ? !Number.isSafeInteger(value)
        : typeof value !== rule.type
    )
      return fail(`INVALID_ARGUMENTS: invalid ${key}`);
  }
  if (
    (args.query !== undefined && !normalize(String(args.query))) ||
    (args.windowTitle !== undefined && !String(args.windowTitle).trim()) ||
    [args.processId, args.nativeWindowHandle].some(
      (value) => value !== undefined && Number(value) < 1,
    ) ||
    (args.scope !== undefined &&
      args.scope !== "active_window" &&
      args.scope !== "desktop") ||
    (args.maxWidth !== undefined &&
      (Number(args.maxWidth) < 0 || Number(args.maxWidth) > 7680))
  )
    return fail(
      "INVALID_ARGUMENTS: invalid OCR target, query, scope or maxWidth",
    );
  signal?.throwIfAborted();
  const captureArgs: Record<string, unknown> = {
    maxWidth: args.maxWidth ?? 1920,
  };
  for (const key of [
    "scope",
    "windowTitle",
    "processId",
    "nativeWindowHandle",
    "activate",
  ])
    if (args[key] !== undefined) captureArgs[key] = args[key];
  const captured = await screenshot(captureArgs, signal);
  signal?.throwIfAborted();
  if (!captured.ok) return fail(`OCR_CAPTURE_FAILED: ${captured.error}`);
  const image = captured.screenshot as Record<string, unknown>;
  if (!image || image.windowCaptureFailed)
    return fail(
      "OCR_CAPTURE_FAILED: target has no capturable surface; desktop fallback is not target evidence",
    );
  try {
    const recognized = await engine.execute(
      "recognize",
      { png: image.base64 },
      signal,
    );
    signal?.throwIfAborted();
    if (!recognized.ok)
      return { ...recognized, action: "ocr", conclusive: false };
    const origin = image.origin as { x: number; y: number };
    const scale = Number(image.imageScale),
      scaleY = Number(image.imageScaleY ?? scale);
    if (!(scale > 0 && scaleY > 0))
      return fail("OCR_CAPTURE_FAILED: invalid image mapping");
    const lines = (recognized.lines as Line[]).map((line) => {
      const words = line.words.map((word) => ({
        text: word.text,
        x: origin.x + word.x / scale,
        y: origin.y + word.y / scaleY,
        width: word.width / scale,
        height: word.height / scaleY,
      }));
      return { text: line.text, words, boundingBox: union(words) };
    });
    const result: WorkerResult = {
      ok: true,
      action: "ocr",
      text: recognized.text,
      lines,
      language: recognized.language,
      availableLanguages: recognized.availableLanguages,
      source: args.scope === "desktop" ? "desktop" : "window",
      coordinateSpace: "screen",
      imageBounds: image.bounds,
      imageScale: scale,
      imageScaleY: scaleY,
      captureMethod: image.method,
      occludedPossible: image.occludedPossible,
      captureWarnings: image.captureWarnings,
      conclusive: image.occludedPossible !== true,
    };
    if (args.includeScreenshot) result.screenshot = image;
    if (args.query !== undefined) {
      const matched: Record<string, unknown>[] = [];
      const needle = normalize(String(args.query));
      for (const line of lines) {
        const normalizedWords = line.words.map((word) => normalize(word.text));
        const offset = normalizedWords.join("").indexOf(needle);
        if (offset < 0) continue;
        let position = 0;
        const words = line.words.filter((_, index) => {
          const start = position;
          position += normalizedWords[index]?.length ?? 0;
          return position > offset && start < offset + needle.length;
        });
        const bounds = union(words);
        if (!bounds) continue;
        const x = bounds.x + bounds.width / 2,
          y = bounds.y + bounds.height / 2;
        let control: unknown = null;
        let controlError: string | undefined;
        if (args.resolveControl && !image.occludedPossible) {
          const target: Record<string, unknown> = {
            x: Math.round(x),
            y: Math.round(y),
            detailLevel: "full",
          };
          for (const key of ["windowTitle", "processId", "nativeWindowHandle"])
            if (args[key] !== undefined) target[key] = args[key];
          try {
            const observed = await nativeDesktop.execute(
              "element_info",
              target,
              signal,
            );
            if (
              observed.ok &&
              observed.element &&
              typeof observed.element === "object"
            ) {
              const element = observed.element as Record<string, unknown>;
              control = Object.fromEntries(
                [
                  "controlType",
                  "name",
                  "automationId",
                  "className",
                  "boundingBox",
                ]
                  .filter((key) => element[key] !== undefined)
                  .map((key) => [key, element[key]]),
              );
            } else controlError = String(observed.error);
          } catch (error) {
            if (signal?.aborted) throw error;
            controlError = String(error);
          }
        }
        matched.push({
          source: "ocr",
          line: line.text,
          word: { text: words.map((word) => word.text).join(" "), x, y },
          boundingBox: bounds,
          control,
          ...(controlError ? { controlError } : {}),
        });
        if (matched.length === 3) break;
      }
      result.query = args.query;
      result.matched = matched;
      if (!matched.length) result.conclusive = false;
      if (!matched.length)
        result.note =
          "No literal OCR word sequence matched (case-insensitive, ignoring whitespace); recognition is not proof that the text is absent.";
    }
    if (image.occludedPossible)
      result.note =
        "Capture may contain occluding content; OCR cannot establish target text absence or control identity.";
    return result;
  } catch (error) {
    if (signal?.aborted) {
      const retired = engine;
      engine = createEngine();
      await retired.dispose();
      throw error;
    }
    return fail(
      `OCR_UNAVAILABLE: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function disposeOcr(): Promise<void> {
  await engine.dispose();
}
