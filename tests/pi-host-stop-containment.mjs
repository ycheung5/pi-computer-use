// Do not start physical input until the real Pi host and its descendants have
// independently verified containment. The standalone containment preflight
// does not yet establish that property for this host launcher.
export function requireHostContainment() {
  throw new Error(
    "HOST_CONTAINMENT_UNVERIFIED: the real Pi host and its descendants are not independently contained; no input dispatched",
  );
}
