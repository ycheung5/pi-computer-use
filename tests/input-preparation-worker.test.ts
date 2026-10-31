import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { WorkerClient } from "../src/client.js";

for (const action of ["click", "scroll"] as const)
  test(
    `real worker waits for a matching input preparation acknowledgment before native ${action} dispatch`,
    { skip: process.platform === "win32", timeout: 15000 },
    () => testInputBarrier(action),
  );

async function testInputBarrier(action: "click" | "scroll") {
  const args =
    action === "scroll"
      ? { elementId: "uia:owned-scroller", deltaY: 240 }
      : { x: 1, y: 1, dispatch: "foreground" };
  const root = await mkdtemp(join(tmpdir(), "pi-cu-input-barrier-"));
  const compiler = join(
    root,
    "windows",
    "Microsoft.NET",
    "Framework64",
    "v4.0.30319",
    "csc.exe",
  );
  const fake = join(root, "fake-native.mjs");
  const journal = join(root, "journal");
  await mkdir(
    join(root, "windows", "Microsoft.NET", "Framework64", "v4.0.30319"),
    { recursive: true },
  );
  await writeFile(
    fake,
    `#!/usr/bin/env node\nconst {createInterface}=require('node:readline');const {appendFileSync}=require('node:fs');createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);if(r.cancel)return;if(r.action==='click'||r.action==='scroll'){appendFileSync(process.env.PI_CU_BARRIER_JOURNAL,'dispatch\\n');if(process.env.PI_CU_BARRIER_HOLD==='1')return;}console.log(JSON.stringify({id:r.id,result:{ok:true,action:r.action,listenerProcessId:process.pid,cleanupConfirmed:process.env.PI_CU_BARRIER_HOLD!=='uncertain'}}));});\n`,
    { mode: 0o755 },
  );
  await writeFile(
    compiler,
    `#!/bin/sh\nfor arg in "$@"; do case "$arg" in /out:*) output="\${arg#/out:}";; esac; done\ncp "$PI_CU_BARRIER_PEER" "$output"\nchmod +x "$output"\n`,
    { mode: 0o755 },
  );
  const worker = pathToFileURL(
    fileURLToPath(new URL("../src/worker.ts", import.meta.url)),
  ).href;
  const boot = `Object.defineProperty(process,'platform',{value:'win32'});await import(${JSON.stringify(worker)});`;
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", boot],
    {
      env: {
        ...process.env,
        WINDIR: join(root, "windows"),
        LOCALAPPDATA: join(root, "local"),
        PI_CU_SETTINGS_FILE: join(root, "settings.json"),
        PI_CU_BARRIER_PEER: fake,
        PI_CU_BARRIER_JOURNAL: journal,
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  const closed = new Promise<void>((resolve) =>
    child.once("close", () => resolve()),
  );
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const lines = createInterface({ input: child.stdout })[
    Symbol.asyncIterator
  ]();
  const next = async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const value = await Promise.race([
      lines.next(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`worker response timeout: ${stderr}`)),
          5000,
        );
      }),
    ]).finally(() => clearTimeout(timer));
    assert.equal(value.done, false, stderr);
    return JSON.parse(value.value);
  };
  try {
    child.stdin.write(
      `${JSON.stringify({ id: 1, action, args, operationId: "barrier-test" })}\n`,
    );
    const preparation = await next();
    assert.equal(
      preparation.event,
      "input_prepare",
      JSON.stringify(preparation),
    );
    assert.equal(preparation.requestId, 1);
    assert.equal(await readFile(journal, "utf8").catch(() => ""), "");
    child.stdin.write(
      `${JSON.stringify({ inputAck: "incorrect", requestId: 1 })}\n`,
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(await readFile(journal, "utf8").catch(() => ""), "");
    child.stdin.write(
      `${JSON.stringify({ inputAck: preparation.token, requestId: 1 })}\n`,
    );
    let result = await next();
    while (result.id !== 1) result = await next();
    assert.equal(result.result.ok, true, JSON.stringify(result));
    assert.equal(await readFile(journal, "utf8"), "dispatch\n");
    child.stdin.write(
      `${JSON.stringify({ id: 2, action, args, operationId: "barrier-test" })}\n`,
    );
    let delayed = await next();
    while (delayed.event !== "input_prepare") delayed = await next();
    assert.equal(delayed.requestId, 2);
    child.stdin.write(`${JSON.stringify({ stop: "barrier-test" })}\n`);
    let stopped = await next();
    while (stopped.id !== 2) stopped = await next();
    assert.equal(stopped.result.ok, false);
    assert.match(stopped.result.error, /STOPPED/);
    child.stdin.write(
      `${JSON.stringify({ inputAck: delayed.token, requestId: 2 })}\n`,
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(
      await readFile(journal, "utf8"),
      "dispatch\n",
      "late acknowledgement must not dispatch",
    );
    child.stdin.write(
      `${JSON.stringify({ id: 3, action, args, operationId: "race-operation" })}\n`,
    );
    let racing = await next();
    while (racing.event !== "input_prepare") racing = await next();
    child.stdin.write(
      `${JSON.stringify({ inputAck: racing.token, requestId: 3 })}\n${JSON.stringify({ stop: "race-operation" })}\n`,
    );
    let raced = await next();
    while (raced.id !== 3) raced = await next();
    const journalAfterRace = await readFile(journal, "utf8");
    assert.ok(
      ["dispatch\n", "dispatch\ndispatch\n"].includes(journalAfterRace),
      "ACK/stop race can dispatch at most once",
    );
    if (!raced.result.ok) assert.match(raced.result.error, /STOPPED/);
    child.stdin.write(
      `${JSON.stringify({ id: 4, action, args, operationId: "new-operation" })}\n`,
    );
    let disconnected = await next();
    while (disconnected.event !== "input_prepare") disconnected = await next();
    assert.equal(disconnected.requestId, 4);
    child.stdin.end();
    let closeTimer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      closed,
      new Promise<never>((_, reject) => {
        closeTimer = setTimeout(
          () => reject(new Error("worker did not exit after stdin close")),
          3000,
        );
      }),
    ]).finally(() => clearTimeout(closeTimer));
    assert.equal(
      await readFile(journal, "utf8"),
      journalAfterRace,
      "stdin close before acknowledgement must not dispatch",
    );
    const wrappedEnv = {
      WINDIR: join(root, "windows"),
      LOCALAPPDATA: join(root, "local2"),
      PI_CU_SETTINGS_FILE: join(root, "settings2.json"),
      PI_CU_BARRIER_PEER: fake,
      PI_CU_BARRIER_JOURNAL: journal,
    };
    const wrappedBoot = `Object.assign(process.env,${JSON.stringify(wrappedEnv)});${boot}`;
    const wrapped = new WorkerClient({
      timeoutMs: 5000,
      launch: async () => ({
        executable: process.execPath,
        args: ["--import", "tsx", "--input-type=module", "-e", wrappedBoot],
      }),
    });
    try {
      const click = await wrapped.execute(
        action,
        args,
        undefined,
        "wrapped-operation",
      );
      assert.equal(click.ok, true, JSON.stringify(click));
      assert.equal(
        (
          await wrapped.execute(
            "operation_end",
            {},
            undefined,
            "wrapped-operation",
          )
        ).ok,
        true,
      );
    } finally {
      await wrapped.dispose();
    }
    assert.equal(
      await readFile(journal, "utf8"),
      `${journalAfterRace}dispatch\n`,
      "WorkerClient and the actual worker complete the private handshake",
    );
    // Cleanup failure must cross the accessibility validation callback without
    // clearing the outer worker's lease, even when the provider returned.
    const uncertainEnv = {
      ...wrappedEnv,
      LOCALAPPDATA: join(root, "local-uncertain"),
      PI_CU_SETTINGS_FILE: join(root, "settings-uncertain.json"),
      PI_CU_BARRIER_HOLD: "uncertain",
    };
    const uncertain = new WorkerClient({
      launch: async () => ({
        executable: process.execPath,
        args: [
          "--import",
          "tsx",
          "--input-type=module",
          "-e",
          `Object.assign(process.env,${JSON.stringify(uncertainEnv)});${boot}`,
        ],
      }),
    });
    let uncertainPid = 0;
    try {
      uncertainPid = Number((await uncertain.execute("health", {})).processId);
      const outcome = await uncertain.execute(
        action,
        args,
        undefined,
        "uncertain-operation",
      );
      assert.equal(outcome.ok, false, JSON.stringify(outcome));
      assert.match(String(outcome.error), /INPUT_CLEANUP_UNCONFIRMED/);
      await assert.rejects(uncertain.dispose(), /INPUT_CLEANUP_UNCONFIRMED/);
    } finally {
      // These are disposable protocol peers, with no physical input capability.
      if (uncertainPid) {
        try {
          process.kill(uncertainPid, "SIGKILL");
        } catch {}
      }
    }
    const crashEnv = {
      ...wrappedEnv,
      LOCALAPPDATA: join(root, "local3"),
      PI_CU_SETTINGS_FILE: join(root, "settings3.json"),
      PI_CU_BARRIER_HOLD: "1",
    };
    const crashBoot = `Object.assign(process.env,${JSON.stringify(crashEnv)});${boot}`;
    const crashed = new WorkerClient({
      timeoutMs: 5000,
      launch: async () => ({
        executable: process.execPath,
        args: ["--import", "tsx", "--input-type=module", "-e", crashBoot],
      }),
    });
    let crashPid = 0;
    try {
      const health = await crashed.execute("health", {});
      crashPid = Number(health.processId);
      assert.ok(crashPid > 0);
      const pending = crashed.execute(
        action,
        args,
        undefined,
        "crash-operation",
      );
      const rejected = assert.rejects(pending, /WORKER_EXITED/);
      for (let i = 0; i < 100; i++) {
        if (
          (await readFile(journal, "utf8")) ===
          `${journalAfterRace}dispatch\ndispatch\ndispatch\n`
        )
          break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.equal(
        await readFile(journal, "utf8"),
        `${journalAfterRace}dispatch\ndispatch\ndispatch\n`,
        "fake native dispatch must start after ACK before crash",
      );
      process.kill(crashPid, "SIGKILL");
      await rejected;
      await assert.rejects(
        crashed.execute("health", {}),
        /INPUT_CLEANUP_UNCONFIRMED/,
      );
      await assert.rejects(crashed.dispose(), /INPUT_CLEANUP_UNCONFIRMED/);
    } finally {
      if (crashPid) {
        try {
          process.kill(crashPid, "SIGKILL");
        } catch {}
      }
    }
  } finally {
    if (!child.stdin.destroyed) child.stdin.end();
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      closed,
      new Promise<void>((resolve) => {
        timer = setTimeout(() => {
          child.kill();
          resolve();
        }, 3000);
      }),
    ]).finally(() => clearTimeout(timer));
    await rm(root, { recursive: true, force: true });
  }
}
