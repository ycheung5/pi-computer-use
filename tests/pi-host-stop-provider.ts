// Scripted provider drives the real Pi host; it does not exercise a real model.
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default async function provider(pi: ExtensionAPI): Promise<void> {
  if (process.env.PI_CU_HOST_STOP_COMMAND) {
    const { readFileSync, appendFileSync } = await import("node:fs");
    const { registerComputerUse } = await import("../dist/extension.js");
    const { nativeWorkerLaunch } = await import("../dist/launcher.js");
    const { commandGuard, commandObserver } = await import(
      new URL("./pi-host-command.mjs", import.meta.url).href
    );
    const config = JSON.parse(process.env.PI_CU_HOST_STOP_COMMAND);
    let fixtureFault = false;
    const record = (row: unknown) => {
      try {
        appendFileSync(config.fixtureTrace, JSON.stringify(row) + "\n", {
          mode: 0o600,
        });
      } catch (error) {
        fixtureFault = true;
        throw error;
      }
    };
    pi.on("tool_call", (event) =>
      fixtureFault
        ? {
            block: true,
            reason: "PASSIVE_COMMAND_SCOPE: prior fixture audit fault",
          }
        : commandGuard(
            event,
            () => JSON.parse(readFileSync(config.journal, "utf8")),
            record,
          ),
    );
    registerComputerUse(pi, {
      launch: async (signal) => {
        const real = await nativeWorkerLaunch(signal);
        if (
          !/[\\/]node\.exe$/i.test(real.executable) ||
          !real.args?.[0]?.endsWith("worker.js")
        )
          throw Error("REAL_WINDOWS_WORKER_REQUIRED");
        return {
          ...real,
          args: ["--import", commandObserver(config.trace), ...real.args],
        };
      },
    });
    const expose = () =>
      pi.setActiveTools([
        "windows_computer_use_health",
        "windows_computer_use_wait",
      ]);
    pi.on("session_start", expose);
    pi.on("before_agent_start", (event) => {
      expose();
      record({ type: "before_agent_start", messageType: event.messageType });
    });
    pi.registerCommand("fixture-command-retry", {
      handler: async () => {
        pi.sendMessage(
          {
            customType: "passive-stop-retry",
            content: "Attempt the scripted same-operation retry.",
            display: false,
          },
          { triggerTurn: true },
        );
      },
    });
    const passive = fauxProvider({
      provider: "pi-cu-stop-host",
      api: "pi-cu-stop-host-fixture",
      models: [{ id: "fixture", contextWindow: 200000, maxTokens: 2000 }],
    });
    const tool = (name: string, args: Record<string, number>) =>
      fauxAssistantMessage(fauxToolCall(name, args), { stopReason: "toolUse" });
    passive.setResponses([
      tool("windows_computer_use_health", {}),
      tool("windows_computer_use_wait", { milliseconds: 30000 }),
      tool("windows_computer_use_wait", { milliseconds: 30000 }),
      fauxAssistantMessage("Custom retry phase finished."),
      tool("windows_computer_use_health", {}),
      tool("windows_computer_use_wait", { milliseconds: 1 }),
      fauxAssistantMessage("Fresh user recovery finished."),
    ]);
    pi.registerProvider(passive.provider);
    return;
  }
  const target = JSON.parse(process.env.PI_CU_HOST_STOP_TARGET ?? "{}");
  if (
    !Number.isSafeInteger(target.nativeWindowHandle) ||
    !Number.isSafeInteger(target.processId)
  )
    throw new Error("PI_CU_HOST_STOP_TARGET_INVALID");
  const faux = fauxProvider({
    provider: "pi-cu-stop-host",
    api: "pi-cu-stop-host-fixture",
    models: [{ id: "fixture", contextWindow: 200000, maxTokens: 2000 }],
  });
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall("windows_computer_use_health", {}), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage(
      fauxToolCall("windows_computer_use_type_text", {
        ...target,
        text: "x".repeat(2000),
        method: "sendinput",
        activate: true,
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("Scripted host fixture finished."),
  ]);
  pi.registerProvider(faux.provider);
}
