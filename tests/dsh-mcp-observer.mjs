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
let closing = false;
let escalation;
let deadline;
function stopChild(failed = false) {
  if (failed) process.exitCode = 1;
  if (closing) return;
  closing = true;
  input.close();
  process.stdin.destroy();
  child.stdin.end();
  escalation = setTimeout(() => {
    process.exitCode = 1;
    child.kill("SIGTERM");
    deadline = setTimeout(() => child.kill("SIGKILL"), 500);
  }, 500);
}
process.on("SIGTERM", () => stopChild(true));
process.on("SIGINT", () => stopChild(true));
child.on("error", (error) => {
  appendFileSync(
    trace,
    `${JSON.stringify({ referenceError: error.code ?? "spawn-failed", observer: process.pid })}\n`,
  );
  stopChild(true);
});
for (const stream of [
  child.stdin,
  child.stdout,
  process.stdin,
  process.stdout,
]) {
  stream.on("error", () => stopChild(true));
}
const input = createInterface({ input: process.stdin });
input.on("line", (line) => {
  const message = JSON.parse(line);
  appendFileSync(trace, `${JSON.stringify({ request: message.method })}\n`);
  if (!allowed.has(message.method)) {
    stopChild(true);
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
process.stdin.on("end", () => stopChild());
child.on("close", (code, signal) => {
  if (!closing) stopChild(true);
  clearTimeout(escalation);
  clearTimeout(deadline);
  appendFileSync(
    trace,
    `${JSON.stringify({ referenceExit: code, signal, observer: process.pid })}\n`,
  );
  process.exitCode ||= code ?? 1;
});
