// Dedicated interactive Windows desktop only. Requires an actual physical stop key.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { WorkerClient } from "../dist/client.js";
import { nativeWorkerLaunch } from "../dist/launcher.js";
import { observeReleased, waitForStart } from "./stop-busy-coordination.mjs";
import { assessStop } from "./stop-busy-outcome.mjs";

assert.equal(process.platform, "win32");
assert.equal(
  process.env.PI_CU_DEDICATED_INPUT_DESKTOP,
  "1",
  "Dedicated idle interactive Windows desktop required",
);
const mode = process.argv[2] ?? "esc";
assert.ok(["esc", "shortcut"].includes(mode), "Use esc or shortcut");
const statusFile = process.env.PI_CU_STOP_STATUS_FILE;
if (statusFile)
  await writeFile(statusFile, JSON.stringify({ phase: "setup", mode }), {
    flag: "wx",
  });
const status = async (phase) => {
  if (statusFile) await writeFile(statusFile, JSON.stringify({ phase, mode }));
};
const folder = await mkdtemp(join(tmpdir(), "pi-cu-stop-busy-"));
process.env.PI_CU_SETTINGS_FILE = join(folder, "settings.json");
const executable = join(folder, "fixture.exe");
const compiler = join(
  process.env.WINDIR,
  "Microsoft.NET",
  "Framework64",
  "v4.0.30319",
  "csc.exe",
);
const built = spawnSync(
  compiler,
  [
    "/nologo",
    "/target:exe",
    `/out:${executable}`,
    "/r:System.Windows.Forms.dll",
    "/r:System.Drawing.dll",
    fileURLToPath(new URL("./stop-busy-fixture.cs", import.meta.url)),
  ],
  { encoding: "utf8", cwd: folder, windowsHide: true },
);
assert.equal(built.status, 0, built.stdout + built.stderr);
const fixture = spawn(executable, [`Pi CU Stop ${Date.now()}`], {
  stdio: ["pipe", "pipe", "pipe"],
  cwd: folder,
});
const lines = createInterface({ input: fixture.stdout });
const pending = [];
const received = [];
lines.on("line", (line) => {
  const index = pending.findIndex((item) => item.pattern.test(line));
  if (index >= 0) {
    const item = pending.splice(index, 1)[0];
    clearTimeout(item.timer);
    item.resolve(line);
  } else received.push(line);
});
function line(pattern, milliseconds = 5000) {
  const index = received.findIndex((value) => pattern.test(value));
  if (index >= 0) return Promise.resolve(received.splice(index, 1)[0]);
  return new Promise((resolve, reject) => {
    const item = {
      pattern,
      resolve,
      timer: setTimeout(() => {
        const i = pending.indexOf(item);
        if (i >= 0) pending.splice(i, 1);
        reject(new Error(`Timed out waiting for ${pattern}`));
      }, milliseconds),
    };
    pending.push(item);
  });
}
async function bounded(promise, ms, description) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(description)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
const operation = `stop-busy-${Date.now()}`;
let stopped = false,
  started = false,
  settled = false,
  inputAttempted = false;
const worker = new WorkerClient({
  launch: nativeWorkerLaunch,
  onStop: (id) => {
    if (id === operation) stopped = true;
  },
});
const observe = async () => {
  const result = line(/^state:/);
  fixture.stdin.write("observe\n");
  const match = (await result).match(/^state:(\d+):(released|held)$/);
  assert.ok(match);
  return { count: Number(match[1]), keysReleased: match[2] === "released" };
};
try {
  const ready = (await line(/^ready:/)).match(/^ready:(\d+)$/);
  assert.ok(ready && fixture.pid > 0);
  const target = {
    nativeWindowHandle: Number(ready[1]),
    processId: fixture.pid,
  };
  const settings = await worker.execute("settings_update", {
    changes: {
      indicatorEnabled: false,
      cursorIndicatorEnabled: false,
      stopShortcut: mode === "shortcut" ? "Ctrl+Alt+F9" : "",
    },
  });
  assert.equal(settings.ok, true, JSON.stringify(settings));
  const initial = await observe();
  assert.deepEqual(initial, { count: 0, keysReleased: true });
  const total = 2000;
  console.log("Fixture ready. Send start followed by Enter on stdin to begin.");
  await status("ready");
  await waitForStart(process.stdin, 120000);
  const notification = line(/^started$/, 20000).then(async () => {
    started = true;
    await status("started");
    console.log(
      `Input has started. Press ${mode === "esc" ? "Esc" : "Ctrl+Alt+F9"} physically now.`,
    );
  });
  inputAttempted = true;
  const typing = worker
    .execute(
      "type_text",
      {
        ...target,
        text: "x".repeat(total),
        method: "sendinput",
        activate: true,
      },
      undefined,
      operation,
    )
    .then(
      (value) => ({ value }),
      (error) => ({ error: String(error) }),
    );
  await notification;
  const deadline = Date.now() + 40000;
  while (!stopped && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 25));
  if (!stopped) {
    worker.stopOperation(operation);
    throw new Error("Physical stop was not observed before the deadline");
  }
  const dispatch = await bounded(
    typing,
    10000,
    "Input response did not settle",
  );
  const retry = await bounded(
    worker.execute("wait", { milliseconds: 1 }, undefined, operation),
    10000,
    "Stopped operation refusal not confirmed",
  );
  assert.equal(retry.ok, false, JSON.stringify(retry));
  assert.match(String(retry.error), /STOPPED/);
  const end = await bounded(
    worker.execute("operation_end", {}, undefined, operation),
    10000,
    "Operation settlement was not confirmed",
  );
  assert.equal(end.ok, true, JSON.stringify(end));
  settled = true;
  const before = await observeReleased(
    observe,
    (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
  );
  await new Promise((resolve) => setTimeout(resolve, 500));
  const after = await observe();
  const evidence = {
    started,
    stopped,
    settled,
    before: before.count,
    after: after.count,
    total,
    keysReleased: before.keysReleased && after.keysReleased,
    releasePollObservations: before.observations,
    dispatch,
  };
  const assessment = assessStop(evidence);
  const recovered = await bounded(
    worker.execute(
      "wait",
      { milliseconds: 1 },
      undefined,
      `${operation}-new-user`,
    ),
    10000,
    "New operation did not recover",
  );
  assert.equal(recovered.ok, true, JSON.stringify(recovered));
  const recoveryEnd = await bounded(
    worker.execute("operation_end", {}, undefined, `${operation}-new-user`),
    10000,
    "Recovery settlement was not confirmed",
  );
  assert.equal(recoveryEnd.ok, true, JSON.stringify(recoveryEnd));
  console.log(
    JSON.stringify({
      ...assessment,
      mode,
      evidence,
      dispatch,
      sameOperationBlocked: true,
      newOperationRecovered: true,
      scope: "Pi worker and physical key only; no held-key or DSH host claim",
    }),
  );
  assert.equal(assessment.ok, true);
} finally {
  if (inputAttempted && !settled) {
    // Retain the live input owner and fixture if the cleanup barrier did not complete.
    console.error(
      JSON.stringify({
        error: "INPUT_SETTLEMENT_UNCONFIRMED",
        fixturePid: fixture.pid,
        folder,
      }),
    );
    await new Promise(() => {});
  }
  await worker.dispose();
  if (fixture.exitCode === null) {
    const closed = once(fixture, "close");
    fixture.stdin.end("stop\n");
    await bounded(closed, 5000, "Fixture exit not confirmed");
  }
  lines.close();
  await rm(folder, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  });
}
