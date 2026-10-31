import { setTimeout as delay } from "node:timers/promises";
import { executeAccessibility } from "./accessibility.js";
import { retireDesktop } from "./desktop.js";
import { nativeDesktop } from "./native.js";
import { ocrDesktop } from "./ocr.js";
import type { WorkerResult } from "./protocol.js";

type Rule = {
  type: "integer" | "string" | "boolean";
  default?: unknown;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  enum?: string[];
};
const waitDefinition: Record<string, Rule> = {
  milliseconds: { type: "integer", minimum: 1, maximum: 30000, default: 500 },
};
const conditionDefinition: Record<string, Rule> = {
  windowRef: { type: "string", minLength: 1 },
  windowTitle: { type: "string" },
  processId: { type: "integer", minimum: 1 },
  nativeWindowHandle: { type: "integer", minimum: 1 },
  activate: { type: "boolean", default: false },
  scope: {
    type: "string",
    enum: ["active_window", "desktop"],
    default: "active_window",
  },
  condition: {
    type: "string",
    enum: ["window", "element", "text"],
    default: "window",
  },
  query: { type: "string" },
  controlType: { type: "string" },
  viewMode: {
    type: "string",
    enum: ["control", "content", "raw"],
    default: "control",
  },
  includeOffscreen: { type: "boolean", default: false },
  treeTimeoutMs: {
    type: "integer",
    minimum: 100,
    maximum: 30000,
    default: 1000,
  },
  maxDepth: { type: "integer", minimum: 0, maximum: 12, default: 8 },
  maxNodes: { type: "integer", minimum: 1, maximum: 5000, default: 1200 },
  appear: { type: "boolean", default: true },
  timeoutMs: { type: "integer", minimum: 100, maximum: 60000, default: 5000 },
  intervalMs: { type: "integer", minimum: 50, maximum: 5000, default: 250 },
};
export const waitTools = [
  {
    action: "wait",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: waitDefinition,
    },
  },
  {
    action: "wait_for",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: conditionDefinition,
    },
  },
];

async function observation(
  args: Record<string, unknown>,
  signal: AbortSignal,
): Promise<{
  found: boolean;
  conclusive: boolean;
  error?: string;
  truncated?: boolean;
}> {
  if (args.condition === "window") {
    // Internal enumeration has a higher cap than the model-facing listing tool.
    const result = await nativeDesktop.execute(
      "list_windows",
      {
        includeInvisible: true,
        maxWindows: 4096,
        _metadataOnly: true,
        ...(args.windowRef === undefined
          ? {}
          : {
              windowRef: args.windowRef,
              ...(args.nativeWindowHandle === undefined
                ? {}
                : { nativeWindowHandle: args.nativeWindowHandle }),
              ...(args.processId === undefined
                ? {}
                : { processId: args.processId }),
              ...(args.windowTitle === undefined
                ? {}
                : { windowTitle: args.windowTitle }),
            }),
      },
      signal,
    );
    if (!result.ok)
      return { found: false, conclusive: false, error: String(result.error) };
    if (typeof result.referencePresent === "boolean")
      return { found: result.referencePresent, conclusive: true };
    const windows = result.windows as Record<string, unknown>[];
    const found = windows.some(
      (window) =>
        (args.nativeWindowHandle === undefined ||
          window.nativeWindowHandle === args.nativeWindowHandle) &&
        (args.processId === undefined || window.processId === args.processId) &&
        (args.windowTitle === undefined ||
          String(window.name)
            .toLowerCase()
            .includes(String(args.windowTitle).toLowerCase())),
    );
    return {
      found,
      conclusive: found || result.truncated !== true,
      truncated: result.truncated === true,
    };
  }
  const target: Record<string, unknown> = {
    scope: args.scope,
    activate: false,
  };
  for (const key of [
    "windowRef",
    "windowTitle",
    "processId",
    "nativeWindowHandle",
  ])
    if (args[key] !== undefined) target[key] = args[key];
  if (args.condition === "text") {
    const result = await ocrDesktop(
      { ...target, query: args.query, resolveControl: false },
      signal,
    );
    const found =
      result.ok && Array.isArray(result.matched) && result.matched.length > 0;
    return {
      found,
      conclusive:
        result.ok &&
        result.captureConclusive === true &&
        result.occludedPossible !== true &&
        result.truncated !== true,
      ...(!result.ok ? { error: String(result.error) } : {}),
    };
  }
  const result = await executeAccessibility(
    "find",
    {
      ...target,
      query: args.query,
      ...(args.controlType !== undefined
        ? { controlType: args.controlType }
        : {}),
      viewMode: args.viewMode,
      includeOffscreen: args.includeOffscreen,
      treeTimeoutMs: args.treeTimeoutMs,
      maxDepth: args.maxDepth,
      maxNodes: args.maxNodes,
      maxResults: 1,
      ocrFallback: false,
    },
    signal,
  );
  const found =
    result.ok && Array.isArray(result.matches) && result.matches.length > 0;
  return {
    found,
    conclusive:
      result.ok &&
      (found ||
        (result.truncated !== true && result.providerError === undefined)),
    truncated: result.truncated === true,
    ...(!result.ok ? { error: String(result.error) } : {}),
  };
}

