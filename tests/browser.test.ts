import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { WorkerClient } from "../src/client.js";

function worker() {
  return new WorkerClient({
    launch: async () => ({
      executable: process.execPath,
      args: [
        "--import",
        "tsx",
        fileURLToPath(new URL("../src/worker.ts", import.meta.url)),
      ],
    }),
  });
}

test("browser navigation refuses unsafe URLs before launching anything", async () => {
  const client = worker();
  try {
    const result = await client.execute("set_value", {
      elementId: "new-tab",
      value: "javascript:alert(1)",
    });
    assert.equal(result.ok, false);
    assert.match(String(result.error), /INVALID_ARGUMENTS.*URL/);
  } finally {
    await client.dispose();
  }
});

test("browser reads reject native coordinates and unknown document references", async () => {
  const client = worker();
  try {
    const mixed = await client.execute("accessibility_tree", {
      browserTab: "t123",
      nativeWindowHandle: 42,
    });
    assert.equal(mixed.ok, false);
    assert.match(String(mixed.error), /INVALID_ARGUMENTS.*combine/);
    const stale = await client.execute("element_info", { elementId: "t123:1" });
    assert.equal(stale.ok, false);
    assert.match(String(stale.error), /STALE_BROWSER_REFERENCE/);
  } finally {
    await client.dispose();
  }
});
