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
        ok?: unknown;
        error?: unknown;
        cleanupConfirmed?: unknown;
        clipboardCleanupConfirmed?: unknown;
      }
    | undefined,
): boolean;

export function retainUnconfirmedOwner(): Promise<never>;
