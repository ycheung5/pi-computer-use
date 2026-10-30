// Public CLI contract: capture comparison reports independently verified fixture outcomes.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

assert.ok(process.argv[2], "Pass the pinned reference checkout");
let result;
try {
  result = await promisify(execFile)(
    process.execPath,
    [
      fileURLToPath(new URL("./reference-capture.mjs", import.meta.url)),
      process.argv[2],
    ],
    { timeout: 240000, maxBuffer: 8 * 1024 * 1024 },
  );
} catch (error) {
  result = error;
}
const report = JSON.parse(
  result.stdout.split(/\r?\n/).find((line) => line.startsWith('{"ok":')),
);
assert.equal(report.physicalInput, false);
assert.ok(report.artifacts.referenceBackend && report.artifacts.runner);
for (const row of report.cases.filter((row) => row.scenario === "ocr-native"))
  assert.ok(row.observation.oracle.ink && row.observation.paintedInkOffset);
assert.ok(
  report.cases.some(
    (row) =>
      row.engine === "reference" &&
      row.scenario === "normal-scaled" &&
      row.status === "pass",
  ),
);
assert.ok(
  report.cases.some(
    (row) =>
      row.engine === "pi" &&
      row.scenario === "normal-scaled" &&
      row.status === "pass",
  ),
);
assert.ok(
  report.cases.some(
    (row) => row.engine === "reference" && row.scenario === "normal-native",
  ),
);
assert.ok(
  report.cases.some(
    (row) => row.engine === "pi" && row.scenario === "normal-native",
  ),
);
for (const engine of ["reference", "pi"])
  for (const scenario of [
    "covered",
    "black-fallback",
    "minimized",
    "wrong-owner",
  ])
    assert.ok(
      report.cases.some(
        (row) => row.engine === engine && row.scenario === scenario,
      ),
    );
for (const engine of ["reference", "pi"])
  assert.ok(
    report.cases.some(
      (row) => row.engine === engine && row.scenario === "ocr-native",
    ),
  );
for (const engine of ["reference", "pi"])
  for (const scenario of [
    "ocr-scaled",
    "ocr-literal-miss",
    "ocr-clipped",
    "ocr-minimized",
    "closed-target",
  ])
    assert.ok(
      report.cases.some(
        (row) => row.engine === engine && row.scenario === scenario,
      ),
    );
assert.equal(
  report.ok,
  !result.code,
  "CLI exit must reflect the complete comparison",
);
assert.equal(report.cleanup.confirmed, true);
console.log(
  JSON.stringify({
    ok: true,
    check: "capture comparison report",
    cases: report.cases.length,
  }),
);
