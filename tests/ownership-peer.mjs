// Disposable native Windows Pi-host peer for ownership integration checks. No input.
import { createInterface } from "node:readline";
import computerUse from "../dist/extension.js";
import { computerUseHost } from "./native-host.mjs";

const host = computerUseHost();
computerUse(host.api);
let queue = Promise.resolve();
const input = createInterface({ input: process.stdin });
input.on("line", (line) => {
  queue = queue
    .then(async () => {
      const request = JSON.parse(line);
      let result;
      if (request.action === "crash") {
        const health = host.tools.get("windows_computer_use_health");
        const current = await health.execute(
          "native-health",
          {},
          undefined,
          undefined,
          {},
        );
        process.kill(current.details.processId, "SIGKILL");
        result = { ok: true };
      } else if (request.action === "settle") {
        await host.emit("agent_settled", {});
        result = { ok: true };
      } else if (request.action === "new") {
        await host.emit("before_agent_start", { messageType: "user" });
        result = { ok: true };
      } else {
        const tool = host.tools.get("windows_computer_use_list_windows");
        result = await tool.execute(
          "native-list",
          { maxWindows: 1 },
          undefined,
          undefined,
          {},
        );
      }
      process.stdout.write(
        `${JSON.stringify({
          id: request.id,
          result: { ok: true, action: request.action, toolResult: result },
        })}\n`,
      );
    })
    .catch((error) => {
      process.stderr.write(`${String(error)}\n`);
      process.exitCode = 1;
    });
});
input.on("close", () => {
  void queue.finally(async () => {
    for (const handler of host.shutdown) await handler();
  });
});
