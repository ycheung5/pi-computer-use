import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
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
  new URL("./window-management-comparison.mjs", import.meta.url),
);

test("paired window-management planning and refusal need no backend or Windows access", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-window-plan-"));
  try {
    const script = join(dir, "window-management-comparison.mjs");
    writeFileSync(script, readFileSync(source));
    const env = { ...process.env, PI_CU_WINDOW_MANAGEMENT_TEST: "" };
    for (const engine of ["pi", "reference"]) {
      const plan = spawnSync(
        process.execPath,
        [script, "--plan", `--engine=${engine}`],
        { env, encoding: "utf8" },
      );
      assert.equal(plan.status, 0, plan.stderr);
      const report = JSON.parse(plan.stdout);
      assert.equal(report.executed, false);
      assert.equal(report.engine, engine);
      assert.equal(report.physicalInput, false);
      assert.equal(report.foregroundChangesPossible, true);
      const refusal = spawnSync(
        process.execPath,
        [script, `--engine=${engine}`],
        { env, encoding: "utf8" },
      );
      assert.notEqual(refusal.status, 0);
      assert.match(refusal.stderr, /PI_CU_WINDOW_MANAGEMENT_TEST/);
      assert.doesNotMatch(
        refusal.stderr,
        /MODULE_NOT_FOUND|ENOENT|Windows Node/,
      );
    }
    for (const invalid of ["--engine=unknown", "--unexpected"]) {
      const rejected = spawnSync(
        process.execPath,
        [script, "--plan", invalid],
        { env, encoding: "utf8" },
      );
      assert.notEqual(
        rejected.status,
        0,
        `invalid option must be rejected: ${invalid}`,
      );
    }
    assert.deepEqual(readdirSync(dir), ["window-management-comparison.mjs"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("extended window cases are listed without loading a backend or using Windows", () => {
  const env = { ...process.env, PI_CU_WINDOW_MANAGEMENT_TEST: "" };
  for (const engine of ["pi", "reference"]) {
    const result = spawnSync(
      process.execPath,
      [source, "--plan", "--extended", `--engine=${engine}`],
      { env, encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.executed, false);
    assert.equal(report.foregroundChangesPossible, true);
    assert.ok(report.cases.includes("same-process-distractor"));
    assert.ok(report.cases.includes("replacement-identity"));
    assert.ok(report.cases.includes("foreground-restoration"));
  }
});

test("cross-process focus diagnostic is opt-in and plans without touching Windows", () => {
  const script = fileURLToPath(
    new URL("./foreground-focus-comparison.mjs", import.meta.url),
  );
  const env = { ...process.env, PI_CU_WINDOW_MANAGEMENT_TEST: "" };
  const plan = spawnSync(
    process.execPath,
    [script, "--plan", "--engine=reference"],
    { env, encoding: "utf8" },
  );
  assert.equal(plan.status, 0, plan.stderr);
  const report = JSON.parse(plan.stdout);
  assert.equal(report.physicalInput, false);
  assert.equal(report.foregroundChangesPossible, true);
  assert.deepEqual(report.cases, ["cross-process-prior-foreground"]);
  const refusal = spawnSync(process.execPath, [script, "--engine=reference"], {
    env,
    encoding: "utf8",
  });
  assert.notEqual(refusal.status, 0);
  assert.match(refusal.stderr, /PI_CU_WINDOW_MANAGEMENT_TEST/);
});

test("focus evidence distinguishes interference, restoration failure and changed owner", () => {
  const script = fileURLToPath(
    new URL("./foreground-focus-comparison.mjs", import.meta.url),
  );
  const dir = mkdtempSync(join(tmpdir(), "pi-focus-report-"));
  try {
    const path = join(dir, "evidence.json");
    const prior = { nativeWindowHandle: 10, processId: 20 };
    const before = {
      foregroundHandle: 10,
      foregroundPid: 20,
      lastInputTick: 2,
    };
    const sample = { ...before, activeEditor: true };
    const base = {
      prior,
      before,
      pre: before,
      focus: { ok: true },
      samples: [sample],
    };
    for (const [evidence, status] of [
      [base, "pass"],
      [{ ...base, pre: { ...before, lastInputTick: 3 } }, "inconclusive"],
      [{ ...base, samples: [{ ...sample, lastInputTick: 3 }] }, "inconclusive"],
      [{ ...base, pre: { ...before, foregroundPid: 99 } }, "inconclusive"],
      [{ ...base, samples: [{ ...sample, foregroundHandle: 99 }] }, "fail"],
    ] as const) {
      writeFileSync(path, JSON.stringify(evidence));
      const actual = spawnSync(process.execPath, [script, `--report=${path}`], {
        encoding: "utf8",
      });
      assert.equal(JSON.parse(actual.stdout).status, status, actual.stderr);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("focus provenance planning stays offline and reports privacy-preserving counters", () => {
  const source = fileURLToPath(
    new URL("./foreground-focus-comparison.mjs", import.meta.url),
  );
  const result = spawnSync(
    process.execPath,
    [source, "--plan", "--provenance"],
    {
      encoding: "utf8",
      env: { ...process.env, PI_CU_WINDOW_MANAGEMENT_TEST: "" },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.executed, false);
  assert.equal(plan.physicalInput, false);
  assert.equal(plan.inputProvenance, "aggregate hook counts only");
});

test("provenance reports distinguish tagged input from unmarked or other injected events", () => {
  const script = fileURLToPath(
    new URL("./foreground-focus-comparison.mjs", import.meta.url),
  );
  const dir = mkdtempSync(join(tmpdir(), "pi-provenance-report-"));
  try {
    const path = join(dir, "evidence.json"),
      prior = { nativeWindowHandle: 10, processId: 20 };
    const obs = {
      foregroundHandle: 10,
      foregroundPid: 20,
      lastInputTick: 2,
      activeEditor: true,
    };
    const zero = {
      unmarkedMouse: 0,
      injectedMouse: 0,
      taggedMouse: 0,
      unmarkedKey: 0,
      injectedKey: 0,
      taggedKey: 0,
    };
    const base = {
      prior,
      before: obs,
      pre: obs,
      focus: { ok: true },
      samples: [obs],
      inputEventsBefore: zero,
    };
    for (const [end, status] of [
      [{ ...zero, taggedMouse: 1 }, "pass"],
      [{ ...zero, unmarkedKey: 1 }, "inconclusive"],
      [{ ...zero, injectedMouse: 1 }, "inconclusive"],
      [{ ...zero, unmarkedMouse: -1 }, "inconclusive"],
    ] as const) {
      writeFileSync(path, JSON.stringify({ ...base, inputEventsAfter: end }));
      const result = spawnSync(process.execPath, [script, `--report=${path}`], {
        encoding: "utf8",
      });
      assert.equal(JSON.parse(result.stdout).status, status, result.stderr);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("direct UIA focus control plans offline and does not imply an engine comparison", () => {
  const script = fileURLToPath(
    new URL("./foreground-focus-comparison.mjs", import.meta.url),
  );
  const plan = spawnSync(
    process.execPath,
    [script, "--plan", "--provenance", "--direct-uia"],
    {
      encoding: "utf8",
      env: { ...process.env, PI_CU_WINDOW_MANAGEMENT_TEST: "" },
    },
  );
  assert.equal(plan.status, 0, plan.stderr);
  const result = JSON.parse(plan.stdout);
  assert.equal(result.executed, false);
  assert.equal(result.focusDispatch, "direct-uia-control");
  const invalid = spawnSync(
    process.execPath,
    [script, "--plan", "--direct-uia", "--engine=reference"],
    { encoding: "utf8" },
  );
  assert.notEqual(invalid.status, 0);
});

test("direct UIA foreground movement is recorded as an observation, not a restoration failure", () => {
  const script = fileURLToPath(
    new URL("./foreground-focus-comparison.mjs", import.meta.url),
  );
  const dir = mkdtempSync(join(tmpdir(), "pi-direct-focus-report-"));
  try {
    const path = join(dir, "evidence.json"),
      prior = { nativeWindowHandle: 10, processId: 20 };
    const before = {
      foregroundHandle: 10,
      foregroundPid: 20,
      lastInputTick: 2,
    };
    writeFileSync(
      path,
      JSON.stringify({
        prior,
        before,
        pre: before,
        focus: { ok: true },
        focusDispatch: "direct-uia-control",
        samples: [
          {
            ...before,
            foregroundHandle: 30,
            foregroundPid: 40,
            activeEditor: true,
          },
        ],
      }),
    );
    const result = spawnSync(process.execPath, [script, `--report=${path}`], {
      encoding: "utf8",
    });
    assert.equal(JSON.parse(result.stdout).status, "observed", result.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("direct focus outcome requires explicit method-return marker and clean process exit", () => {
  const script = fileURLToPath(
    new URL("./foreground-focus-comparison.mjs", import.meta.url),
  );
  const dir = mkdtempSync(join(tmpdir(), "pi-direct-settlement-"));
  try {
    const path = join(dir, "evidence.json");
    for (const [evidence, expected] of [
      [
        {
          dispatched: true,
          marker: "sent",
          closed: true,
          exitCode: 0,
          signal: null,
        },
        "returned",
      ],
      [
        {
          dispatched: true,
          marker: null,
          closed: true,
          exitCode: 0,
          signal: null,
        },
        "unknown",
      ],
      [
        {
          dispatched: true,
          marker: null,
          closed: true,
          exitCode: 1,
          signal: null,
        },
        "unknown",
      ],
      [
        {
          dispatched: true,
          marker: "sent",
          closed: true,
          exitCode: 1,
          signal: null,
        },
        "unknown",
      ],
      [
        {
          dispatched: true,
          marker: "sent",
          closed: false,
          exitCode: null,
          signal: null,
        },
        "unknown",
      ],
      [
        {
          dispatched: true,
          marker: "sent",
          closed: true,
          exitCode: null,
          signal: "SIGTERM",
        },
        "unknown",
      ],
    ] as const) {
      writeFileSync(path, JSON.stringify(evidence));
      const output = spawnSync(
        process.execPath,
        [script, `--direct-report=${path}`],
        { encoding: "utf8" },
      );
      assert.equal(JSON.parse(output.stdout).outcome, expected, output.stderr);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("MTA direct focus control is explicitly scoped and requires the diagnostic prerequisites", () => {
  const script = fileURLToPath(
    new URL("./foreground-focus-comparison.mjs", import.meta.url),
  );
  const plan = spawnSync(
    process.execPath,
    [script, "--plan", "--provenance", "--direct-uia", "--direct-mta"],
    { encoding: "utf8" },
  );
  assert.equal(plan.status, 0, plan.stderr);
  assert.equal(JSON.parse(plan.stdout).directApartmentRequested, "MTA");
  const invalid = spawnSync(
    process.execPath,
    [script, "--plan", "--direct-mta"],
    { encoding: "utf8" },
  );
  assert.notEqual(invalid.status, 0);
});

test("owned-dialog comparison is opt-in and preserves no-input plan", () => {
  const script = fileURLToPath(
    new URL("./foreground-focus-comparison.mjs", import.meta.url),
  );
  const plan = spawnSync(
    process.execPath,
    [script, "--plan", "--dialog", "--provenance"],
    {
      encoding: "utf8",
      env: { ...process.env, PI_CU_WINDOW_MANAGEMENT_TEST: "" },
    },
  );
  assert.equal(plan.status, 0, plan.stderr);
  const result = JSON.parse(plan.stdout);
  assert.equal(result.executed, false);
  assert.equal(result.physicalInput, false);
  assert.equal(result.fixtureExpiry, "explicit-stop-only");
  assert.deepEqual(result.cases, ["owned-dialog-foreground"]);
  const incompatible = spawnSync(
    process.execPath,
    [script, "--plan", "--dialog", "--direct-uia", "--provenance"],
    { encoding: "utf8" },
  );
  assert.notEqual(incompatible.status, 0);
});

test("owned-dialog evidence distinguishes observed popup and intervening input", () => {
  const script = fileURLToPath(
    new URL("./foreground-focus-comparison.mjs", import.meta.url),
  );
  const dir = mkdtempSync(join(tmpdir(), "pi-dialog-evidence-"));
  try {
    const path = join(dir, "result.json"),
      prior = { nativeWindowHandle: 10, processId: 20 },
      target = { nativeWindowHandle: 30, processId: 40 };
    const before = {
        foregroundHandle: 10,
        foregroundPid: 20,
        foregroundRoot: 10,
        lastInputTick: 1,
      },
      sample = {
        foregroundHandle: 50,
        foregroundPid: 40,
        foregroundRoot: 50,
        lastInputTick: 1,
      };
    const base = {
      comparison: "owned-dialog",
      prior,
      target,
      before,
      pre: before,
      action: { ok: true },
      dialog: { handle: 50, owner: 30, processId: 40, visible: true },
      samples: [sample],
    };
    for (const [evidence, status] of [
      [base, "pass"],
      [{ ...base, samples: [{ ...sample, lastInputTick: 2 }] }, "inconclusive"],
      [{ ...base, dialog: { ...base.dialog, owner: 99 } }, "inconclusive"],
      [{ ...base, dialog: { ...base.dialog, visible: false } }, "fail"],
      [
        {
          ...base,
          samples: [{ ...sample, foregroundRoot: 10, foregroundPid: 20 }],
        },
        "inconclusive",
      ],
    ] as const) {
      writeFileSync(path, JSON.stringify(evidence));
      const got = spawnSync(process.execPath, [script, `--report=${path}`], {
        encoding: "utf8",
      });
      assert.equal(JSON.parse(got.stdout).status, status, got.stderr);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("uncertain dispatch retains coordinator without relying on stdin", async () => {
  const script = fileURLToPath(
    new URL("./foreground-focus-comparison.mjs", import.meta.url),
  );
  const child = spawn(process.execPath, [script, "--retention-check"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ready = await Promise.race([
      once(child.stdout, "data"),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("retention test not ready")),
          3000,
        );
      }),
    ]).finally(() => clearTimeout(timer));
    assert.match(String(ready[0]), /retained/);
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.equal(
      child.exitCode,
      null,
      "coordinator must remain alive with no stdin",
    );
  } finally {
    if (child.exitCode === null) {
      const closed = once(child, "close");
      child.kill();
      await closed;
    }
  }
});

test("owned-menu plan is opt-in and separate from dialog", () => {
  const script = fileURLToPath(
    new URL("./foreground-focus-comparison.mjs", import.meta.url),
  );
  const plan = spawnSync(
    process.execPath,
    [script, "--plan", "--menu", "--provenance"],
    { encoding: "utf8" },
  );
  assert.equal(plan.status, 0, plan.stderr);
  const value = JSON.parse(plan.stdout);
  assert.equal(value.executed, false);
  assert.equal(value.physicalInput, false);
  assert.equal(value.fixtureExpiry, "explicit-stop-only");
  assert.deepEqual(value.cases, ["owned-menu-foreground"]);
  for (const args of [
    ["--plan", "--menu"],
    ["--plan", "--menu", "--dialog", "--provenance"],
  ]) {
    const bad = spawnSync(process.execPath, [script, ...args], {
      encoding: "utf8",
    });
    assert.notEqual(bad.status, 0);
  }
});

test("owned-menu outcome requires OS menu-mode and owned visible menu evidence", () => {
  const script = fileURLToPath(
    new URL("./foreground-focus-comparison.mjs", import.meta.url),
  );
  const dir = mkdtempSync(join(tmpdir(), "pi-menu-evidence-"));
  try {
    const path = join(dir, "evidence.json"),
      prior = { nativeWindowHandle: 10, processId: 20 },
      target = { nativeWindowHandle: 30, processId: 40 };
    const before = {
        foregroundHandle: 10,
        foregroundPid: 20,
        foregroundRoot: 10,
        lastInputTick: 1,
      },
      sample = {
        foregroundHandle: 30,
        foregroundPid: 40,
        foregroundRoot: 30,
        lastInputTick: 1,
        menu: {
          handle: 50,
          source: 30,
          processId: 40,
          visible: true,
          itemCount: 1,
          menuMode: true,
        },
      };
    const base = {
      comparison: "owned-menu",
      prior,
      target,
      before,
      pre: before,
      action: { ok: true },
      menu: {
        handle: 50,
        source: 30,
        processId: 40,
        visible: true,
        itemCount: 1,
        menuMode: true,
      },
      samples: [sample],
    };
    for (const [evidence, status] of [
      [base, "pass"],
      [{ ...base, nativeMenu: true }, "inconclusive"],
      [
        {
          ...base,
          nativeMenu: true,
          menuUia: { ok: true, matches: [{ processId: 999 }] },
        },
        "inconclusive",
      ],
      [
        {
          ...base,
          nativeMenu: true,
          menuUia: {
            ok: true,
            matches: [
              {
                processId: 40,
                name: "Owned menu item",
                controlType: "MenuItem",
              },
            ],
          },
        },
        "pass",
      ],
      [{ ...base, menu: { ...base.menu, menuMode: false } }, "inconclusive"],
      [{ ...base, menu: { ...base.menu, handle: undefined } }, "inconclusive"],
      [{ ...base, menu: { ...base.menu, source: 99 } }, "inconclusive"],
      [{ ...base, menu: { ...base.menu, visible: false } }, "fail"],
      [
        {
          ...base,
          samples: [{ ...sample, menu: { ...sample.menu, visible: false } }],
        },
        "fail",
      ],
      [
        {
          ...base,
          samples: [{ ...sample, menu: { ...sample.menu, handle: 51 } }],
        },
        "inconclusive",
      ],
      [
        {
          ...base,
          samples: [{ ...sample, menu: { ...sample.menu, menuMode: false } }],
        },
        "inconclusive",
      ],
      [{ ...base, samples: [{ ...sample, menu: undefined }] }, "inconclusive"],
      [{ ...base, samples: [{ ...sample, lastInputTick: 2 }] }, "inconclusive"],
      [
        {
          ...base,
          samples: [{ ...sample, foregroundRoot: 10, foregroundPid: 20 }],
        },
        "inconclusive",
      ],
    ] as const) {
      writeFileSync(path, JSON.stringify(evidence));
      const out = spawnSync(process.execPath, [script, `--report=${path}`], {
        encoding: "utf8",
      });
      assert.equal(JSON.parse(out.stdout).status, status, out.stderr);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("native menu plan identifies the Win32 fixture explicitly", () => {
  const script = fileURLToPath(
    new URL("./foreground-focus-comparison.mjs", import.meta.url),
  );
  const result = spawnSync(
    process.execPath,
    [script, "--plan", "--native-menu", "--provenance"],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  const value = JSON.parse(result.stdout);
  assert.deepEqual(value.cases, ["native-menu-foreground"]);
  assert.equal(value.physicalInput, false);
});
