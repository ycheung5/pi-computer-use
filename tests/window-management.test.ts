import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { WorkerClient } from "../src/client.js";

const launch = async () => ({
  executable: process.execPath,
  args: [
    "--import",
    "tsx",
    fileURLToPath(new URL("../src/worker.ts", import.meta.url)),
  ],
});
test("window management validates targets and launch restrictions before native execution", async () => {
  const worker = new WorkerClient({ launch });
  try {
    for (const [action, args] of [
      ["launch_app", {}],
      ["launch_app", { target: "fixture.exe", waitMs: 10001 }],
      ["launch_app", { target: "bad\n.exe" }],
      ["launch_app", { target: "fixture.exe", arguments: "bad\u0000" }],
      ["activate_window", {}],
      ["move_window", { processId: 1, x: 0 }],
      ["move_window", { processId: 1, x: 0.5, y: 2 }],
      ["close_window", { processId: -1 }],
    ] as const) {
      const result = await worker.execute(action, args);
      assert.equal(result.ok, false);
      assert.match(String(result.error), /INVALID_ARGUMENTS|LAUNCH_INVALID/);
    }
    for (const target of [
      "cmd.exe",
      "powershell",
      "C:\\Windows\\System32\\rundll32.exe",
      "wscript.exe",
    ]) {
      const result = await worker.execute("launch_app", {
        target,
        arguments: "run something",
      });
      assert.equal(result.ok, false);
      assert.match(String(result.error), /LAUNCH_COMMAND_REFUSED/);
    }
  } finally {
    await worker.dispose();
  }
});
