import { randomUUID } from "node:crypto";
import { WorkerClient } from "./client.js";
import { compileNative } from "./native.js";
import type { WorkerResult } from "./protocol.js";
import type { PersonalSettings } from "./settings.js";

export class StopListener {
  private operationId: string | undefined;
  private listenerProcessId: number | undefined;
  private cancelEvent: string | undefined;
  private readonly control: WorkerClient;
  private started = false;
  private configuration: PersonalSettings | undefined;
  private settingsKey = "";

  constructor(onStop: (operationId: string) => void) {
    this.control = new WorkerClient({
      launch: (signal) =>
        compileNative(
          ["stop.cs", "indicators.cs"],
          ["System.Drawing.dll", "System.Windows.Forms.dll"],
          signal,
        ),
      onStop,
    });
  }
  get hasStarted(): boolean {
    return this.started;
  }
  get currentOperation(): string | undefined {
    return this.operationId;
  }

  async configure(settings: PersonalSettings): Promise<void> {
    const previous = this.configuration;
    this.configuration = settings;
    const key = JSON.stringify([
      settings.indicatorEnabled,
      settings.cursorIndicatorEnabled,
      settings.remoteIndicatorVisible,
      settings.indicatorText,
      settings.indicatorPosition,
      settings.indicatorIdleMs,
      settings.stopShortcut,
    ]);
    if (this.started && key !== this.settingsKey) {
      this.settingsKey = key;
      const result = await this.control.execute("configure", { settings });
      if (!result.ok) throw new Error(String(result.error));
    }
    if (previous && settings.previewToken !== previous.previewToken)
      await this.preview(settings, true);
  }
  private async start(signal?: AbortSignal): Promise<void> {
    if (this.started) return;
    if (!this.configuration) throw new Error("STOP_SETTINGS_UNAVAILABLE");
    const result = await this.control.execute(
      "configure",
      { settings: this.configuration },
      signal,
    );
    if (!result.ok) throw new Error(String(result.error));
    this.started = true;
    this.settingsKey = JSON.stringify([
      this.configuration.indicatorEnabled,
      this.configuration.cursorIndicatorEnabled,
      this.configuration.remoteIndicatorVisible,
      this.configuration.indicatorText,
      this.configuration.indicatorPosition,
      this.configuration.indicatorIdleMs,
      this.configuration.stopShortcut,
    ]);
  }
  async arm(operationId: string, signal?: AbortSignal): Promise<WorkerResult> {
    await this.start(signal);
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
    const status = await this.control.execute("status", {}, signal);
    return {
      ...status,
      action: "prepare_input",
      hookInstalled: true,
      cancelEvent: this.cancelEvent,
      listenerProcessId: this.listenerProcessId,
      inputReady: true,
      readyActions: [
        "click",
        "double_click",
        "move",
        "drag",
        "scroll",
        "type_text",
        "keypress",
      ],
      note: "Pointer and keyboard actions implement cancellation polling and held-input cleanup.",
    };
  }
  async inputStarted(operationId: string): Promise<void> {
    if (this.operationId !== operationId)
      throw new Error("STOP_OPERATION_NOT_ARMED");
    const result = await this.control.execute("begin", { operationId });
    if (!result.ok) throw new Error(String(result.error));
  }
  async touch(operationId: string): Promise<void> {
    if (this.started && this.operationId === operationId)
      await this.control.execute("touch", { operationId });
  }
  async suspendCapture(suspended: boolean): Promise<void> {
    if (this.started) await this.control.execute("capture", { suspended });
  }
  async preview(
    settings: PersonalSettings,
    show: boolean,
  ): Promise<WorkerResult> {
    await this.configure(settings);
    await this.start();
    return this.control.execute("preview", { show });
  }
  async status(): Promise<WorkerResult> {
    if (!this.started)
      return {
        ok: true,
        action: "status",
        started: false,
        hookInstalled: false,
        presentation: { visible: false },
      };
    return { ...(await this.control.execute("status", {})), started: true };
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
