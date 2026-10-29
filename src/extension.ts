import { randomUUID } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { WorkerClient, type WorkerClientOptions } from "./client.js";
import { nativeWorkerLaunch } from "./launcher.js";

export function registerComputerUse(
  pi: Pick<ExtensionAPI, "registerTool" | "on"> &
    Partial<Pick<ExtensionAPI, "registerCommand">>,
  options: WorkerClientOptions = { launch: nativeWorkerLaunch },
): void {
  let operationId = randomUUID();
  let operationActive = false;
  let stopped = false;
  let operationAbort = new AbortController();
  let abortRun: (() => void) | undefined;
  const worker = new WorkerClient({
    ...options,
    onStop(id) {
      options.onStop?.(id);
      if (id === operationId) stopOperation(false);
    },
  });
  const stopOperation = (notifyWorker = true) => {
    if (stopped) return;
    stopped = true;
    if (notifyWorker) worker.stopOperation(operationId);
    operationAbort.abort(
      new Error(
        "COMPUTER_USE_STOPPED: user stopped this operation; wait for new user input",
      ),
    );
    abortRun?.();
  };
  const executeDesktop = async (
    action: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
    ctx?: { abort: () => void },
  ) => {
    if (stopped)
      throw new Error("COMPUTER_USE_STOPPED: wait for new user input");
    if (typeof ctx?.abort === "function") abortRun = () => ctx.abort();
    operationActive = true;
    const abort = () => stopOperation();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    try {
      return await worker.execute(
        action,
        args,
        signal
          ? AbortSignal.any([operationAbort.signal, signal])
          : operationAbort.signal,
        operationId,
      );
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  };
  pi.registerCommand?.("computer-stop", {
    description:
      "Stop the current computer-use operation without waiting for its tools",
    async handler(_args, ctx) {
      stopOperation();
      if (typeof ctx?.abort === "function") ctx.abort();
    },
  });
  const endOperation = async () => {
    if (!operationActive) return;
    operationActive = false;
    await worker.execute("operation_end", {}, undefined, operationId);
  };
  pi.on("before_agent_start", async (event) => {
    if (event.messageType !== "user") return;
    await endOperation();
    operationId = randomUUID();
    stopped = false;
    operationAbort = new AbortController();
  });
  pi.on("agent_settled", async (event) => {
    if (event.aborted) stopOperation();
    await endOperation();
  });
  pi.registerTool({
    name: "windows_computer_use_health",
    label: "Windows Computer Use Health",
    description:
      "Check the Windows automation worker connection and runtime. Does not send desktop input.",
    parameters: Type.Object({}),
    executionMode: "sequential",
    async execute(_toolCallId, _args, signal) {
      const result = await worker.execute("health", {}, signal);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        details: result,
        isError: !result.ok,
      };
    },
  });
  pi.registerTool({
    name: "windows_computer_use_list_windows",
    label: "List Windows",
    description:
      "List Windows desktop windows with native identities, bounds and responsiveness. Includes visible non-minimized windows by default; does not send physical input.",
    parameters: Type.Object({
      includeInvisible: Type.Optional(Type.Boolean({ default: false })),
      maxWindows: Type.Optional(
        Type.Integer({ minimum: 1, maximum: 200, default: 50 }),
      ),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, args, signal, _onUpdate, ctx) {
      const result = await executeDesktop("list_windows", args, signal, ctx);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        details: result,
        isError: !result.ok,
      };
    },
  });
  pi.on("session_shutdown", async () => {
    await worker.dispose();
  });
}

export default function computerUse(pi: ExtensionAPI): void {
  registerComputerUse(pi);
}
