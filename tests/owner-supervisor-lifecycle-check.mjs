// Real, no-input child reports exercise the same workspace lifecycle seam.
import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ownerWorkspace } from "./owner-supervisor-workspace.mjs";

if (process.argv[2] === "--report") {
  console.log(
    JSON.stringify({
      reason: "timeout",
      activeProcesses: Number(process.argv[3]),
      totalProcesses: 1,
    }),
  );
} else {
  const script = fileURLToPath(import.meta.url);
  const unknown = ownerWorkspace("pi-cu-unconfirmed-test-");
  try {
    assert.throws(() =>
      unknown.run(process.execPath, [script, "--report", "1"]),
    );
    assert.equal(unknown.cleanup(), false);
    assert.equal(existsSync(unknown.folder), true);
  } finally {
    // Only the known synthetic reporter was run, and spawnSync reaped it.
    rmSync(unknown.folder, { recursive: true, force: true });
  }
  const confirmed = ownerWorkspace("pi-cu-confirmed-test-");
  confirmed.run(process.execPath, [script, "--report", "0"]);
  assert.equal(confirmed.cleanup(), true);
  assert.equal(existsSync(confirmed.folder), false);
  console.log(
    JSON.stringify({ unconfirmedRetained: true, confirmedRemoved: true }),
  );
}
