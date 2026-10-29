import { randomUUID } from "node:crypto";
import { WorkerClient } from "./client.js";
import { compileNative } from "./native.js";
import type { WorkerResult } from "./protocol.js";

export class StopListener {
  private operationId: string | undefined;
  private listenerProcessId: number | undefined;
  private cancelEvent: string | undefined;
  private readonly control: WorkerClient;

  constructor(onStop: (operationId: string) => void) {
    this.control = new WorkerClient({
      launch: (signal) => compileNative(["stop.cs"], [], signal),
      onStop,
    });
  }

  async arm(operationId: string, signal?: AbortSignal): Promise<WorkerResult> {
    if (this.operationId !== operationId) {
      this.cancelEvent = `Local\\PiComputerUseStop-${process.pid}-${randomUUID()}`;
      const result = await this.control.execute(
        "arm",
        { operationId, cancelEvent: this.cancelEvent },
        signal,
      );
      if (!result.ok) return result;
      this.listenerProcessId = Number(result.listenerProcessId);
      this.operationId = operationId;
    }
    return {
      ok: true,
      action: "prepare_input",
      hookInstalled: true,
      cancelEvent: this.cancelEvent,
      listenerProcessId: this.listenerProcessId,
      inputReady: true,
      readyActions: ["click", "double_click", "move", "drag", "scroll"],
      note: "Pointer actions implement cancellation polling and button cleanup. Keyboard input remains gated.",
    };
  }

  async signal(operationId: string): Promise<void> {
    if (this.operationId === operationId)
      await this.control.execute("stop", { operationId });
  }

  async disarm(operationId: string): Promise<void> {
    if (this.operationId !== operationId) return;
    await this.control.execute("disarm", { operationId });
    this.operationId = undefined;
    this.cancelEvent = undefined;
  }

  async dispose(): Promise<void> {
    await this.control.dispose();
  }
}
