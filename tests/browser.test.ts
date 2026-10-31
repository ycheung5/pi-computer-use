import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

test("browser tools validate options before touching a document", async () => {
  const client = worker();
  try {
    const unknown = await client.execute("accessibility_tree", {
      browserTab: "t123",
      fabricatedOption: true,
    });
    assert.match(String(unknown.error), /INVALID_ARGUMENTS.*unknown/);
    const missingQuery = await client.execute("find", { browserTab: "t123" });
    assert.match(String(missingQuery.error), /INVALID_ARGUMENTS.*query/);
  } finally {
    await client.dispose();
  }
});

test("profile fixture plans need no backend, dependency tree or fixture files", () => {
  const folder = mkdtempSync(join(tmpdir(), "pi-profile-reconnect-plan-"));
  try {
    const script = join(folder, "browser-profiles-host.mjs");
    writeFileSync(
      script,
      readFileSync(
        fileURLToPath(new URL("./browser-profiles-host.mjs", import.meta.url)),
      ),
    );
    for (const [flag, mode] of [
      ["--reconnect", "same-worker-reconnect"],
      ["--cleanup-control", "missing-lease-cleanup-control"],
      ["--dispose-only", "temporary-profile-disposal"],
    ] as const) {
      const app = flag === "--dispose-only" ? "firefox" : "edge";
      const result = spawnSync(
        process.execPath,
        [script, app, flag, "--plan"],
        { encoding: "utf8" },
      );
      assert.equal(result.status, 0, result.stderr);
      const plan = JSON.parse(result.stdout);
      assert.equal(plan.executed, false);
      assert.equal(plan.mode, mode);
      assert.equal(plan.app, app);
      assert.equal(plan.physicalInput, false);
      assert.equal(plan.dailyProfile, false);
      assert.deepEqual(readdirSync(folder), ["browser-profiles-host.mjs"]);
    }
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
