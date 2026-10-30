export function compareEditorObservation(
  element: { value?: unknown },
  fixtureValue: string,
): { fixtureValue: string; uiaAvailability: "available" | "unavailable" };
export function isSafeClipboardRefusal(result: {
  ok?: unknown;
  error?: unknown;
}): boolean;
