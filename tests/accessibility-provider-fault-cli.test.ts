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
