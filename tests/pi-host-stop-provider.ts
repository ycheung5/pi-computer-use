// Scripted provider drives the real Pi host; it does not exercise a real model.
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default async function provider(pi: ExtensionAPI): Promise<void> {
  if (process.env.PI_CU_HOST_STOP_PREFLIGHT === "1") {
    // The only pointer request has a deliberately invalid HWND/PID. No fallback.
    pi.on("tool_call", (event) => {
      const a = event.input;
      const health =
        event.toolName === "windows_computer_use_health" &&
        Object.keys(a).length === 0;
      const wait =
        event.toolName === "windows_computer_use_wait" &&
        JSON.stringify(a) === JSON.stringify({ milliseconds: 30000 });
      const invalid =
        event.toolName === "windows_computer_use_click" &&
        JSON.stringify(a) ===
          JSON.stringify({ x: 0, y: 0, nativeWindowHandle: 1, processId: 1 });
      if (!health && !wait && !invalid)
        return { block: true, reason: "NO_INPUT_PREFLIGHT_SCOPE" };
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
      tool("windows_computer_use_click", {
        x: 0,
        y: 0,
        nativeWindowHandle: 1,
        processId: 1,
      }),
      tool("windows_computer_use_health", {}),
      tool("windows_computer_use_wait", { milliseconds: 30000 }),
      fauxAssistantMessage("No-input host preflight finished."),
    ]);
    pi.registerProvider(passive.provider);
    return;
  }
  if (process.env.PI_CU_HOST_STOP_COMMAND) {
    const { readFileSync, appendFileSync } = await import("node:fs");
    // Load built runtime modules while checking their types before a build exists.
    const { registerComputerUse } = (await import(
      new URL("../dist/extension.js", import.meta.url).href
    )) as typeof import("../src/extension.js");
    const { nativeWorkerLaunch } = (await import(
      new URL("../dist/launcher.js", import.meta.url).href
    )) as typeof import("../src/launcher.js");
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
          ...(config.workerCwd ? { cwd: config.workerCwd } : {}),
          args: [
            "--import",
            commandObserver(config.workerTrace ?? config.trace),
            ...real.args,
          ],
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
  const gate = process.env.PI_CU_HOST_STOP_GATE;
  if (!gate) throw new Error("PI_CU_HOST_STOP_GATE_REQUIRED");
  let authorized = false,
    typed = false,
    initialized = false;
  const textArgs = {
    ...target,
    text: "x".repeat(2000),
    method: "sendinput",
    activate: true,
  };
  pi.on("tool_call", (event) => {
    const a = JSON.stringify(event.input);
    if (event.toolName === "windows_computer_use_health" && a === "{}") return;
    if (
      event.toolName === "windows_computer_use_click" &&
      !initialized &&
      a === JSON.stringify({ x: 0, y: 0, nativeWindowHandle: 1, processId: 1 })
    ) {
      initialized = true;
      return;
    }
    if (
      event.toolName === "windows_computer_use_type_text" &&
      authorized &&
      !typed &&
      a === JSON.stringify(textArgs)
    ) {
      typed = true;
      return;
    }
    return { block: true, reason: "OWNED_STOP_FIXTURE_SCOPE" };
  });
  const faux = fauxProvider({
    provider: "pi-cu-stop-host",
    api: "pi-cu-stop-host-fixture",
    models: [{ id: "fixture", contextWindow: 200000, maxTokens: 2000 }],
  });
  const health = () =>
    fauxAssistantMessage(fauxToolCall("windows_computer_use_health", {}), {
      stopReason: "toolUse",
    });
  faux.setResponses([
    health(),
    fauxAssistantMessage(
      fauxToolCall("windows_computer_use_click", {
        x: 0,
        y: 0,
        nativeWindowHandle: 1,
        processId: 1,
      }),
      { stopReason: "toolUse" },
    ),
    health(),
    async (_context, options) => {
      const { readFile, unlink } = await import("node:fs/promises");
      const { setTimeout } = await import("node:timers/promises");
      const deadline = Date.now() + 120000;
      while (true) {
        options?.signal?.throwIfAborted();
        try {
          if ((await readFile(gate, "utf8")) !== "authorized")
            throw new Error("INVALID_INPUT_GATE");
          await unlink(gate);
          authorized = true;
          break;
        } catch (error) {
          if (
            !(error instanceof Error) ||
            !("code" in error) ||
            error.code !== "ENOENT"
          )
            throw error;
        }
        if (Date.now() > deadline) throw new Error("INPUT_GATE_TIMEOUT");
        await setTimeout(25, undefined, { signal: options?.signal });
      }
      return fauxAssistantMessage(
        fauxToolCall("windows_computer_use_type_text", textArgs),
        { stopReason: "toolUse" },
      );
    },
    health(),
    fauxAssistantMessage("Scripted host fixture finished."),
  ]);
  pi.registerProvider(faux.provider);
}
