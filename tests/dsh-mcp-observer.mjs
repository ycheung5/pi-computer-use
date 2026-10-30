// Transparent discovery-only observer. Never forwards desktop tool calls.
import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

const [server, trace] = process.argv.slice(2);
appendFileSync(trace, `${JSON.stringify({ observerStart: process.pid })}\n`);
const child = spawn(process.execPath, [server], {
  stdio: ["pipe", "pipe", "pipe"],
});
child.stderr.resume();
const requests = new Map();
const allowed = new Set([
  "server/discover",
  "initialize",
  "notifications/initialized",
  "tools/list",
  "ping",
]);
createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  appendFileSync(trace, `${JSON.stringify({ request: message.method })}\n`);
  if (!allowed.has(message.method)) {
    child.kill();
    process.exitCode = 1;
    process.stdin.destroy();
    return;
  }
  if (message.id != null) requests.set(message.id, message.method);
  child.stdin.write(`${line}\n`);
});
createInterface({ input: child.stdout }).on("line", (line) => {
  const message = JSON.parse(line);
  if (requests.get(message.id) === "tools/list") {
    appendFileSync(
      trace,
      `${JSON.stringify({ response: "tools/list", names: message.result?.tools?.map((tool) => tool.name) })}\n`,
    );
  }
  process.stdout.write(`${line}\n`);
});
process.stdin.on("end", () => child.stdin.end());
child.on("close", (code) => {
  appendFileSync(
    trace,
    `${JSON.stringify({ referenceExit: code, observer: process.pid })}\n`,
  );
  process.exitCode ||= code ?? 1;
});
