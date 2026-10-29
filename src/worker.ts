import { createInterface } from "node:readline";
import type { WorkerRequest, WorkerResponse } from "./protocol.js";

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on("line", (line) => {
  let request: WorkerRequest;
  try {
    request = JSON.parse(line) as WorkerRequest;
  } catch {
    process.stderr.write("WORKER_PROTOCOL_ERROR: invalid JSON\n");
    return;
  }
  if (request && "cancel" in request) return;
  const response: WorkerResponse = {
    id: request.id,
    result:
      request.action === "health"
        ? {
            ok: true,
            action: "health",
            processId: process.pid,
            platform: process.platform,
            nodeVersion: process.version,
          }
        : { ok: false, action: request.action, error: "UNKNOWN_ACTION" },
  };
  process.stdout.write(`${JSON.stringify(response)}\n`);
});
