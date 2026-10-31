import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

test("visual host keeps owned scope and failures closed", () => {
  assert.match(
    execFileSync(process.execPath, ["tests/pi-visual-check.mjs"], {
      encoding: "utf8",
    }),
    /checks passed/,
  );
});

test("visual model host defaults to a side-effect-free plan", () => {
  const plan = JSON.parse(
    execFileSync(process.execPath, ["tests/pi-visual-host.mjs"], {
      encoding: "utf8",
    }),
  );
  assert.equal(plan.run, false);
  assert.equal(plan.scenario, "owned visual association");
  assert.equal(plan.physicalInput, false);
});
