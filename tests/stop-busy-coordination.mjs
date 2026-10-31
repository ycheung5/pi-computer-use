import { createInterface } from "node:readline";

export function waitForStart(input, timeoutMs) {
  return new Promise((resolve, reject) => {
    const lines = createInterface({ input, terminal: false });
    let done = false;
    const finish = (error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      lines.close();
      error ? reject(error) : resolve();
    };
    const timer = setTimeout(
      () => finish(new Error("START_GATE_TIMEOUT")),
      timeoutMs,
    );
    lines.once("line", (line) =>
      finish(line === "start" ? null : new Error("START_GATE_INVALID")),
    );
    lines.once("close", () => finish(new Error("START_GATE_CLOSED")));
  });
}

export async function observeReleased(observe, delay, maxObservations = 11) {
  for (let i = 1; i <= maxObservations; i++) {
    const state = await observe();
    if (state.keysReleased || i === maxObservations)
      return { ...state, observations: i };
    await delay(500);
  }
  throw new Error("INVALID_OBSERVATION_LIMIT");
}
