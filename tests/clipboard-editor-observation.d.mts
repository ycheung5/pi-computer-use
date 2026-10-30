export function compareEditorObservation(
  element: { value?: unknown },
  fixtureValue: string,
): { fixtureValue: string; uiaAvailability: "available" | "unavailable" };
