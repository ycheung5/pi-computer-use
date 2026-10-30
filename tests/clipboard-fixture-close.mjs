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
