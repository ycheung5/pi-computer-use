import { randomUUID } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { controlTools, observationTools } from "./accessibility.js";
import { screenshotContent } from "./capture.js";
import { WorkerClient, type WorkerClientOptions } from "./client.js";
import { nativeWorkerLaunch } from "./launcher.js";
import { ocrParameters } from "./ocr.js";
import { pointerTools } from "./pointer.js";
import { waitTools } from "./waits.js";

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
    timeoutMs: options.timeoutMs ?? 90_000,
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
    const result = await worker.execute(
      "operation_end",
      {},
      undefined,
      operationId,
    );
    if (!result.ok)
      throw new Error(
        String(
          result.error ??
            "STOP_CLEANUP_FAILED: desktop ownership was not released",
        ),
      );
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
  for (const { action, parameters } of observationTools) {
    pi.registerTool({
      name: `windows_computer_use_${action}`,
      label: action.replaceAll("_", " "),
      description:
        "Observe Windows accessibility without physical input. Element references require fresh observation; partial results are explicitly marked.",
      parameters: Type.Unsafe<Record<string, unknown>>(parameters),
      executionMode: "sequential",
      async execute(_toolCallId, args, signal, _onUpdate, ctx) {
        const result = await executeDesktop(action, args, signal, ctx);
        return screenshotContent(result);
      },
    });
  }
  for (const { action, parameters } of [...controlTools, ...pointerTools]) {
    pi.registerTool({
      name: `windows_computer_use_${action}`,
      label: action.replaceAll("_", " "),
      description:
        action === "set_value"
          ? 'Set a native control value or browser field; "new-tab" opens an isolated browser tab and "<tab>:address" navigates it. Physical fallbacks stay guarded.'
          : ["click", "double_click", "move", "drag"].includes(action)
            ? "Operate the intended desktop pointer target with identity, occlusion and cancellation guards. Background dispatch remains unverified; observe effects before retrying."
            : "Operate freshly observed controls in the background, escalating only supported needs-input fallbacks through guarded pointer input. Observe effects to verify task success.",
      parameters: Type.Unsafe<Record<string, unknown>>(parameters),
      executionMode: "sequential",
      async execute(_toolCallId, args, signal, _onUpdate, ctx) {
        const result = await executeDesktop(action, args, signal, ctx);
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          details: result,
          isError: !result.ok,
        };
      },
    });
  }
  pi.registerTool({
    name: "windows_computer_use_screenshot",
    label: "Screenshot",
    description:
      "Capture a Windows window or desktop without UI Automation. Returns a PNG and screen-coordinate bounds; flagged fallbacks may show occluding content.",
    parameters: Type.Object({
      scope: Type.Optional(
        Type.Union([Type.Literal("active_window"), Type.Literal("desktop")], {
          default: "active_window",
        }),
      ),
      browserTab: Type.Optional(Type.String({ minLength: 1 })),
      windowTitle: Type.Optional(Type.String({ minLength: 1 })),
      processId: Type.Optional(Type.Integer({ minimum: 1 })),
      nativeWindowHandle: Type.Optional(Type.Integer({ minimum: 1 })),
      activate: Type.Optional(Type.Boolean({ default: false })),
      maxWidth: Type.Optional(
        Type.Integer({ minimum: 0, maximum: 7680, default: 1600 }),
      ),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, args, signal, _onUpdate, ctx) {
      return screenshotContent(
        await executeDesktop("screenshot", args, signal, ctx),
      );
    },
  });
  pi.registerTool({
    name: "windows_computer_use_ocr",
    label: "OCR",
    description:
      "Read screen text with literal query matching and screen-space bounds. OCR candidates are not control IDs; occluded captures remain inconclusive.",
    parameters: Type.Unsafe<Record<string, unknown>>(ocrParameters),
    executionMode: "sequential",
    async execute(_id, args, signal, _onUpdate, ctx) {
      return screenshotContent(await executeDesktop("ocr", args, signal, ctx));
    },
  });
  for (const { action, parameters } of waitTools)
    pi.registerTool({
      name: `windows_computer_use_${action}`,
      label: action.replaceAll("_", " "),
      description:
        "Wait explicitly without claiming action success. Conditions return observed, timeout or inconclusive evidence; waits are bounded and cancellable.",
      parameters: Type.Unsafe<Record<string, unknown>>(parameters),
      executionMode: "sequential",
      async execute(_id, args, signal, _onUpdate, ctx) {
        return screenshotContent(
          await executeDesktop(action, args, signal, ctx),
        );
      },
    });
  pi.on("session_shutdown", async () => {
    await worker.dispose();
  });
}

export default function computerUse(pi: ExtensionAPI): void {
  registerComputerUse(pi);
}
