// Public CLI regression for paired accessibility evidence; no physical input.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
if (process.argv.includes("--diagnostics")) {
  const result = await run(process.execPath, [
    fileURLToPath(new URL("./accessibility-comparison.mjs", import.meta.url)),
    "--diagnostic-report",
  ]);
  const report = JSON.parse(result.stdout);
  assert.equal(
    report.cases.length,
    2,
    "Interrupted case retained and dependent cases halted",
  );
  const [depth, cancelled] = report.cases;
  assert.equal(depth.status, "fail");
  assert.deepEqual(depth.observations[0].response.windows, [
    { processId: 42, name: "owned" },
  ]);
  assert.equal(depth.observations[0].response.omittedUnrelatedWindowCount, 1);
  assert.ok(!result.stdout.includes("private title"));
  assert.equal(depth.observations[1].response.truncated, false);
  assert.deepEqual(depth.observations[1].response.tree, { name: "owned" });
  assert.equal(cancelled.id, "cancel");
  assert.equal(cancelled.expected, "Retain interrupted case");
  assert.match(cancelled.observations[0].error, /COMPUTER_USE_CANCELLED/);
  assert.match(report.halted, /COMPUTER_USE_CANCELLED/);
  console.log(
    JSON.stringify({ ok: true, check: "accessibility diagnostic retention" }),
  );
  process.exit(0);
}
let result;
try {
  result = await run(
    process.execPath,
    [
      fileURLToPath(new URL("./accessibility-comparison.mjs", import.meta.url)),
      process.argv[2],
      ...(process.argv.includes("--providers") ? ["--provider-failures"] : []),
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
assert.ok(
  report.cases.length >= (process.argv.includes("--providers") ? 4 : 30),
);
assert.ok(report.cases.some((row) => row.engine === "reference"));
assert.ok(report.cases.some((row) => row.engine === "pi"));
assert.ok(
  report.cases.every((row) => ["pass", "fail", "blocked"].includes(row.status)),
);
assert.equal(report.physicalInput, false);
assert.equal(report.cleanupConfirmed, true);
for (const engine of process.argv.includes("--providers")
  ? []
  : ["reference", "pi"]) {
  const row = report.cases.find(
    (row) => row.engine === engine && row.id === "native.set-value",
  );
  assert.ok(row, "Both engines must retain a set-value outcome");
  if (row.status === "pass") assert.equal(row.actual.editor, "Pi 中文 café 😀");
  else assert.ok(row.error, "Failed outcomes must retain evidence");
}
const hangs = report.cases.filter((row) => row.id === "provider.hang");
assert.equal(
  hangs.length,
  2,
  "Both engines retain blocked-provider lifetime evidence",
);
for (const row of hangs) {
  const evidence = (row.actual ?? row.observation)?.readerRetirement;
  assert.ok(
    evidence,
    `${row.engine}: retain independent reader-lifetime evidence`,
  );
  assert.equal(typeof evidence.confirmed, "boolean");
  if (row.status === "blocked") {
    assert.match(row.error, /Reader identification blocked prerequisite/);
    assert.equal(evidence.confirmed, false);
  } else if (row.status === "pass") {
    assert.equal(evidence.confirmed, true);
    assert.equal(evidence.liveBeforeAbort, true);
    assert.equal(evidence.providerStateBeforeAbort, "provider-state:1:False");
    assert.equal(evidence.oldReaderAlive, false);
    assert.equal(evidence.providerState, "provider-state:1:False");
    assert.equal(evidence.freshReadRecovered, true);
  } else
    assert.ok(row.error, "Failed retirement must retain the actual failure");
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
