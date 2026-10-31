import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const run = promisify(execFile);
test("real-browser plan works without a build, dependencies, credentials or child commands", async () => {
  const folder = await mkdtemp(join(tmpdir(), "pi-browser-plan-"));
  try {
    for (const name of ["pi-browser-host.mjs", "pi-browser-fixture.mjs"])
      await copyFile(new URL(name, import.meta.url), join(folder, name));
    const result = await run(
      process.execPath,
      [join(folder, "pi-browser-host.mjs"), "--plan"],
      {
        env: { PATH: "", PI_CODING_AGENT_DIR: join(folder, "no-auth") },
      },
    );
    const plan = JSON.parse(result.stdout);
    assert.equal(plan.mode, "plan");
    assert.deepEqual(plan.scenarios, ["form", "advanced", "stale"]);
    assert.deepEqual(plan.requested, {
      provider: "openai",
      model: "gpt-6.1-sol",
      thinking: "low",
    });
    assert.deepEqual((await readdir(folder)).sort(), [
      "pi-browser-fixture.mjs",
      "pi-browser-host.mjs",
    ]);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test("plan rejects unknown flags instead of silently forwarding unsafe Pi options", async () => {
  await assert.rejects(
    run(process.execPath, [
      new URL("./pi-browser-host.mjs", import.meta.url).pathname,
      "--plan",
      "--extensions",
    ]),
  );
});

const effective = [
  { provider: "openai", model: "gpt-6.1-sol", thinkingLevel: "low" },
];
const formReport = () => ({
  requested: { provider: "openai", model: "gpt-6.1-sol", thinking: "low" },
  effective,
  lifecycle: { settled: true, aborted: false, exitCode: 0 },
  cleanup: { profileEmpty: true, processCount: 0, fixtureExited: true },
  oracle: {
    payload: {
      name: "Pi 中文 café 😀",
      notes: "First line\n第二行 café 😀",
      accepted: true,
      choice: "beta",
    },
    events: { submissions: 1, starts: 1, ready: 1 },
  },
  observations: [
    {
      ok: true,
      action: "wait_for",
      query: "Delayed result ready",
      verification: "observed",
    },
  ],
});
const verify = async (scenario: string, facts: unknown) => {
  const script =
    "const {verifyOutcome}=await import(process.argv[1]);console.log(JSON.stringify(verifyOutcome(process.argv[2],JSON.parse(process.argv[3]))));";
  const result = await run(process.execPath, [
    "--input-type=module",
    "-e",
    script,
    new URL("./pi-browser-fixture.mjs", import.meta.url).href,
    scenario,
    JSON.stringify(facts),
  ]);
  return JSON.parse(result.stdout);
};
test("form acceptance requires actual delayed evidence, effective settings and confirmed cleanup", async () => {
  const facts = formReport();
  assert.equal((await verify("form", facts)).pass, true);
  for (const contradictory of [
    { found: false },
    { conclusive: false },
    { timedOut: true },
  ]) {
    assert.equal(
      (
        await verify("form", {
          ...facts,
          observations: [{ ...facts.observations[0], ...contradictory }],
        })
      ).pass,
      false,
    );
  }
  assert.equal(
    (
      await verify("form", {
        ...facts,
        lifecycle: { ...facts.lifecycle, parseError: true },
      })
    ).pass,
    false,
  );
  assert.equal(
    (
      await verify("form", {
        ...facts,
        observations: [
          {
            ok: true,
            action: "find",
            query: "Delayed result ready",
            matches: [],
          },
        ],
      })
    ).pass,
    false,
  );
  assert.equal(
    (
      await verify("form", {
        ...facts,
        effective: [{ ...effective[0], thinkingLevel: "high" }],
      })
    ).pass,
    false,
  );
  assert.equal(
    (
      await verify("form", {
        ...facts,
        cleanup: { ...facts.cleanup, fixtureExited: false },
      })
    ).pass,
    false,
  );
});
test("advanced acceptance deduplicates download metadata and requires the actual reported path", async () => {
  const file = {
    name: "pi-advanced-owned.txt",
    file: "C:\\owned\\pi-advanced-owned.txt",
    state: "completed",
  };
  const facts = {
    ...formReport(),
    downloadName: file.name,
    downloadExact: true,
    finalReport: file.file,
    oracle: {
      upload: { name: "fixture-upload.txt", content: "upload fixture only" },
      uploadRequests: 1,
      downloads: 1,
    },
    advancedObserved: {
      child: true,
      returned: true,
      prompt: true,
      confirm: true,
      alert: true,
      upload: true,
    },
    downloads: [file, file],
  };
  assert.equal((await verify("advanced", facts)).pass, true);
  assert.equal(
    (await verify("advanced", { ...facts, finalReport: "C:\\invented.txt" }))
      .pass,
    false,
  );
  assert.equal(
    (
      await verify("advanced", {
        ...facts,
        oracle: { ...facts.oracle, downloads: 2 },
      })
    ).pass,
    false,
  );
});
test("a guard-generated stale message never certifies product recovery", async () => {
  const facts = {
    ...formReport(),
    audit: [
      {
        type: "controlled_stale_result",
        result: {
          details: {
            ok: false,
            error: "SCOPED_FIXTURE_DENIED: STALE_BROWSER_REFERENCE",
          },
        },
      },
    ],
  };
  assert.equal((await verify("stale", facts)).pass, false);
});

test("stale recovery requires a successful result for the newly observed field action", async () => {
  const stale = { ok: false, error: "STALE_BROWSER_REFERENCE: old document" };
  const facts = {
    ...formReport(),
    promptObserved: true,
    oracle: {
      payload: {
        name: "Second form 中文 café 😀",
        notes: "Recovered second line\n第二行",
        accepted: true,
        choice: "beta",
      },
      events: { submissions: 1 },
    },
    audit: [
      {
        type: "first_form_oracle",
        oracle: {
          payload: {
            name: "First form 中文",
            notes: "Seed café 😀",
            accepted: true,
            choice: "alpha",
          },
          events: { submissions: 1 },
        },
      },
      { type: "controlled_reload", oldElementId: "t1:1" },
      { type: "controlled_stale_result", result: { details: stale } },
      {
        type: "after_stale_oracle",
        oracle: { payload: null, events: { submissions: 0 } },
        info: { details: { ok: true, element: { value: "" } } },
      },
      { type: "guard_tool_result", details: stale },
      {
        type: "guard_tool_result",
        toolName: "windows_computer_use_accessibility_tree",
        details: { ok: true, nodes: [{ name: "Name", id: "t1:2" }] },
      },
      {
        type: "guard_tool_call",
        toolName: "windows_computer_use_set_value",
        toolCallId: "fresh",
        input: { elementId: "t1:2" },
      },
      { type: "guard_tool_result", toolCallId: "fresh", details: { ok: true } },
    ],
  };
  assert.equal((await verify("stale", facts)).pass, true);
  assert.equal(
    (await verify("stale", { ...facts, audit: facts.audit.slice(0, -1) })).pass,
    false,
  );
  assert.equal(
    (
      await verify("stale", {
        ...facts,
        audit: [
          ...facts.audit.slice(0, -1),
          {
            type: "guard_tool_result",
            toolCallId: "other",
            details: { ok: true },
          },
        ],
      })
    ).pass,
    false,
  );
});
