import assert from "node:assert/strict";

export function validateDiscoveryTrace(events) {
  assert.ok(
    !events.some((event) => event.request === "tools/call"),
    "No tool call is permitted",
  );
}

export function validateModelRoster(discovered, modelNames) {
  assert.ok(
    Array.isArray(discovered) && discovered.length > 0,
    "Reference roster must not be empty",
  );
  assert.equal(
    new Set(discovered).size,
    discovered.length,
    "Discovered roster contains duplicate names",
  );
  assert.ok(Array.isArray(modelNames), "Model roster missing");
  const actual = modelNames.filter((name) => name.startsWith("mcp__wincu__"));
  const expected = discovered.map((name) => `mcp__wincu__${name}`);
  assert.equal(
    new Set(actual).size,
    actual.length,
    "Model roster contains duplicate reference names",
  );
  assert.deepEqual(
    [...actual].sort(),
    [...expected].sort(),
    "Model roster must match the discovered reference roster exactly",
  );
}

export async function closeProvider(server, failure, timeoutMs) {
  let timer;
  try {
    await Promise.race([
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(Error("Synthetic provider close timed out")),
          timeoutMs,
        );
      }),
    ]);
    return { confirmed: true, failure };
  } catch (error) {
    return { confirmed: false, failure: failure ?? error, cleanupError: error };
  } finally {
    clearTimeout(timer);
  }
}

export function canRemoveHome({
  processClosed,
  observerCleanupConfirmed,
  groupGone,
  providerCloseConfirmed,
}) {
  return (
    processClosed &&
    observerCleanupConfirmed &&
    groupGone &&
    providerCloseConfirmed
  );
}
