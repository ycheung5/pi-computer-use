import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { WorkerClient } from "../src/client.js";

const workerPath = fileURLToPath(new URL("../src/worker.ts", import.meta.url));
const worker = () =>
  new WorkerClient({
    launch: async () => ({
      executable: process.execPath,
      args: ["--import", "tsx", workerPath],
    }),
  });

test("window listing rejects invalid options before attempting native execution", async () => {
  const client = worker();
  try {
    for (const args of [
      { maxWindows: 0 },
      { maxWindows: 201 },
      { maxWindows: 1.5 },
      { includeInvisible: "yes" },
    ]) {
      const result = await client.execute("list_windows", args);
      assert.equal(result.ok, false);
      assert.match(String(result.error), /INVALID_ARGUMENTS/);
    }
    assert.equal((await client.execute("health", {})).ok, true);
  } finally {
    await client.dispose();
  }
});

test("malformed worker envelopes do not terminate later valid requests", async () => {
  const child = spawn(process.execPath, ["--import", "tsx", workerPath], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stdin.end(
    'null\n{"id":1,"action":"health","args":[]}\n{"id":2,"action":"health","args":{}}\n',
  );
  const [code] = await once(child, "close");
  assert.equal(code, 0);
  const results = stdout
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.match(
    results.find((item) => item.id === 1).result.error,
    /INVALID_REQUEST/,
  );
  assert.equal(results.find((item) => item.id === 2).result.ok, true);
});

test("native lifetime targets reject invalid or mixed proof without desktop dispatch", async () => {
  const client = worker();
  try {
    for (const action of [
      "snapshot",
      "screenshot",
      "ocr",
      "type_text",
      "click",
      "wait_for",
      "move_window",
    ]) {
      const result = await client.execute(action, { windowRef: "" });
      assert.equal(result.ok, false);
      assert.match(
        String(result.error),
        /INVALID_ARGUMENTS.*windowRef/,
        action,
      );
    }
    for (const args of [
      { windowRef: "observed", scope: "desktop" },
      { windowRef: "observed", browserTab: "t1234" },
    ]) {
      const result = await client.execute("snapshot", args);
      assert.equal(result.ok, false);
      assert.match(String(result.error), /INVALID_ARGUMENTS.*windowRef/);
    }
  } finally {
    await client.dispose();
  }
});
