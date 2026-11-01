// Assess retained evidence without dispatching input.
export function assessDrop({ dispatch, state, observationError }) {
  const value = dispatch?.value;
  const explicitlyUnconfirmed =
    value?.cleanupConfirmed === false ||
    value?.inputCleanupConfirmed === false ||
    value?.buttonCleanupConfirmed === false ||
    ["unconfirmed", "held", "failed"].includes(value?.cleanupVerification);
  const released =
    !observationError &&
    dispatch?.status === "fulfilled" &&
    typeof value?.ok === "boolean" &&
    value?.action === "drag" &&
    value?.cleanupConfirmed === true &&
    !explicitlyUnconfirmed &&
    state?.held === 0;
  return {
    ok: released && value?.ok === true && state?.drops === 1,
    cleanupVerification: released ? "released" : "unconfirmed",
  };
}
