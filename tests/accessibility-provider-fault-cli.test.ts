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
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const source = fileURLToPath(
  new URL("./accessibility-comparison.mjs", import.meta.url),
);

test("provider unavailable plan needs no backend, build, Windows, or user desktop", () => {
  const folder = mkdtempSync(join(tmpdir(), "pi-provider-fault-plan-"));
  try {
    const script = join(folder, "accessibility-comparison.mjs");
    writeFileSync(script, readFileSync(source));
    const plan = spawnSync(
      process.execPath,
      [script, "--provider-unavailable-only", "--plan"],
      {
        env: {
          ...process.env,
          PI_CU_RELEASE_OUTPUT: join(folder, "must-not-exist"),
        },
        encoding: "utf8",
      },
    );
    assert.equal(plan.status, 0, plan.stderr);
    const result = JSON.parse(plan.stdout);
    assert.equal(result.executed, false);
    assert.equal(result.physicalInput, false);
    assert.deepEqual(result.engines, ["reference", "pi"]);
    assert.deepEqual(result.cases, ["provider.unavailable"]);
    assert.deepEqual(readdirSync(folder), ["accessibility-comparison.mjs"]);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("provider fault report distinguishes explicit partial failure from OS normalization", () => {
  const folder = mkdtempSync(join(tmpdir(), "pi-provider-fault-report-"));
  try {
    const script = join(folder, "accessibility-comparison.mjs");
    writeFileSync(script, readFileSync(source));
    const check = (name: string, evidence: object, expected: string) => {
      const path = join(folder, `${name}.json`);
      writeFileSync(path, JSON.stringify(evidence));
      const result = spawnSync(
        process.execPath,
        [script, `--provider-unavailable-report=${path}`],
        { encoding: "utf8" },
      );
      assert.equal(result.status, expected === "pass" ? 0 : 1, result.stderr);
      const report = JSON.parse(result.stdout);
      assert.equal(report.status, expected);
      assert.equal(report.executed, false);
      assert.equal(report.physicalInput, false);
    };
    check(
      "partial",
      {
        entered: "provider:entered:unavailable",
        returned: {
          result: {
            ok: true,
            providerError: "fault",
            truncated: true,
            conclusive: false,
          },
        },
      },
      "pass",
    );
    check(
      "normalized",
      {
        entered: "provider:entered:unavailable",
        returned: { result: { ok: true, truncated: false } },
      },
      "blocked",
    );
    check(
      "missing-result-status",
      {
        entered: "provider:entered:unavailable",
        returned: {
          result: {
            providerError: "fault",
            truncated: true,
            conclusive: false,
          },
        },
      },
      "blocked",
    );
    check(
      "misleading",
      {
        entered: "provider:entered:unavailable",
        returned: {
          result: {
            ok: true,
            providerError: "fault",
            truncated: false,
            conclusive: true,
          },
        },
      },
      "fail",
    );
    check(
      "unentered",
      {
        returned: { result: { ok: false, error: "UIA_PROVIDER_ERROR: fault" } },
      },
      "blocked",
    );
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("platform provider probe plan needs no backend, Windows, or desktop", () => {
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL("./provider-platform-probe.mjs", import.meta.url)),
      "--plan",
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.executed, false);
  assert.equal(plan.physicalInput, false);
  assert.deepEqual(plan.cases, ["provider.platform-normalization"]);
  assert.equal(plan.fromHandleBeforeArm, true);
});

test("instrumented reference walker probe plans offline and refuses a mismatched backend", () => {
  const script = fileURLToPath(
    new URL("./provider-walker-probe.mjs", import.meta.url),
  );
  const plan = spawnSync(process.execPath, [script, "--plan"], {
    encoding: "utf8",
  });
  assert.equal(plan.status, 0, plan.stderr);
  assert.deepEqual(JSON.parse(plan.stdout).cases, [
    "provider.reference-walker",
  ]);
  const folder = mkdtempSync(join(tmpdir(), "pi-walker-patch-"));
  try {
    const input = join(folder, "in.ps1"),
      output = join(folder, "out.ps1");
    writeFileSync(input, "unexpected backend version");
    const result = spawnSync(
      process.execPath,
      [script, "--instrument", input, output],
      { encoding: "utf8" },
    );
    assert.notEqual(result.status, 0);
    assert.deepEqual(readdirSync(folder), ["in.ps1"]);
    const anchor =
      "      $child = $Traversal.walker.GetFirstChild($Element, $Traversal.cache)";
    writeFileSync(input, `${anchor}\n${anchor}`);
    const duplicate = spawnSync(
      process.execPath,
      [script, "--instrument", input, output],
      { encoding: "utf8" },
    );
    assert.notEqual(duplicate.status, 0);
    assert.deepEqual(readdirSync(folder), ["in.ps1"]);
    writeFileSync(input, `before\n${anchor}\nafter`);
    const valid = spawnSync(
      process.execPath,
      [script, "--instrument", input, output],
      { encoding: "utf8" },
    );
    assert.equal(valid.status, 0, valid.stderr);
    const patch = readFileSync(output, "utf8");
    assert.ok(patch.indexOf("PI_CU_WALKER_READY") < patch.indexOf(anchor));
    assert.equal(patch.split(anchor).length, 2);
    assert.equal(readFileSync(input, "utf8"), `before\n${anchor}\nafter`);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
