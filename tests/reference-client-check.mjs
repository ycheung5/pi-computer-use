// Public MCP transport regression; optional passive wait cancellation, no desktop input.
import assert from "node:assert/strict";
import { ReferenceClient, referenceResult } from "./reference-client.mjs";

const client = new ReferenceClient(process.argv[2]);
try {
  const initialized = await client.init();
  assert.ok(initialized.serverInfo);
  const listed = await client.request("tools/list", {});
  assert.equal(listed.tools.length, 25);
  const preaborted = new AbortController();
  preaborted.abort(new Error("PREABORTED_FIXTURE"));
  await assert.rejects(
    client.request(
      "pi_preaborted_fixture_missing_method",
      {},
      preaborted.signal,
    ),
    /PREABORTED_FIXTURE/,
  );
  const invalid = await client.call("not_a_tool", {});
  assert.equal(invalid.isError, true);
  assert.ok(invalid.content.some((item) => item.type === "text" && item.text));
  let cancellation;
  if (process.argv.includes("--cancel-wait")) {
    const controller = new AbortController();
    const pending = client.call(
      "wait",
      { milliseconds: 10000 },
      controller.signal,
    );
    const started = performance.now();
    const timer = setTimeout(() => controller.abort(), 200);
    try {
      cancellation = {
        raw: await pending,
        elapsedMs: Math.round(performance.now() - started),
      };
    } finally {
      clearTimeout(timer);
    }
    assert.match(JSON.stringify(referenceResult(cancellation.raw)), /CANCEL/i);
    assert.ok(cancellation.elapsedMs < 8000);
  }
  console.log(
    JSON.stringify({
      ok: true,
      check: "reference MCP transport",
      tools: 25,
      rawErrorRetained: true,
      preabortedRejected: true,
      cancellation,
    }),
  );
} finally {
  await client.close();
}