export async function waitDesktop(
  action: string,
  input: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<WorkerResult> {
  const definition = action === "wait" ? waitDefinition : conditionDefinition;
  const fail = (message: string): WorkerResult => ({
    ok: false,
    action,
    error: `INVALID_ARGUMENTS: ${message}`,
  });
  if (action !== "wait" && action !== "wait_for")
    return fail("unknown wait action");
  const args: Record<string, unknown> = {};
  for (const key of Object.keys(input))
    if (!(key in definition)) return fail(`unknown option ${key}`);
  for (const [key, rule] of Object.entries(definition)) {
    const value = Object.hasOwn(input, key) ? input[key] : rule.default;
    if (value === undefined) continue;
    if (
      rule.type === "integer"
        ? !Number.isSafeInteger(value)
        : typeof value !== rule.type
    )
      return fail(`invalid ${key}`);
    if (
      typeof value === "number" &&
      ((rule.minimum !== undefined && value < rule.minimum) ||
        (rule.maximum !== undefined && value > rule.maximum))
    )
      return fail(`${key} outside bounds`);
    if (
      typeof value === "string" &&
      ((rule.enum && !rule.enum.includes(value)) ||
        ((key === "query" || key === "windowTitle" || key === "windowRef") &&
          !value.trim()))
    )
      return fail(`invalid ${key}`);
    args[key] = value;
  }
  signal?.throwIfAborted();
  if (action === "wait") {
    await delay(Number(args.milliseconds), undefined, { signal });
    return { ok: true, action, milliseconds: args.milliseconds };
  }
  if (
    args.condition === "window" &&
    args.windowRef === undefined &&
    args.nativeWindowHandle === undefined &&
    args.processId === undefined &&
    args.windowTitle === undefined
  )
    return fail("window condition requires an explicit target");
  if (args.condition !== "window" && !String(args.query ?? "").trim())
    return fail("element/text condition requires query");
  const start = performance.now(),
    timeout = Number(args.timeoutMs);
  let last: {
    found: boolean;
    conclusive: boolean;
    error?: string;
    truncated?: boolean;
  } = { found: false, conclusive: false };
  let attempts = 0;
  const outcome = (observed: boolean): WorkerResult => {
    return {
      ok: observed,
      action,
      condition: args.condition,
      appear: args.appear,
      ...(args.query !== undefined ? { query: args.query } : {}),
      found: last.found,
      conclusive: last.conclusive,
      verification: observed
        ? "observed"
        : last.conclusive
          ? "timeout"
          : "inconclusive",
      timedOut: !observed,
      waitedMs: Math.round(performance.now() - start),
      attempts,
      ...(last.truncated ? { observationTruncated: true } : {}),
      ...(last.error ? { observationError: last.error } : {}),
      ...(args.condition === "text"
        ? {
            verificationNote:
              "Condition describes literal OCR output from a complete reliable capture, not universal proof of application text.",
          }
        : {}),
    };
  };
  for (;;) {
    if (attempts > 0 && performance.now() - start >= timeout)
      return outcome(false);
    signal?.throwIfAborted();
    const remaining = Math.max(
      1,
      Math.ceil(timeout - (performance.now() - start)),
    );
    if (attempts > 0 && remaining < 100) {
      await delay(remaining, undefined, { signal });
      return outcome(false);
    }
    const deadline = AbortSignal.timeout(remaining);
    const pollSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
    try {
      last = await observation(
        {
          ...args,
          treeTimeoutMs: Math.max(
            100,
            Math.min(Number(args.treeTimeoutMs), remaining),
          ),
        },
        pollSignal,
      );
    } catch (error) {
      signal?.throwIfAborted();
      last = {
        found: false,
        conclusive: false,
        error: deadline.aborted
          ? "OBSERVATION_TIMEOUT: condition could not be established before its deadline"
          : String(error),
      };
      if (deadline.aborted) await retireDesktop();
    }
    attempts++;
    signal?.throwIfAborted();
    const observed = last.conclusive && last.found === args.appear;
    const waitedMs = Math.round(performance.now() - start);
    if (observed || waitedMs >= timeout) return outcome(observed);
    await delay(
      Math.min(
        Number(args.intervalMs),
        Math.max(1, timeout - (performance.now() - start)),
      ),
      undefined,
      { signal },
    );
  }
}
