import { createInterface } from "node:readline";
import { executeAccessibility } from "./accessibility.js";
import {
  browse,
  browserListing,
  disposeBrowser,
  isBrowserRequest,
} from "./browser.js";
import { screenshot } from "./capture.js";
import { disposeDesktop, listWindows, retireDesktop } from "./desktop.js";
import { disposeOcr, ocrDesktop } from "./ocr.js";
import {
  acquireDesktop,
  disposeOwnership,
  releaseDesktop,
} from "./ownership.js";
import type { WorkerRequest, WorkerResponse } from "./protocol.js";
import { StopListener } from "./stop.js";
import { waitDesktop } from "./waits.js";

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
let queue = Promise.resolve();
const requests = new Map<
  number,
  { controller: AbortController; operationId: string }
>();
const blocked = new Set<string>();
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
      await retireDesktop();
    }
  });
  return stopping;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function dispatch(
  request: WorkerRequest,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  const operationId = request.operationId ?? `worker-${process.pid}`;
  if (request.action === "operation_end") {
    await stopping;
    await stopListener.disarm(operationId);
    const result = await releaseDesktop(operationId);
    process.stdout.write(`${JSON.stringify({ id: request.id, result })}\n`);
    return;
  }
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
  if (request.action === "prepare_input") {
    const result = await stopListener.arm(operationId, signal);
    process.stdout.write(`${JSON.stringify({ id: request.id, result })}\n`);
    return;
  }
  if (
    ["click", "double_click", "move", "drag", "type_text", "keypress"].includes(
      request.action,
    ) &&
    !isBrowserRequest(request.args)
  ) {
    process.stdout.write(
      `${JSON.stringify({ id: request.id, result: { ok: false, action: request.action, error: "INPUT_SAFETY_NOT_READY: action requires cooperative native cleanup before enabling input" } })}\n`,
    );
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
    .then(() => dispatch(request, controller.signal))
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
