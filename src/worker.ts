import { createInterface } from "node:readline";
import { observeDesktop } from "./accessibility.js";
import { disposeDesktop, listWindows } from "./desktop.js";
import type { WorkerRequest, WorkerResponse } from "./protocol.js";

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
let queue = Promise.resolve();
const requests = new Map<number, AbortController>();

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function dispatch(
  request: WorkerRequest,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
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
        : request.action === "list_windows"
          ? await listWindows(request.args, signal)
          : ["snapshot", "accessibility_tree", "find", "element_info"].includes(
                request.action,
              )
            ? await observeDesktop(request.action, request.args, signal)
            : { ok: false, action: request.action, error: "UNKNOWN_ACTION" },
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
  if (isObject(parsed) && "cancel" in parsed) {
    if (typeof parsed.cancel === "number") requests.get(parsed.cancel)?.abort();
    return;
  }
  if (!isObject(parsed) || !Number.isSafeInteger(parsed.id)) {
    process.stderr.write(
      "WORKER_PROTOCOL_ERROR: request requires a numeric id\n",
    );
    return;
  }
  if (typeof parsed.action !== "string" || !isObject(parsed.args)) {
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
  requests.set(request.id, controller);
  queue = queue
    .then(() => dispatch(request, controller.signal))
    .catch((error) => {
      process.stdout.write(
        `${JSON.stringify({ id: request.id, result: { ok: false, action: request.action, error: controller.signal.aborted ? "COMPUTER_USE_CANCELLED" : String(error) } })}\n`,
      );
    })
    .finally(() => {
      requests.delete(request.id);
    });
});
input.on("close", () => {
  void queue.finally(disposeDesktop);
});
