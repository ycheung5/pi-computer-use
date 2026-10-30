// Public CLI regression for paired accessibility evidence; no physical input.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
let result;
try {
  result = await run(
    process.execPath,
    [
      fileURLToPath(new URL("./accessibility-comparison.mjs", import.meta.url)),
      process.argv[2],
    ],
    { timeout: 300000, maxBuffer: 8 * 1024 * 1024 },
  );
} catch (error) {
  result = error;
}
const line = result.stdout
  ?.split(/\r?\n/)
  .find((line) => line.startsWith('{"comparison":"accessibility"'));
assert.ok(
  line,
  `CLI must preserve paired report even for mismatches: ${result.stderr}`,
);
const report = JSON.parse(line);
assert.ok(report.cases.length >= 30);
assert.ok(report.cases.some((row) => row.engine === "reference"));
assert.ok(report.cases.some((row) => row.engine === "pi"));
assert.ok(
  report.cases.every((row) => ["pass", "fail", "blocked"].includes(row.status)),
);
assert.equal(report.physicalInput, false);
assert.equal(report.cleanupConfirmed, true);
for (const engine of ["reference", "pi"]) {
  const row = report.cases.find(
    (row) => row.engine === engine && row.id === "native.set-value",
  );
  assert.ok(row, "Both engines must retain a set-value outcome");
  if (row.status === "pass") assert.equal(row.actual.editor, "Pi 中文 café 😀");
  else assert.ok(row.error, "Failed outcomes must retain evidence");
}
console.log(JSON.stringify(report));
console.log(
  JSON.stringify({
    ok: true,
    check: "accessibility comparison evidence collection",
    cases: report.cases.length,
    productComparison: report.ok,
  }),
);
