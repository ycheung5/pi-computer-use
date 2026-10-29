// Run with a Windows Node process after npm run build. Sends no physical input.
import assert from "node:assert/strict";
import computerUse from "../dist/extension.js";
import { computerUseHost } from "./native-host.mjs";

assert.equal(
  process.platform,
  "win32",
  "Run this smoke check with Windows Node",
);
const host = computerUseHost();
computerUse(host.api);
const health = host.tools.get("windows_computer_use_health");
assert.ok(health);
const call = (id) => health.execute(id, {}, undefined, undefined, {});
const read = (result) =>
  JSON.parse(result.content.find((block) => block.type === "text").text);
const first = read(await call("native-1"));
const second = read(await call("native-2"));
assert.equal(first.ok, true);
assert.equal(first.platform, "win32");
assert.equal(first.processId, second.processId);
for (const handler of host.shutdown) await handler();
await assert.rejects(call("after-shutdown"), /disposed/i);
console.log(
  JSON.stringify({
    ok: true,
    check: "native Pi tool factory -> private Windows Node worker",
    reused: true,
    workerNode: first.nodeVersion,
    shutdown: "passed",
  }),
);
