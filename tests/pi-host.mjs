// Real Pi CLI and a production-only tarball install. No network model or physical input.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { nativeWorkerLaunch } from "../dist/launcher.js";

const run = promisify(execFile);
const runPi = (...args) => {
  const operation = run(...args);
  // Print mode consumes piped stdin before prompts; an open unused pipe waits forever.
  operation.child.stdin.end();
  return operation;
};
const root = fileURLToPath(new URL("../", import.meta.url));
const fixtureSource = fileURLToPath(
  new URL("./pi-fixture-provider.ts", import.meta.url),
);
const cli = join(
  dirname(
    fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")),
  ),
  "bundle",
  "cli.js",
);
const folder = await mkdtemp(join(tmpdir(), "pi-cu real host 測試 "));
assert.ok(process.env.npm_execpath, "Run through npm run test:pi");
assert.ok(
  process.platform === "win32" || process.platform === "linux",
  "Windows or WSL2 is required",
);
const options = { timeout: 180000, maxBuffer: 16 * 1024 * 1024 };
const reports = [];
const fixture = join(folder, "fixture-provider.ts");
try {
  await copyFile(fixtureSource, fixture);
  const packed = await run(
    process.execPath,
    [process.env.npm_execpath, "pack", "--json", "--pack-destination", folder],
    { ...options, cwd: root },
  );
  const [{ filename }] = JSON.parse(
    packed.stdout.slice(packed.stdout.indexOf("[")),
  );
  const install = join(folder, "consumer");
  await run(
    process.execPath,
    [
      process.env.npm_execpath,
      "install",
      "--prefix",
      install,
      "--omit=dev",
      "--omit=peer",
      "--ignore-scripts",
      join(folder, filename),
    ],
    options,
  );
  await assert.rejects(access(join(install, "node_modules", "typebox")), {
    code: "ENOENT",
  });
  await assert.rejects(
    access(join(install, "node_modules", "@earendil-works", "pi-coding-agent")),
    { code: "ENOENT" },
  );
  const extension = join(install, "node_modules", "pi-computer-use");
  const cliArguments = [
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
    "pi-cu-preflight",
    "--model",
    "fixture",
  ];
  const capture = (host, result) => {
    assert.equal(result.stderr.trim(), "", `${host}: Pi stderr must be empty`);
    const events = result.stdout
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line));
    const tools = events.filter((event) => event.type === "tool_execution_end");
    assert.deepEqual(
      tools.map((event) => event.toolName),
      ["windows_computer_use_health", "windows_computer_use_list_windows"],
    );
    assert.ok(events.some((event) => event.type === "agent_settled"));
    assert.ok(
      tools.every((event) => event.isError === false),
      `${host}: both read-only tools must pass`,
    );
    assert.equal(tools[0].result.details.platform, "win32");
    assert.equal(tools[1].result.details.ok, true);
    assert.ok(tools[1].result.details.windows.length <= 3);
    const evidence = {
      host,
      ok: true,
      settled: true,
      workerPid: tools[0].result.details.processId,
      node: tools[0].result.details.nodeVersion,
      tools: tools.map((event) => ({
        name: event.toolName,
        durationMs: event.durationMs,
        isError: event.isError,
      })),
    };
    reports.push(evidence);
    console.log(JSON.stringify(evidence));
  };
  const cwd = join(folder, "cwd");
  const agent = join(folder, "agent");
  await mkdir(cwd);
  await mkdir(agent);
  const settings = `pi-cu-fixture-${randomUUID()}.json`;
  capture(
    process.platform === "win32" ? "native-windows" : "wsl2",
    await runPi(
      process.execPath,
      [
        cli,
        ...cliArguments,
        "-e",
        extension,
        "-e",
        fixture,
        "Run only the scripted read-only fixture.",
      ],
      {
        ...options,
        cwd,
        env: {
          ...process.env,
          PI_CODING_AGENT_DIR: agent,
          PI_CU_SETTINGS_FILE: settings,
          PI_OFFLINE: "1",
        },
      },
    ),
  );
  if (process.platform === "linux") {
    const native = await nativeWorkerLaunch();
    const translate = async (path) =>
      (await run("wslpath", ["-w", path])).stdout.trim();
    const translated = await Promise.all(
      [cli, extension, fixture, cwd, agent].map(translate),
    );
    const [
      windowsCli,
      windowsExtension,
      windowsFixture,
      windowsCwd,
      windowsAgent,
    ] = translated;
    // Argument array + JS literals: no shell interpolation of user paths or environment values.
    const code = `import{pathToFileURL}from'node:url';process.env.PI_CODING_AGENT_DIR=${JSON.stringify(windowsAgent)};process.env.PI_CU_SETTINGS_FILE=${JSON.stringify(settings)};process.env.PI_OFFLINE='1';process.chdir(${JSON.stringify(windowsCwd)});process.argv=[process.execPath,${JSON.stringify(windowsCli)},...${JSON.stringify([...cliArguments, "-e", windowsExtension, "-e", windowsFixture, "Run only the scripted read-only fixture."])}];await import(pathToFileURL(${JSON.stringify(windowsCli)}).href);`;
    capture(
      "native-windows-from-wsl",
      await runPi(native.executable, ["--input-type=module", "-e", code], {
        ...options,
        cwd: native.cwd,
      }),
    );
    const pids = reports.map((report) => report.workerPid);
    const check = `$ErrorActionPreference='Stop';foreach($n in @(${pids.join(",")})){if(Get-Process -Id $n -ErrorAction SilentlyContinue){throw 'Worker survived real Pi shutdown'}}`;
    await run(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        Buffer.from(check, "utf16le").toString("base64"),
      ],
      options,
    );
  } else {
    for (const report of reports)
      assert.throws(() => process.kill(report.workerPid, 0), { code: "ESRCH" });
  }
  const version = JSON.parse(
    await readFile(
      join(dirname(dirname(dirname(cli))), "package.json"),
      "utf8",
    ),
  ).version;
  const report = {
    ok: true,
    piVersion: version,
    productionPeersOmitted: true,
    workerCleanup: "passed",
    limitations:
      "scripted public model provider; not clean OS, dedicated physical input or interactive user acceptance",
    hosts: reports,
  };
  if (process.env.PI_CU_RELEASE_OUTPUT) {
    await mkdir(process.env.PI_CU_RELEASE_OUTPUT, { recursive: true });
    await writeFile(
      join(process.env.PI_CU_RELEASE_OUTPUT, "pi-host.json"),
      `${JSON.stringify(report, null, 2)}\n`,
    );
  }
  console.log(JSON.stringify(report));
} finally {
  await rm(folder, { recursive: true, force: true });
}
