import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("owned text timing plan prepares only the new scoped keyboard cases without desktop access", () => {
  const plan = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL("./native-text.mjs", import.meta.url)),
      "--timing",
      "--plan",
    ],
    { encoding: "utf8" },
  );
  assert.equal(plan.status, 0, plan.stderr);
  const result = JSON.parse(plan.stdout);
  assert.equal(result.executed, false);
  assert.equal(result.physicalInput, true);
  assert.equal(result.clipboard, false);
  assert.equal(result.case, "keyboard-timing");
  assert.equal(result.phase, "all");
  assert.deepEqual(result.cases, [
    "text-pacing-default-zero-25ms",
    "text-short-deadline",
    "text-focus-interruption",
    "text-cancel-long-delay",
    "modifier-aliases",
    "immediate-release",
    "focus-changing-immediate-release",
    "focus-changing-hold",
    "timed-key-and-chord",
    "foreground-error-release",
    "short-deadline-release",
    "cancel-disabled-deadline",
  ]);
});

test("owned timing phases select text or keyboard cases without desktop access", () => {
  for (const phase of ["all", "text", "keyboard"]) {
    const plan = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL("./native-text.mjs", import.meta.url)),
        "--timing",
        `--phase=${phase}`,
        "--plan",
      ],
      { encoding: "utf8" },
    );
    assert.equal(plan.status, 0, plan.stderr);
    const result = JSON.parse(plan.stdout);
    assert.equal(result.executed, false);
    assert.equal(result.clipboard, false);
    assert.equal(result.phase, phase);
    assert.deepEqual(result.cases, [
      ...(phase === "keyboard"
        ? []
        : [
            "text-pacing-default-zero-25ms",
            "text-short-deadline",
            "text-focus-interruption",
            "text-cancel-long-delay",
          ]),
      ...(phase === "text"
        ? []
        : [
            "modifier-aliases",
            "immediate-release",
            "focus-changing-immediate-release",
            "focus-changing-hold",
            "timed-key-and-chord",
            "foreground-error-release",
            "short-deadline-release",
            "cancel-disabled-deadline",
          ]),
    ]);
  }
});

test("owned timing phases reject invalid or unrelated selection before setup", () => {
  for (const args of [["--timing", "--phase=unknown"], ["--phase=keyboard"]]) {
    const plan = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL("./native-text.mjs", import.meta.url)),
        ...args,
        "--plan",
      ],
      { encoding: "utf8" },
    );
    assert.notEqual(plan.status, 0);
  }
});
