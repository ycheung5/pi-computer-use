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
    for (const [action, options] of [
      ["snapshot", { maxDepth: -1 }],
      ["snapshot", { maxDepth: 13 }],
      ["snapshot", { maxNodes: 0 }],
      ["snapshot", { maxNodes: 2001 }],
      ["accessibility_tree", { maxNodes: 3001 }],
      ["find", { query: "fixture", maxNodes: 5001 }],
      ["find", { query: "fixture", maxResults: 201 }],
      ["snapshot", { maxWidth: -1 }],
      ["snapshot", { maxWidth: 7681 }],
      ["wait_for", { condition: "element", query: "fixture", maxDepth: 13 }],
    ] as const) {
      const result = await client.execute(action, {
        browserTab: "t123",
        ...options,
      });
      assert.equal(result.ok, false);
      assert.match(String(result.error), /INVALID_ARGUMENTS/, action);
    }
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
      ["--live-orphan", "controlled-live-browser-dead-lease-owner"],
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

test("controlled orphan fixture refuses changed or unknown ownership facts without setup", () => {
  const server = fileURLToPath(
    new URL("./browser-profiles-server.mjs", import.meta.url),
  );
  const expected = {
    processId: 42,
    creationDate: "known-birth",
    executable: "C:\\owned\\msedge.exe",
    profile: { path: "C:\\owned\\kept-edge" },
  };
  const valid = {
    expected,
    current: expected,
    writerPresent: false,
    lease: "original bytes",
    originalLease: "original bytes",
  };
  const proof = (v: object) => {
    const result = spawnSync(
      process.execPath,
      [server, "--orphan-proof-check", JSON.stringify(v)],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout).ok;
  };
  assert.equal(proof(valid), true);
  for (const changed of [
    undefined,
    { ...expected, processId: 43 },
    { ...expected, creationDate: "reused" },
    { ...expected, executable: "C:\\other.exe" },
    { ...expected, profile: { path: "C:\\other" } },
  ])
    assert.equal(proof({ ...valid, current: changed }), false);
  for (const writerPresent of [true, undefined])
    assert.equal(proof({ ...valid, writerPresent }), false);
  assert.equal(proof({ ...valid, lease: "rewritten token" }), false);
  assert.equal(proof({ ...valid, expected: {}, current: {} }), false);
});
