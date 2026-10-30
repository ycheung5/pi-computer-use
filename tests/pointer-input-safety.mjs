// Test-runner lifecycle only: physical input may continue after a rejected call.
export async function runPointerInput(state, dispatch) {
  if (state.unconfirmed) throw Error("Prior pointer input is unconfirmed");
  state.unconfirmed = true;
  const result = await dispatch();
  state.unconfirmed =
    result?.cleanupConfirmed !== true ||
    result?.inputCleanupConfirmed === false ||
    result?.buttonCleanupConfirmed === false ||
    ["unconfirmed", "held", "failed"].includes(result?.cleanupVerification);
  return result;
}

// An unresolved promise does not keep the Node event loop alive by itself.
export async function retainPointerOwner() {
  const keepAlive = setInterval(() => {}, 1000);
  try {
    await new Promise(() => {});
  } finally {
    clearInterval(keepAlive);
  }
}
