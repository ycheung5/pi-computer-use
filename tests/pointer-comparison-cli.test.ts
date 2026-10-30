import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

test("Pointer comparison plans without resources and refuses unapproved input", async () => {
  const folder = await mkdtemp(join(tmpdir(), "pointer-cli-"));
  try {
    const runner = join(folder, "runner.mjs");
    await cp(resolve("tests/native-pointer-physical.mjs"), runner);
    const run = (...args: string[]) =>
      spawnSync(process.execPath, [runner, ...args], {
        cwd: folder,
        encoding: "utf8",
        env: { ...process.env, PI_CU_DEDICATED_INPUT_DESKTOP: "" },
      });
    for (const engine of ["pi", "reference"]) {
      const listed = run("--list", `--engine=${engine}`);
      assert.equal(listed.status, 0, listed.stderr);
      const plan = JSON.parse(listed.stdout);
      assert.equal(plan.executed, false);
      assert.equal(plan.engine, engine);
      assert.ok(plan.cases.includes("scaled-click"));
      assert.ok(plan.pending.includes("foreground-restoration"));
      const refused = run(
        `--engine=${engine}`,
        "--reference=/absent/reference",
      );
      assert.notEqual(refused.status, 0);
      assert.match(refused.stderr, /PI_CU_DEDICATED_INPUT_DESKTOP=1/);
      assert.doesNotMatch(
        refused.stderr,
        /MODULE_NOT_FOUND|ENOENT|Windows Node/,
      );
    }
    const invalid = run("--list", "--engine=other");
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stderr, /engine must be pi or reference/);
    const unknown = run("--list", "--unknown");
    assert.notEqual(unknown.status, 0);
    assert.match(unknown.stderr, /Unknown option/);
    assert.deepEqual(await readdir(folder), ["runner.mjs"]);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test("Pointer drag reporting retains a timeout and held-button evidence", async () => {
  const folder = await mkdtemp(join(tmpdir(), "pointer-report-"));
  try {
    const runner = join(folder, "runner.mjs");
    await cp(resolve("tests/native-pointer-physical.mjs"), runner);
    const evidence = {
      engine: "reference",
      down: { status: "fulfilled" },
      dispatch: {
        status: "fulfilled",
        value: {
          ok: false,
          error: "backend timed out after 30000ms during drag",
        },
      },
      before: { releases: 2 },
      observations: [{ held: 1, releases: 2 }],
    };
    const report = join(folder, "evidence.json");
    await writeFile(report, JSON.stringify(evidence));
    const result = spawnSync(
      process.execPath,
      [runner, `--report-drag=${report}`],
      {
        cwd: folder,
        encoding: "utf8",
        env: { ...process.env, PI_CU_DEDICATED_INPUT_DESKTOP: "" },
      },
    );
    assert.equal(result.status, 1, result.stderr);
    const actual = JSON.parse(result.stdout);
    assert.equal(actual.ok, false);
    assert.equal(actual.cancellationConfirmed, false);
    assert.equal(actual.releaseConfirmed, false);
    assert.equal(actual.evidence.observations[0].held, 1);
    assert.match(actual.evidence.dispatch.value.error, /timed out/);
    assert.equal(actual.inputDispatched, false);
    assert.deepEqual((await readdir(folder)).sort(), [
      "evidence.json",
      "runner.mjs",
    ]);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test("Pointer drag reporting requires both cancellation and independently observed release", async () => {
  const folder = await mkdtemp(join(tmpdir(), "pointer-release-report-"));
  try {
    const runner = join(folder, "runner.mjs");
    await cp(resolve("tests/native-pointer-physical.mjs"), runner);
    const report = join(folder, "evidence.json");
    const evidence = {
      engine: "pi",
      down: { status: "fulfilled" },
      dispatch: {
        status: "rejected",
        error: { name: "AbortError", message: "This operation was aborted" },
      },
      before: { releases: 4 },
      observations: [{ held: 0, releases: 5 }],
    };
    const run = async (value: unknown) => {
      await writeFile(report, JSON.stringify(value));
      return spawnSync(process.execPath, [runner, `--report-drag=${report}`], {
        cwd: folder,
        encoding: "utf8",
        env: { ...process.env, PI_CU_DEDICATED_INPUT_DESKTOP: "" },
      });
    };
    const passed = await run(evidence);
    assert.equal(passed.status, 0, passed.stderr);
    assert.equal(JSON.parse(passed.stdout).cleanupVerification, "released");
    const unreadable = await run({
      ...evidence,
      observations: [],
      observationError: { message: "fixture exited before reply" },
    });
    assert.equal(unreadable.status, 1, unreadable.stderr);
    const failed = JSON.parse(unreadable.stdout);
    assert.equal(failed.cancellationConfirmed, true);
    assert.equal(failed.releaseConfirmed, false);
    assert.equal(failed.cleanupVerification, "unconfirmed");
    assert.equal(
      failed.evidence.observationError.message,
      "fixture exited before reply",
    );
    const timeoutReleased = await run({
      ...evidence,
      dispatch: {
        status: "fulfilled",
        value: { ok: false, error: "backend timed out" },
      },
    });
    assert.equal(timeoutReleased.status, 1, timeoutReleased.stderr);
    assert.equal(JSON.parse(timeoutReleased.stdout).releaseConfirmed, true);
    assert.equal(
      JSON.parse(timeoutReleased.stdout).cancellationConfirmed,
      false,
    );
    const notStarted = await run({
      ...evidence,
      down: { status: "rejected", error: { message: "no mouse down" } },
    });
    assert.equal(notStarted.status, 1, notStarted.stderr);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
