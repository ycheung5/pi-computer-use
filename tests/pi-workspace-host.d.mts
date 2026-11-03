export function workspaceScope(owned: {
  nativeWindowHandle: number;
  processId: number;
  title: string;
}): {
  before(event: {
    toolName: string;
    input?: Record<string, unknown>;
  }): { block: true; reason: string } | undefined;
  after(event: { toolName: string; details?: Record<string, unknown> }): void;
  halt(): void;
  readonly halted: boolean;
};
export function workspaceVerification(facts: {
  settled: boolean;
  unsafe: boolean;
  toolStarts: number;
  auditRows: Record<string, unknown>[];
}): "verify" | "stop" | "retain";
