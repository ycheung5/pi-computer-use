import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { observationTools } from "./accessibility.js";
import { WorkerClient, type WorkerClientOptions } from "./client.js";
import { nativeWorkerLaunch } from "./launcher.js";

export function registerComputerUse(
  pi: Pick<ExtensionAPI, "registerTool" | "on">,
  options: WorkerClientOptions = { launch: nativeWorkerLaunch },
): void {
  const worker = new WorkerClient({
    ...options,
    timeoutMs: options.timeoutMs ?? 90_000,
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
    async execute(_toolCallId, args, signal) {
      const result = await worker.execute("list_windows", args, signal);
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
      async execute(_toolCallId, args, signal) {
        const result = await worker.execute(action, args, signal);
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          details: result,
          isError: !result.ok,
        };
      },
    });
  }
  pi.on("session_shutdown", async () => {
    await worker.dispose();
  });
}

export default function computerUse(pi: ExtensionAPI): void {
  registerComputerUse(pi);
}
