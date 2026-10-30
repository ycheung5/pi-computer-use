import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("an unconfirmed supervised process preserves its workspace", () => {
  const run = spawnSync(
    process.execPath,
    ["tests/owner-supervisor-lifecycle-check.mjs"],
    {
      encoding: "utf8",
    },
  );
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout), {
    unconfirmedRetained: true,
    confirmedRemoved: true,
  });
});
