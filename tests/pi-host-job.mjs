// Windows, no desktop input: run a scripted genuine Pi host under a test-only job supervisor.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyHostJob } from "./pi-host-job-outcome.mjs";

assert.equal(process.platform, "win32");
const cli = process.env.PI_CU_PI_CLI;
assert.ok(cli, "PI_CU_PI_CLI must name the Pi CLI");
const folder = mkdtempSync(join(tmpdir(), "pi-cu-host-job-"));
try {
  const agent = join(folder, "agent");
  mkdirSync(agent);
  const exe = join(folder, "supervisor.exe");
  const compiler = join(
    process.env.WINDIR,
    "Microsoft.NET",
    "Framework64",
    "v4.0.30319",
    "csc.exe",
  );
  const built = spawnSync(
    compiler,
    [
      "/nologo",
      `/out:${exe}`,
      fileURLToPath(new URL("./pi-host-job-fixture.cs", import.meta.url)),
    ],
    { encoding: "utf8", windowsHide: true, timeout: 30000 },
  );
  assert.equal(built.status, 0, built.stdout + built.stderr);
  const extension = fileURLToPath(
    new URL("../dist/extension.js", import.meta.url),
  );
  const provider = fileURLToPath(
    new URL("./pi-host-job-provider.ts", import.meta.url),
  );
  const args = [
    process.execPath,
    folder,
    cli,
    "--mode",
    "json",
    "--print",
    "--no-session",
    "--no-extensions",
    "--no-context-files",
    "--no-skills",
    "--no-prompt-templates",
    "--no-themes",
    "--no-mcp",
    "--offline",
    "--provider",
    "pi-cu-job",
    "--model",
    "fixture",
    "-e",
    extension,
    "-e",
    provider,
    "Run the passive fixture.",
  ];
  writeFileSync(
    join(folder, "args"),
    `${args.map((x) => Buffer.from(x, "utf8").toString("base64")).join("\n")}\n`,
  );
  const run = spawnSync(exe, [folder], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 45000,
    env: {
      ...process.env,
      PI_CODING_AGENT_DIR: agent,
      PI_CU_SETTINGS_FILE: join(folder, "settings.json"),
      PI_OFFLINE: "1",
    },
  });
  assert.equal(run.status, 0, run.stderr + String(run.error ?? ""));
  const result = JSON.parse(run.stdout.trim());
  const events = readFileSync(join(folder, "stdout"), "utf8")
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line));
  const health = events.find(
    (x) =>
      x.type === "tool_execution_end" &&
      x.toolName === "windows_computer_use_health",
  );
  const observation = events.find(
    (x) =>
      x.type === "tool_execution_end" &&
      x.toolName === "windows_computer_use_list_windows",
  );
  const wait = events.find(
    (x) =>
      x.type === "tool_execution_end" &&
      x.toolName === "windows_computer_use_wait",
  );
  const report = {
    ...result,
    piHostPid: Number(readFileSync(join(folder, "host-pid"), "utf8")),
    workerPid: health?.result?.details?.processId,
    healthOk: health?.isError === false && health?.result?.details?.ok === true,
    observationAttempted:
      observation?.isError === false &&
      observation?.result?.details?.ok === true,
    waitOk: wait?.isError === false && wait?.result?.details?.ok === true,
    settled:
      events.some((x) => x.type === "agent_settled") &&
      !events.some((x) => x.type === "extension_error"),
    piExit: Number(readFileSync(join(folder, "exit"), "utf8")),
  };
  const assessment = verifyHostJob(report);
  console.log(
    JSON.stringify({
      ...assessment,
      jobEmpty: report.jobEmpty,
      workerInJob: report.members.some((x) => x.pid === report.workerPid),
      windowsNameObserved: report.members.some(
        (x) => x.name.toLowerCase() === "windows",
      ),
      scope:
        "passive native Windows Pi only; no physical input and no claim about escaped descendants",
    }),
  );
  assert.equal(assessment.ok, true);
} finally {
  rmSync(folder, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  });
}
