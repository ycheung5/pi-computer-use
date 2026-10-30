import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { WorkerClient } from "../src/client.js";

test("real worker waits for a matching input preparation acknowledgment before native dispatch", {
  skip: process.platform === "win32",
  timeout: 15000,
}, async () => {
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
    `#!/usr/bin/env node\nconst {createInterface}=require('node:readline');const {appendFileSync}=require('node:fs');createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);if(r.cancel)return;if(r.action==='click')appendFileSync(process.env.PI_CU_BARRIER_JOURNAL,'dispatch\\n');console.log(JSON.stringify({id:r.id,result:{ok:true,action:r.action,listenerProcessId:process.pid,cleanupConfirmed:true}}));});\n`,
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
      `${JSON.stringify({ id: 1, action: "click", args: { x: 1, y: 1, dispatch: "foreground" }, operationId: "barrier-test" })}\n`,
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
      `${JSON.stringify({ id: 2, action: "click", args: { x: 1, y: 1, dispatch: "foreground" }, operationId: "barrier-test" })}\n`,
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
      `${JSON.stringify({ id: 3, action: "click", args: { x: 1, y: 1, dispatch: "foreground" }, operationId: "new-operation" })}\n`,
    );
    let disconnected = await next();
    while (disconnected.event !== "input_prepare") disconnected = await next();
    assert.equal(disconnected.requestId, 3);
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
      "dispatch\n",
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
        "click",
        { x: 1, y: 1, dispatch: "foreground" },
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
      "dispatch\ndispatch\n",
      "WorkerClient and the actual worker complete the private handshake",
    );
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
});
