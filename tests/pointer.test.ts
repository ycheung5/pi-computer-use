import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { WorkerClient } from "../src/client.js";

test("pointer actions reject malformed coordinates, paths and dispatch before native input", async () => {
  const worker = new WorkerClient({
    launch: async () => ({
      executable: process.execPath,
      args: [
        "--import",
        "tsx",
        fileURLToPath(new URL("../src/worker.ts", import.meta.url)),
      ],
    }),
  });
  try {
    for (const [action, args] of [
      ["click", {}],
      ["click", { x: 1.5, y: 0 }],
      ["click", { x: 0, y: 0, button: "extra" }],
      ["double_click", { x: 0, y: 0, dispatch: "unguarded" }],
      ["move", { x: 0 }],
      ["drag", { path: [{ x: 0, y: 0 }] }],
      [
        "drag",
        {
          path: [
            { x: 0, y: 0 },
            { x: 1, y: Infinity },
          ],
        },
      ],
      ["scroll", { x: 0, y: 0, deltaY: 0.5 }],
    ] as const) {
      const result = await worker.execute(action, args);
      assert.equal(result.ok, false);
      assert.match(String(result.error), /INVALID_ARGUMENTS/);
    }
  } finally {
    await worker.dispose();
  }
});

test("worker input cleanup notices prevent outer retirement until cleanup acknowledgment", async () => {
  const peer = `require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);if(r.stop){console.log(JSON.stringify({event:'input_state',active:false}));return;}console.log(JSON.stringify({event:'input_state',active:true}));console.log(JSON.stringify({id:r.id,result:{ok:true,action:r.action}}));});`;
  const worker = new WorkerClient({
    launch: async () => ({ executable: process.execPath, args: ["-e", peer] }),
    shutdownMs: 25,
  });
  try {
    await worker.execute("click", {});
    await assert.rejects(worker.retire(), /INPUT_CLEANUP_UNCONFIRMED/);
    worker.stopOperation("fixture");
    await new Promise((resolve) => setTimeout(resolve, 30));
    await worker.retire();
  } finally {
    worker.stopOperation("fixture");
    await new Promise((resolve) => setTimeout(resolve, 30));
    await worker.dispose();
  }
});
