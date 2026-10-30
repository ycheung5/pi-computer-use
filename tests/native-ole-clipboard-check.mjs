// Public CLI preparation checks only. Never opts into clipboard or physical input.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const runner = fileURLToPath(
  new URL("./native-ole-clipboard.mjs", import.meta.url),
);
const result = spawnSync(
  process.execPath,
  [runner, "--plan", "--engine", "reference", "--reference", "/does-not-exist"],
  {
    encoding: "utf8",
    env: { ...process.env, PI_CU_CLIPBOARD_INPUT_TEST: undefined },
  },
);
assert.equal(result.status, 0, result.stdout + result.stderr);
const plan = JSON.parse(result.stdout);
assert.equal(plan.engine, "reference");
assert.equal(plan.execution, "not-run");
assert.deepEqual(
  plan.cases.map((item) => item.id),
  ["ole-preservation", "indexed-refusal", "virtual-file", "newer-copy"],
);
assert.equal(plan.optIn, "PI_CU_CLIPBOARD_INPUT_TEST=1");
const typo = spawnSync(
  process.execPath,
  [runner, "--plan", "--engin", "reference"],
  {
    encoding: "utf8",
    env: { ...process.env, PI_CU_CLIPBOARD_INPUT_TEST: undefined },
  },
);
assert.notEqual(
  typo.status,
  0,
  "Unknown flags must not silently plan a different engine",
);
assert.match(typo.stderr, /Unknown argument/);
const isolated = await mkdtemp(join(tmpdir(), "pi-cu-clipboard-cli-"));
try {
  const standalone = join(isolated, "runner.mjs");
  await cp(runner, standalone);
  for (const engine of ["pi", "reference"]) {
    const blocked = spawnSync(
      process.execPath,
      [standalone, "--engine", engine, "--reference", "/does-not-exist"],
      {
        encoding: "utf8",
        cwd: isolated,
        env: {
          ...process.env,
          PI_CU_CLIPBOARD_INPUT_TEST: undefined,
          TMPDIR: join(isolated, "must-not-create"),
        },
      },
    );
    assert.notEqual(blocked.status, 0);
    assert.match(blocked.stderr, /Opt in with PI_CU_CLIPBOARD_INPUT_TEST=1/);
    assert.doesNotMatch(
      blocked.stderr,
      /ERR_MODULE_NOT_FOUND|ENOENT|requires Windows Node/,
    );
    assert.deepEqual(
      await readdir(isolated),
      ["runner.mjs"],
      "Blocked execution must not create fixture files",
    );
  }
  const listed = spawnSync(process.execPath, [standalone, "--list-cases"], {
    encoding: "utf8",
    env: { ...process.env, PI_CU_CLIPBOARD_INPUT_TEST: undefined },
  });
  assert.equal(listed.status, 0, listed.stderr);
  assert.equal(JSON.parse(listed.stdout).engine, "pi");
} finally {
  await rm(isolated, { recursive: true, force: true });
}
console.log(
  JSON.stringify({
    ok: true,
    check: "clipboard comparison plan",
    physicalInput: "not-run",
  }),
);
