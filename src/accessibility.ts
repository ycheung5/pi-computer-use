import { screenshot } from "./capture.js";
import { nativeDesktop } from "./native.js";
import { ocrDesktop } from "./ocr.js";
import type { WorkerResult } from "./protocol.js";

type Property = {
  type: "string" | "integer" | "boolean";
  default?: unknown;
  enum?: readonly string[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
};
const target = {
  windowTitle: { type: "string" },
  processId: { type: "integer", minimum: 1 },
  nativeWindowHandle: { type: "integer", minimum: 1 },
  activate: { type: "boolean", default: false },
} satisfies Record<string, Property>;
const view = {
  viewMode: {
    type: "string",
    enum: ["control", "content", "raw"],
    default: "control",
  },
  includeOffscreen: { type: "boolean", default: false },
} satisfies Record<string, Property>;
const detail = {
  detailLevel: {
    type: "string",
    enum: ["compact", "full"],
    default: "compact",
  },
} satisfies Record<string, Property>;
const tree = {
  scope: {
    type: "string",
    enum: ["active_window", "desktop"],
    default: "active_window",
  },
  treeTimeoutMs: {
    type: "integer",
    minimum: 100,
    maximum: 30000,
    default: 5000,
  },
  maxDepth: { type: "integer", minimum: 0, maximum: 12, default: 6 },
  maxNodes: { type: "integer", minimum: 1, maximum: 3000, default: 500 },
} satisfies Record<string, Property>;
const definitions: Record<
  string,
  { properties: Record<string, Property>; required?: string[] }
> = {
  accessibility_tree: {
    properties: { ...target, ...view, ...detail, ...tree },
  },
  snapshot: {
    properties: {
      ...target,
      ...view,
      ...detail,
      ...tree,
      maxDepth: { ...tree.maxDepth, default: 5 },
      maxNodes: { ...tree.maxNodes, maximum: 2000, default: 250 },
      includeScreenshot: { type: "boolean", default: true },
      captureWindow: { type: "boolean", default: false },
      maxWidth: { type: "integer", minimum: 0, maximum: 7680, default: 1600 },
    },
  },
  find: {
    properties: {
      ...target,
      ...view,
      ...tree,
      query: { type: "string", minLength: 1 },
      controlType: { type: "string" },
      ocrFallback: { type: "boolean", default: true },
      maxDepth: { ...tree.maxDepth, default: 8 },
      maxNodes: { ...tree.maxNodes, maximum: 5000, default: 1200 },
      maxResults: { type: "integer", minimum: 1, maximum: 200, default: 25 },
    },
    required: ["query"],
  },
  element_info: {
    properties: {
      ...target,
      ...view,
      ...detail,
      elementId: { type: "string", minLength: 1 },
      x: { type: "integer" },
      y: { type: "integer" },
    },
  },
};

export const observationTools = Object.entries(definitions).map(
  ([action, definition]) => ({
    action,
    parameters: { type: "object", additionalProperties: false, ...definition },
  }),
);

export async function observeDesktop(
  action: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<WorkerResult> {
  const definition = definitions[action];
  if (!definition) return { ok: false, action, error: "UNKNOWN_ACTION" };
  const normalized: Record<string, unknown> = {};
  const invalid = (message: string): WorkerResult => ({
    ok: false,
    action,
    error: `INVALID_ARGUMENTS: ${message}`,
  });
  for (const key of Object.keys(args))
    if (!(key in definition.properties))
      return invalid(`unknown option ${key}`);
  for (const [key, rule] of Object.entries(definition.properties)) {
    const value = Object.hasOwn(args, key) ? args[key] : rule.default;
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
      return invalid(`${key} must be ${rule.type}`);
    if (
      typeof value === "number" &&
      ((rule.minimum !== undefined && value < rule.minimum) ||
        (rule.maximum !== undefined && value > rule.maximum))
    )
      return invalid(`${key} is outside supported bounds`);
    if (
      typeof value === "string" &&
      ((rule.enum && !rule.enum.includes(value)) ||
        (rule.minLength && value.length < rule.minLength))
    )
      return invalid(`${key} has an unsupported value`);
    normalized[key] = value;
  }
  if (
    action === "element_info" &&
    !normalized.elementId &&
    (normalized.x === undefined || normalized.y === undefined)
  )
    return invalid("provide elementId or both x and y");
  signal?.throwIfAborted();
  let result: WorkerResult;
  try {
    result = await nativeDesktop.execute(action, normalized, signal);
  } catch (error) {
    result = {
      ok: false,
      action,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  if (action === "snapshot" && normalized.includeScreenshot) {
    delete result.screenshotPending;
    const windowCapture =
      normalized.captureWindow && normalized.scope !== "desktop";
    const captureArgs: Record<string, unknown> = {
      scope: windowCapture ? "active_window" : "desktop",
      maxWidth: normalized.maxWidth,
    };
    if (windowCapture) {
      for (const key of [
        "windowTitle",
        "processId",
        "nativeWindowHandle",
        "activate",
      ]) {
        const value = result[key] ?? normalized[key];
        if (value !== undefined) captureArgs[key] = value;
      }
    }
    const captured = await screenshot(captureArgs, signal);
    if (captured.ok && captured.screenshot)
      result.screenshot = captured.screenshot;
    else {
      result.partial = true;
      result.screenshotError = String(
        captured.error ?? "SCREENSHOT_UNAVAILABLE",
      );
    }
  }
  if (action === "find" && result.ocrFallbackPending) {
    delete result.ocrFallbackPending;
    const ocrArgs: Record<string, unknown> = {
      query: normalized.query,
      scope: normalized.scope,
    };
    for (const key of [
      "windowTitle",
      "processId",
      "nativeWindowHandle",
      "activate",
    ]) {
      const value = result[key] ?? normalized[key];
      if (value !== undefined) ocrArgs[key] = value;
    }
    const recognized = await ocrDesktop(ocrArgs, signal);
    result.ocr = recognized;
    if (recognized.ok) result.ocrCandidates = recognized.matched ?? [];
    else {
      result.ocrError = recognized.error;
      result.conclusive = false;
    }
  }
  return result;
}
