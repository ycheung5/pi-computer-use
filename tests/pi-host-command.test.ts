import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const helper = () =>
  import(new URL("./pi-host-command.mjs", import.meta.url).href);
test("host participant receipt records child lifetime and cleanup without payloads", async () => {
  const { commandObserver } = await helper();
  const folder = await mkdtemp(join(tmpdir(), "pi-command-participants-"));
  try {
    const trace = join(folder, "trace.jsonl");
    const source = `import {spawn} from 'node:child_process';const c=spawn(process.execPath,['-e','process.exit(0)','PRIVATE_ARGUMENT'],{env:{PRIVATE_ENV:'PRIVATE_VALUE'}});c.on('close',()=>process.stdout.write(JSON.stringify({id:9,result:{ok:false,action:'click',cleanupConfirmed:true,error:'TARGET_IDENTITY_CHANGED'}})+'\\n'));`;
    const child = spawn(process.execPath, [
      "--import",
      commandObserver(trace, null, true),
      "--input-type",
      "module",
      "-e",
      source,
    ]);
    const closed = once(child, "close");
    child.stdout.resume();
    child.stderr.resume();
    child.stdin.end();
    assert.deepEqual(await closed, [0, null]);
    const text = await readFile(trace, "utf8");
    const rows = text
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const started = rows.find((row) => row.kind === "child_spawn");
    assert.equal(started?.executable, process.execPath);
    assert.ok(Number.isSafeInteger(started?.childPid) && started.childPid > 0);
    const ended = rows.find((row) => row.kind === "child_exit");
    assert.equal(ended?.childPid, started.childPid);
    assert.equal(ended?.code, 0);
    assert.equal(ended?.signal, null);
    assert.equal(
      rows.find((row) => row.id === 9)?.result.cleanupConfirmed,
      true,
    );
    assert.equal(
      /PRIVATE_ARGUMENT|PRIVATE_ENV|PRIVATE_VALUE/.test(text),
      false,
    );
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
test("passive host observer preserves real stdin/stdout frames and callbacks", async () => {
  const { commandObserver } = await helper();
  const folder = await mkdtemp(join(tmpdir(), "pi-command-observer-"));
  try {
    const trace = join(folder, "trace.jsonl");
    const source = `process.stdin.on('data',b=>{process.stdout.write(b,()=>process.stderr.write('callback'));});`;
    const child = spawn(
      process.execPath,
      ["--import", commandObserver(trace), "-e", source],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    const closed = once(child, "close");
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    const frame =
      JSON.stringify({
        id: 7,
        action: "wait",
        operationId: "actual-operation",
        args: { milliseconds: 30000 },
      }) + "\n";
    child.stdin.end(frame);
    assert.deepEqual(await closed, [0, null]);
    assert.equal(stdout, frame);
    assert.equal(stderr, "callback");
    const rows = (await readFile(trace, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(rows[0].kind, "ready");
    assert.deepEqual(
      rows.map((row) => row.sequence),
      [1, 2, 3],
    );
    assert.equal(rows[1].kind, "input");
    assert.equal(rows[1].action, "wait");
    assert.equal(rows[1].operationId, "actual-operation");
    assert.equal(rows[1].milliseconds, 30000);
    assert.equal(rows[2].kind, "output");
    assert.ok(rows.every((row) => !row.fault));
    assert.equal(JSON.stringify(rows).includes('"args"'), false);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test("passive command guard permits only owner-bound health/wait and fails closed", async () => {
  const { commandGuard } = await helper();
  const running = { phase: "running", expiresAt: Date.now() + 10000 };
  const event = {
    toolName: "windows_computer_use_wait",
    input: { milliseconds: 30000 },
  };
  assert.equal(
    commandGuard(
      event,
      () => running,
      () => {},
    ),
    undefined,
  );
  for (const owner of [
    { phase: "retained" },
    { phase: "running", expiresAt: 0 },
    null,
  ])
    assert.equal(
      commandGuard(
        event,
        () => owner,
        () => {},
      ).block,
      true,
    );
  assert.equal(
    commandGuard(
      event,
      () => {
        throw Error("journal");
      },
      () => {},
    ).block,
    true,
  );
  assert.equal(
    commandGuard(
      event,
      () => running,
      () => {
        throw Error("audit");
      },
    ).block,
    true,
  );
  for (const input of [
    { milliseconds: 30001 },
    { milliseconds: 30000, windowRef: "foreign" },
    {},
  ])
    assert.equal(
      commandGuard(
        { ...event, input },
        () => running,
        () => {},
      ).block,
      true,
    );
  assert.equal(
    commandGuard(
      { ...event, toolName: "windows_computer_use_click" },
      () => running,
      () => {},
    ).block,
    true,
  );
});

test("observer faults preserve malformed bytes and cannot fabricate clean proof", async () => {
  const { commandObserver } = await helper();
  const folder = await mkdtemp(join(tmpdir(), "pi-command-malformed-"));
  try {
    const trace = join(folder, "trace.jsonl");
    const child = spawn(
      process.execPath,
      [
        "--import",
        commandObserver(trace),
        "-e",
        "process.stdin.on('data',b=>process.stdout.write(b))",
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    const closed = once(child, "close");
    let output = "";
    child.stdout.on("data", (b) => (output += b));
    child.stderr.resume();
    child.stdin.end('not-json\n{"id":9}\n');
    assert.deepEqual(await closed, [0, null]);
    assert.equal(output, 'not-json\n{"id":9}\n');
    const rows = (await readFile(trace, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.ok(rows.some((row) => row.kind === "fault"));
    assert.ok(rows.slice(1).every((row) => row.fault === true));
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test("command settlement requires actual timely wait cancellation and released ownership", async () => {
  const { assessCommandSettlement } = await helper();
  const pending = {
    kind: "input",
    id: 3,
    action: "wait",
    milliseconds: 30000,
    operationId: "op-A",
    pid: 17,
    sequence: 2,
    monotonicMs: 1000,
  };
  const records = [
    {
      kind: "output",
      event: "stopped",
      operationId: "op-A",
      pid: 17,
      sequence: 3,
      monotonicMs: 1200,
    },
    {
      kind: "output",
      id: 3,
      pid: 17,
      sequence: 4,
      monotonicMs: 1300,
      result: { ok: false, action: "wait", error: "COMPUTER_USE_STOPPED" },
    },
    {
      kind: "input",
      action: "operation_end",
      operationId: "op-A",
      id: 4,
      pid: 17,
      sequence: 5,
      monotonicMs: 1350,
    },
    {
      kind: "output",
      id: 4,
      pid: 17,
      sequence: 6,
      monotonicMs: 1400,
      result: { ok: true, action: "operation_end", released: true },
    },
  ];
  assert.equal(assessCommandSettlement(pending, records).status, "observed");
  const replace = (index: number, patch: Record<string, unknown>) =>
    records.map((row, i) => (i === index ? { ...row, ...patch } : row));
  for (const changed of [
    replace(1, {
      result: { ok: false, action: "wait", error: "COMPUTER_USE_CANCELLED" },
    }),
    replace(1, { result: { ok: true, action: "wait" } }),
    replace(1, { monotonicMs: 31000 }),
    records.filter((_, i) => i !== 1),
    replace(1, { pid: 99 }),
    replace(1, { id: 99 }),
    replace(1, { monotonicMs: undefined }),
    replace(3, {
      result: { ok: true, action: "operation_end", released: false },
    }),
    replace(3, {
      result: { ok: false, action: "operation_end", released: true },
    }),
    records.filter((_, i) => i !== 3),
    replace(3, { sequence: 3 }),
  ])
    assert.notEqual(
      assessCommandSettlement(pending, changed).status,
      "observed",
      JSON.stringify(changed),
    );
});

test("command host selector plans safely without a build or child-command PATH", async () => {
  const { execFileSync } = await import("node:child_process");
  const folder = await mkdtemp(join(tmpdir(), "pi-command-plan-"));
  try {
    for (const file of [
      "pi-host-stop.mjs",
      "pi-host-command.mjs",
      "pi-host-stop-containment.mjs",
      "pi-host-stop-outcome.mjs",
      "stop-busy-coordination.mjs",
      "pi-visual-host.mjs",
      "pi-visual-fixture.mjs",
    ])
      await copyFile(new URL(file, import.meta.url), join(folder, file));
    const runner = join(folder, "pi-host-stop.mjs");
    const planned = JSON.parse(
      execFileSync(
        process.execPath,
        [runner, "command", "--command-host", "wsl", "--plan"],
        { encoding: "utf8", env: { ...process.env, PATH: "" } },
      ),
    );
    assert.equal(planned.mode, "plan");
    assert.equal(planned.commandHost, "wsl");
    assert.equal(planned.physicalInput, false);
    assert.deepEqual(planned.tools, ["health", "wait"]);
    for (const args of [
      ["--command-host", "linux", "--plan"],
      ["--command-host"],
      ["--plan", "--extensions"],
    ])
      assert.throws(() =>
        execFileSync(process.execPath, [runner, "command", ...args], {
          stdio: "ignore",
        }),
      );
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test("Linux host identities use proc start/executable and confirmed absence", {
  skip: process.platform !== "linux",
}, async () => {
  const { linuxOwner, linuxOwnerAbsent } = await helper();
  assert.equal(typeof linuxOwner, "function");
  const child = spawn(
    process.execPath,
    ["-e", "console.log('ready');process.stdin.resume()"],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  const closed = once(child, "close");
  child.stderr.resume();
  try {
    await once(child.stdout, "data");
    const identity = linuxOwner(child.pid);
    assert.equal(identity.domain, "linux");
    assert.equal(identity.pid, child.pid);
    assert.equal(identity.parent, process.pid);
    assert.ok(identity.startTicks && identity.executable);
    assert.equal(linuxOwnerAbsent(identity), false);
    child.stdin.end();
    await closed;
    assert.equal(linuxOwnerAbsent(identity), true);
  } finally {
    if (child.exitCode === null) {
      child.stdin.end();
      await closed;
    }
  }
});

test("held navigation cancellation needs actual sole pending entry and timely released response", async () => {
  const { heldNavigationEntry, assessCommandSettlement } = await helper();
  const hash = "a".repeat(64);
  const pending = {
    kind: "input",
    action: "set_value",
    id: 3,
    operationId: "owned",
    pid: 17,
    sequence: 2,
    monotonicMs: 1000,
    navigationHash: hash,
    target: "new-tab",
  };
  const witness = { entries: 1, completed: 0, closed: 0, urlHash: hash };
  assert.deepEqual(heldNavigationEntry([pending], witness, hash), pending);
  for (const [rows, state] of [
    [[pending], { ...witness, entries: 0 }],
    [[pending], { ...witness, entries: 2 }],
    [[pending], { ...witness, closed: 1 }],
    [[pending], { ...witness, urlHash: "b".repeat(64) }],
    [[{ ...pending, navigationHash: "b".repeat(64) }], witness],
    [[pending, { ...pending, id: 4 }], witness],
    [[pending, { kind: "input", action: "health", id: 2, pid: 17 }], witness],
    [[pending, { kind: "output", id: 3, pid: 17 }], witness],
  ])
    assert.equal(heldNavigationEntry(rows, state, hash), undefined);
  const response = {
    kind: "output",
    id: 3,
    pid: 17,
    sequence: 5,
    monotonicMs: 1400,
    result: { ok: false, action: "set_value", error: "COMPUTER_USE_STOPPED" },
  };
  const end = {
    kind: "input",
    action: "operation_end",
    id: 4,
    pid: 17,
    operationId: "owned",
    sequence: 6,
    monotonicMs: 1450,
  };
  const ack = {
    kind: "output",
    id: 4,
    pid: 17,
    sequence: 7,
    monotonicMs: 1500,
    result: { ok: true, action: "operation_end", released: true },
  };
  const control = {
    kind: "input",
    cancel: 3,
    pid: 17,
    sequence: 3,
    monotonicMs: 1200,
  };
  const rows = [pending, control, response, end, ack];
  const cancelled = {
    ...response,
    result: { ok: false, action: "set_value", error: "COMPUTER_USE_CANCELLED" },
  };
  const acceptedCancelled = assessCommandSettlement(pending, [
    pending,
    control,
    cancelled,
    end,
    ack,
  ]);
  assert.equal(acceptedCancelled.status, "observed");
  assert.equal(
    acceptedCancelled.response.result.error,
    "COMPUTER_USE_CANCELLED",
  );
  assert.equal(assessCommandSettlement(pending, rows).status, "observed");
  assert.equal(
    assessCommandSettlement(pending, [
      pending,
      control,
      response,
      end,
      { ...ack, monotonicMs: 16000 },
    ]).status,
    "failed",
  );
  for (const broken of [
    [pending, response, end, ack],
    [pending, { ...control, cancel: 99 }, response, end, ack],
    [pending, { ...control, pid: 99 }, response, end, ack],
    [pending, { ...control, sequence: 6 }, response, end, ack],
    [
      pending,
      control,
      {
        ...response,
        result: { ok: false, action: "set_value", error: "AbortError" },
      },
      end,
      ack,
    ],
    [pending, control, { ...response, id: 99 }, end, ack],
    [pending, control, { ...response, monotonicMs: 16000 }, end, ack],
    [
      pending,
      {
        ...response,
        result: { ok: true, action: "set_value", stillLoading: true },
      },
      end,
      ack,
    ],
    [pending, control, response, end],
    [
      pending,
      control,
      response,
      end,
      {
        ...ack,
        result: { ok: true, action: "operation_end", released: false },
      },
    ],
  ])
    assert.notEqual(
      assessCommandSettlement(pending, broken).status,
      "observed",
    );
});

test("navigation observer records only the allowlisted URL hash and public target class", async () => {
  const { createHash } = await import("node:crypto");
  const { commandObserver } = await helper();
  const folder = await mkdtemp(join(tmpdir(), "pi-navigation-observer-"));
  try {
    const trace = join(folder, "worker.jsonl"),
      url = "http://127.0.0.1:1234/held-owned";
    const hash = createHash("sha256").update(url).digest("hex");
    const child = spawn(
      process.execPath,
      [
        "--import",
        commandObserver(trace, hash),
        "-e",
        "process.stdin.resume();process.stdin.on('end',()=>process.stdout.write(JSON.stringify({id:3,result:{ok:false,action:'set_value',error:'http://127.0.0.1:1234/private-error-body'}})+'\\n'))",
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    const closed = once(child, "close");
    child.stdout.resume();
    child.stderr.resume();
    child.stdin.end(
      JSON.stringify({
        id: 3,
        action: "set_value",
        operationId: "owned",
        args: { elementId: "new-tab", value: url },
      }) + "\n",
    );
    assert.equal((await closed)[0], 0);
    const text = await readFile(trace, "utf8"),
      rows = text
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
    assert.equal(text.includes(url), false);
    assert.equal(text.includes("private-error-body"), false);
    assert.ok(
      rows.some(
        (row) =>
          row.kind === "input" &&
          row.navigationHash === hash &&
          row.target === "new-tab",
      ),
    );
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
