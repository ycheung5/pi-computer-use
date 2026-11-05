export function workspaceScope(owned: {
  documentTask?: boolean;
  nativeWindowHandle: number;
  processId: number;
  title: string;
  targets?: { nativeWindowHandle: number; processId: number; title: string }[];
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
export function blankWorkspaceEvidence(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): boolean;

export function refusalWorkspaceEvidence(
  scenario: string,
  verification: Record<string, unknown>,
  audit: Record<string, unknown>[],
): boolean;

export const nativeDocumentText: { initial: string; final: string };
export function documentWorkspaceEvidence(
  outcome: Record<string, unknown> | undefined,
  expectedFinal?: string,
): boolean;

export function documentRecoveryEvidence(
  verification: Record<string, unknown> | undefined,
  audit: Record<string, unknown>[],
): boolean;

export const nativeHandbackText: { edited: string; final: string };
export function documentHandbackEvidence(
  verification: Record<string, unknown> | undefined,
  audit: Record<string, unknown>[],
): boolean;
