export function compareEditorObservation(
  element: { value?: unknown },
  fixtureValue: string,
): { fixtureValue: string; uiaAvailability: "available" | "unavailable" };
export function isSafeClipboardRefusal(result: {
  ok?: unknown;
  error?: unknown;
}): boolean;

export function inputCleanupConfirmed(
  result:
    | {
        action?: unknown;
        ok?: unknown;
        error?: unknown;
        cleanupConfirmed?: unknown;
        clipboardCleanupConfirmed?: unknown;
      }
    | undefined,
): boolean;

export function referenceActivationCleanupConfirmed(
  result:
    | {
        action?: unknown;
        ok?: unknown;
        cleanupConfirmed?: unknown;
        inputCleanupConfirmed?: unknown;
        keyboardCleanupConfirmed?: unknown;
        cleanupVerification?: unknown;
      }
    | undefined,
): boolean;
export function retainUnconfirmedOwner(): Promise<never>;
