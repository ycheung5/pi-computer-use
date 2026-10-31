// Live WSL/native Windows Pi-tool ownership test. Uses read-only window listing.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { WorkerClient } from "../dist/client.js";
import computerUse from "../dist/extension.js";
import { nativeWorkerLaunch } from "../dist/launcher.js";
import { computerUseHost } from "./native-host.mjs";

const run = promisify(execFile);
const launch = await nativeWorkerLaunch();
let peer = fileURLToPath(new URL("./ownership-peer.mjs", import.meta.url));
if (process.platform === "linux")
  peer = (await run("wslpath", ["-w", peer])).stdout.trim();
const contender = new WorkerClient({
  launch: async () => ({ ...launch, args: [peer] }),
});
const host = computerUseHost();
computerUse(host.api);
const tool = host.tools.get("windows_computer_use_list_windows");
const list = () =>
  tool.execute("wsl-list", { maxWindows: 1 }, undefined, undefined, {});
try {
  await host.emit("before_agent_start", { messageType: "user" });
  assert.equal((await list()).isError, false);
  const busy = (await contender.execute("list", {})).toolResult;
  assert.equal(
    busy.isError,
    true,
    "a native Windows competitor must be rejected, not allowed to interleave",
  );
  assert.match(JSON.stringify(busy), /COMPUTER_USE_BUSY/);
  await host.emit("agent_end", {});
  assert.equal(
    (await contender.execute("list", {})).toolResult.isError,
    true,
    "agent_end is not final settlement",
  );
  await host.emit("agent_settled", {});
  assert.equal(
    (await contender.execute("list", {})).toolResult.isError,
    false,
    "settlement releases ownership",
  );
  assert.equal(
    (await list()).isError,
    true,
    "the original session is now a competitor",
  );
  await new Promise((resolve) => setTimeout(resolve, 1000));
  assert.equal(
    (await list()).isError,
    true,
    "a live owner is not stolen based on time passing",
  );
  await contender.execute("crash", {});
  const deadline = Date.now() + 5000;
  for (;;) {
    const recovered = await list();
    if (!recovered.isError) break;
    if (Date.now() > deadline)
      throw new Error("crashed owner was not released");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  console.log(
    JSON.stringify({
      ok: true,
      host: process.platform,
      contender: "win32",
      busyRejected: true,
      settlement: true,
      crashRecovery: true,
      liveOwnerNotStolen: true,
    }),
  );
} finally {
  for (const handler of host.shutdown) await handler();
  await contender.dispose();
}
