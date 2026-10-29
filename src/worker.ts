import { createInterface } from "node:readline";
import {
  controlTools,
  executeAccessibility,
  observationTools,
} from "./accessibility.js";
import {
  browse,
  browserListing,
  configureBrowser,
  disposeBrowser,
  isBrowserRequest,
} from "./browser.js";
import { screenshot, screenshotParameters } from "./capture.js";
import {
  disposeDesktop,
  listWindows,
  listWindowsParameters,
  retireDesktop,
} from "./desktop.js";
import { runNativeOperation } from "./native.js";
import { disposeOcr, ocrDesktop, ocrParameters } from "./ocr.js";
import {
  acquireDesktop,
  disposeOwnership,
  releaseDesktop,
} from "./ownership.js";
import {
  awaitPointerCleanup,
  executePointer,
  pointerTools,
  validatePointer,
} from "./pointer.js";
import type { WorkerRequest, WorkerResponse } from "./protocol.js";
import { PersonalSettingsManager } from "./settings.js";
import { StopListener } from "./stop.js";
import { waitDesktop, waitTools } from "./waits.js";

const settings = new PersonalSettingsManager(
  new Map<string, { description: string; parameters?: unknown }>([
    [
      "health",
      {
        description: "Check automation worker health",
        parameters: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
    ],
    [
      "list_windows",
      {
        description: "Discover native windows and browser tabs",
        parameters: listWindowsParameters,
      },
    ],
    [
      "screenshot",
      {
        description: "Capture desktop, native window or browser page",
        parameters: screenshotParameters,
      },
    ],
    [
      "ocr",
      {
        description: "Read literal screen text and coordinates",
        parameters: ocrParameters,
      },
    ],
    ...[
      ...observationTools,
      ...controlTools,
      ...pointerTools,
      ...waitTools,
    ].map(
      (tool) =>
        [
          tool.action,
          {
            description: `Windows computer use ${tool.action}`,
            parameters: tool.parameters,
          },
        ] as const,
    ),
  ]),
);
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
let queue = Promise.resolve();
const requests = new Map<
  number,
  { controller: AbortController; operationId: string }
>();
const blocked = new Set<string>();
const lastTargets = new Map<
  string,
  { nativeWindowHandle: number; processId: number }
>();
function rememberTarget(
  operationId: string,
  result: import("./protocol.js").WorkerResult,
): void {
  if (
    result.ok &&
    Number.isSafeInteger(result.inputTargetHandle) &&
    Number.isSafeInteger(result.inputTargetProcessId)
  )
    lastTargets.set(operationId, {
      nativeWindowHandle: Number(result.inputTargetHandle),
      processId: Number(result.inputTargetProcessId),
    });
}
let stopping: Promise<void> = Promise.resolve();
const stopListener = new StopListener((operationId) => {
  void stopOperation(operationId).catch((error) =>
    process.stderr.write(`${String(error)}\n`),
  );
});

async function stopOperation(operationId: string): Promise<void> {
  if (blocked.has(operationId)) return stopping;
  blocked.add(operationId);
  process.stdout.write(
    `${JSON.stringify({ event: "stopped", operationId })}\n`,
  );
  stopping = stopping.then(async () => {
    try {
      await stopListener.signal(operationId);
    } finally {
      for (const request of requests.values())
        if (request.operationId === operationId)
          request.controller.abort(new Error("COMPUTER_USE_STOPPED"));
      await awaitPointerCleanup();
      await retireDesktop();
    }
  });
  return stopping;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function guardedPointer(
  action: string,
  args: Record<string, unknown>,
  operationId: string,
  signal: AbortSignal,
): Promise<import("./protocol.js").WorkerResult> {
  const armed = await stopListener.arm(operationId, signal);
  if (!armed.ok || typeof armed.cancelEvent !== "string")
    return { ...armed, action };
  signal.throwIfAborted();
  process.stdout.write(
    `${JSON.stringify({ event: "input_state", active: true })}\n`,
  );
  const result = await executePointer(
    action,
    args,
    armed.cancelEvent,
    operationId,
    Number(armed.listenerProcessId),
  );
  process.stdout.write(
    `${JSON.stringify({ event: "input_state", active: false })}\n`,
  );
  return result;
}

async function dispatch(
  request: WorkerRequest,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  const operationId = request.operationId ?? `worker-${process.pid}`;
  if (request.action === "operation_end") {
    await stopping;
    await awaitPointerCleanup();
    await stopListener.disarm(operationId);
    const result = await releaseDesktop(operationId);
    if (result.ok) lastTargets.delete(operationId);
    process.stdout.write(`${JSON.stringify({ id: request.id, result })}\n`);
    return;
  }
  if (["settings_get", "settings_update", "tools"].includes(request.action)) {
    const result = await settings.handle(request.action, request.args);
    process.stdout.write(`${JSON.stringify({ id: request.id, result })}\n`);
    return;
  }
  const denial = await settings.authorize(request.action);
  if (denial) {
    process.stdout.write(
      `${JSON.stringify({ id: request.id, result: { ok: false, action: request.action, error: denial } })}\n`,
    );
    return;
  }
  const configuration = settings.currentSettings;
  if (
    configuration &&
    process.platform === "win32" &&
    settings.currentFileExists
  )
    await configureBrowser({
      browserApp: configuration.browserApp,
      browserVisible: configuration.browserVisible,
      browserSignIn: configuration.browserSignIn,
    });
  if (request.action !== "health" && blocked.has(operationId)) {
    process.stdout.write(
      `${JSON.stringify({ id: request.id, result: { ok: false, action: request.action, error: "COMPUTER_USE_STOPPED: wait for a new user operation" } })}\n`,
    );
    return;
  }
  if (request.action !== "health" && process.platform === "win32") {
    const ownership = await acquireDesktop(operationId, signal);
    if (!ownership.ok) {
      process.stdout.write(
        `${JSON.stringify({ id: request.id, result: { ...ownership, action: request.action } })}\n`,
      );
      return;
    }
  }
  const previous = lastTargets.get(operationId);
  if (
    previous &&
    !isBrowserRequest(request.args) &&
    request.args.scope !== "desktop" &&
    !["list_windows", "health", "operation_end", "wait"].includes(
      request.action,
    ) &&
    !["windowTitle", "processId", "nativeWindowHandle", "elementId"].some(
      (key) => request.args[key] !== undefined,
    )
  )
    request.args = { ...request.args, ...previous };
  if (request.action === "prepare_input") {
    const result = await stopListener.arm(operationId, signal);
    process.stdout.write(`${JSON.stringify({ id: request.id, result })}\n`);
    return;
  }
  if (
    ["type_text", "keypress"].includes(request.action) &&
    !isBrowserRequest(request.args)
  ) {
    process.stdout.write(
      `${JSON.stringify({ id: request.id, result: { ok: false, action: request.action, error: "INPUT_SAFETY_NOT_READY: action requires cooperative native cleanup before enabling input" } })}\n`,
    );
    return;
  }
  if (
    !isBrowserRequest(request.args) &&
    (["click", "double_click", "move", "drag"].includes(request.action) ||
      (request.action === "scroll" && !request.args.elementId))
  ) {
    const invalid = validatePointer(request.action, request.args);
    if (invalid) {
      process.stdout.write(
        `${JSON.stringify({ id: request.id, result: invalid })}\n`,
      );
      return;
    }
    // Only the explicit needs-input result permits escalation/retry. No timeout,
    // stale/disabled/covered-point error can trigger replay.
    if (
      (request.args.dispatch === "background" ||
        (request.action === "click" &&
          request.args.elementId &&
          (request.args.button ?? "left") === "left" &&
          !request.args.activate &&
          request.args.dispatch !== "foreground")) &&
      ["click", "double_click"].includes(request.action)
    ) {
      const quiet = await executePointer(
        request.action,
        request.args,
        "",
        operationId,
        undefined,
        signal,
      );
      if (!quiet.inputRequired || request.args.dispatch === "background") {
        rememberTarget(operationId, quiet);
        process.stdout.write(
          `${JSON.stringify({ id: request.id, result: quiet })}\n`,
        );
        return;
      }
    }
    const result = await guardedPointer(
      request.action,
      request.args,
      operationId,
      signal,
    );
    rememberTarget(operationId, result);
    process.stdout.write(`${JSON.stringify({ id: request.id, result })}\n`);
    return;
  }
  const response: WorkerResponse = {
    id: request.id,
    result:
      request.action === "health"
        ? {
            ok: true,
            action: "health",
            processId: process.pid,
            platform: process.platform,
            nodeVersion: process.version,
            settings: {
              preset: settings.currentSettings?.toolPreset,
              notices: settings.currentNotices,
              source: settings.currentSource,
            },
          }
        : isBrowserRequest(request.args)
          ? await browse(request.action, request.args, signal)
          : ["wait", "wait_for"].includes(request.action)
            ? await waitDesktop(request.action, request.args, signal)
            : request.action === "list_windows"
              ? {
                  ...(await listWindows(request.args, signal)),
                  browserLane: await browserListing(),
                }
              : request.action === "ocr"
                ? await ocrDesktop(request.args, signal)
                : request.action === "screenshot"
                  ? await screenshot(request.args, signal)
                  : [
                        "snapshot",
                        "accessibility_tree",
                        "find",
                        "element_info",
                        "focus",
                        "invoke",
                        "set_value",
                        "scroll",
                      ].includes(request.action)
                    ? await executeAccessibility(
                        request.action,
                        request.args,
                        signal,
                      )
                    : {
                        ok: false,
                        action: request.action,
                        error: "UNKNOWN_ACTION",
                      },
  };
  if (
    !isBrowserRequest(request.args) &&
    response.result.inputRequired === true &&
    ["invoke", "scroll"].includes(request.action)
  ) {
    const pointerAction = request.action === "invoke" ? "click" : "scroll";
    const result = await guardedPointer(
      pointerAction,
      { ...request.args, dispatch: "foreground" },
      operationId,
      signal,
    );
    response.result = {
      ...result,
      action: request.action,
      method: result.ok ? `fallback:${String(result.method)}` : result.method,
    };
  }
  rememberTarget(operationId, response.result);
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

input.on("line", (line) => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    process.stderr.write("WORKER_PROTOCOL_ERROR: invalid JSON\n");
    return;
  }
  if (isObject(parsed) && typeof parsed.stop === "string") {
    void stopOperation(parsed.stop).catch((error) =>
      process.stderr.write(`${String(error)}\n`),
    );
    return;
  }
  if (isObject(parsed) && "cancel" in parsed) {
    if (typeof parsed.cancel === "number") {
      const request = requests.get(parsed.cancel);
      if (request)
        void stopOperation(request.operationId).catch((error) =>
          process.stderr.write(`${String(error)}\n`),
        );
    }
    return;
  }
  if (!isObject(parsed) || !Number.isSafeInteger(parsed.id)) {
    process.stderr.write(
      "WORKER_PROTOCOL_ERROR: request requires a numeric id\n",
    );
    return;
  }
  if (
    typeof parsed.action !== "string" ||
    !isObject(parsed.args) ||
    (parsed.operationId !== undefined &&
      (typeof parsed.operationId !== "string" ||
        parsed.operationId.length < 1 ||
        parsed.operationId.length > 200))
  ) {
    process.stdout.write(
      `${JSON.stringify({ id: parsed.id, result: { ok: false, action: typeof parsed.action === "string" ? parsed.action : "invalid_request", error: "INVALID_REQUEST: action must be a string and args must be an object" } })}\n`,
    );
    return;
  }
  const request = parsed as unknown as WorkerRequest;
  if (requests.has(request.id)) {
    process.stderr.write("WORKER_PROTOCOL_ERROR: duplicate request id\n");
    return;
  }
  const controller = new AbortController();
  requests.set(request.id, {
    controller,
    operationId: request.operationId ?? `worker-${process.pid}`,
  });
  queue = queue
    .then(() =>
      runNativeOperation(request.operationId ?? `worker-${process.pid}`, () =>
        dispatch(request, controller.signal),
      ),
    )
    .catch((error) => {
      process.stdout.write(
        `${JSON.stringify({ id: request.id, result: { ok: false, action: request.action, error: controller.signal.aborted ? "COMPUTER_USE_STOPPED" : String(error) } })}\n`,
      );
    })
    .finally(() => {
      requests.delete(request.id);
    });
});
input.on("close", () => {
  void queue
    .then(async () => {
      await stopping;
      await disposeBrowser();
      await awaitPointerCleanup();
      await disposeDesktop();
      await disposeOcr();
      await stopListener.dispose();
      await disposeOwnership();
    })
    .catch((error) => {
      // Keep native handles and ownership alive if safe exit cannot be proved.
      process.stderr.write(`CLEANUP_UNCONFIRMED: ${String(error)}\n`);
    });
});
