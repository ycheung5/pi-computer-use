// Test-runner lifecycle only: physical input may continue after a rejected call.
export function actionMaySendInput(engine, action) {
  return (
    ["click", "double_click", "move", "scroll", "drag"].includes(action) ||
    (engine === "reference" && action === "activate_window")
  );
}

export async function runPointerInput(state, action, dispatch) {
  if (state.unconfirmed) throw Error("Prior pointer input is unconfirmed");
  state.unconfirmed = true;
  const result = await dispatch();
  state.unconfirmed =
    result?.action !== action ||
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
