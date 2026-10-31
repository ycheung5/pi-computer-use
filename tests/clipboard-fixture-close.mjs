// A timed-out fixture command may still mutate the clipboard later.
// Keep the owner and its pipes until a dispatched command replies.
export async function runFixtureCommand(state, dispatch) {
  if (state.unconfirmed) throw Error("fixture command settlement unconfirmed");
  state.unconfirmed = true;
  const reply = await dispatch();
  state.unconfirmed = false;
  return reply;
}

// Test-runner cleanup only: preserve an owner that has not confirmed exit.
export function detachFixture(fixture) {
  for (const stream of [fixture.stdin, fixture.stdout, fixture.stderr])
    stream?.destroy();
  fixture.unref();
}

export async function waitForFixtureClose(fixture, closed, timeoutMs = 3000) {
  let timer;
  try {
    await Promise.race([
      closed,
      new Promise((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              Error("fixture process cleanup unconfirmed: exit timed out"),
            ),
          timeoutMs,
        );
      }),
    ]);
  } catch (error) {
    // The fixture might still own clipboard data. Do not kill it. Disconnect
    // inherited pipes and unref the child so the runner can report uncertainty.
    detachFixture(fixture);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
