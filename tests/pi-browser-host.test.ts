import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const run = promisify(execFile);
test("real-browser plan works without a build, dependencies, credentials or child commands", async () => {
  const folder = await mkdtemp(join(tmpdir(), "pi-browser-plan-"));
  try {
    for (const name of ["pi-browser-host.mjs", "pi-browser-fixture.mjs"])
      await copyFile(new URL(name, import.meta.url), join(folder, name));
    const result = await run(
      process.execPath,
      [join(folder, "pi-browser-host.mjs"), "--plan"],
      {
        env: { PATH: "", PI_CODING_AGENT_DIR: join(folder, "no-auth") },
      },
    );
    const plan = JSON.parse(result.stdout);
    assert.equal(plan.mode, "plan");
    assert.deepEqual(plan.scenarios, ["form", "advanced", "stale"]);
    assert.deepEqual(plan.requested, {
      provider: "openai",
      model: "gpt-6.1-sol",
      thinking: "low",
    });
    assert.deepEqual((await readdir(folder)).sort(), [
      "pi-browser-fixture.mjs",
      "pi-browser-host.mjs",
    ]);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test("plan rejects unknown flags instead of silently forwarding unsafe Pi options", async () => {
  await assert.rejects(
    run(process.execPath, [
      new URL("./pi-browser-host.mjs", import.meta.url).pathname,
      "--plan",
      "--extensions",
    ]),
  );
});

const effective = [
  { provider: "openai", model: "gpt-6.1-sol", thinkingLevel: "low" },
];
const formReport = () => ({
  requested: { provider: "openai", model: "gpt-6.1-sol", thinking: "low" },
  effective,
  lifecycle: { settled: true, aborted: false, exitCode: 0 },
  cleanup: { profileEmpty: true, processCount: 0, fixtureExited: true },
  oracle: {
    payload: {
      name: "Pi 中文 café 😀",
      notes: "First line\n第二行 café 😀",
      accepted: true,
      choice: "beta",
    },
    events: { submissions: 1, starts: 1, ready: 1 },
  },
  observations: [
    {
      ok: true,
      action: "wait_for",
      query: "Delayed result ready",
      verification: "observed",
    },
  ],
});
const verify = async (scenario: string, facts: unknown) => {
  const script =
    "const {verifyOutcome}=await import(process.argv[1]);console.log(JSON.stringify(verifyOutcome(process.argv[2],JSON.parse(process.argv[3]))));";
  const result = await run(process.execPath, [
    "--input-type=module",
    "-e",
    script,
    new URL("./pi-browser-fixture.mjs", import.meta.url).href,
    scenario,
    JSON.stringify(facts),
  ]);
  return JSON.parse(result.stdout);
};
test("form acceptance requires actual delayed evidence, effective settings and confirmed cleanup", async () => {
  const facts = formReport();
  assert.equal((await verify("form", facts)).pass, true);
  for (const contradictory of [
    { found: false },
    { conclusive: false },
    { timedOut: true },
  ]) {
    assert.equal(
      (
        await verify("form", {
          ...facts,
          observations: [{ ...facts.observations[0], ...contradictory }],
        })
      ).pass,
      false,
    );
  }
  assert.equal(
    (
      await verify("form", {
        ...facts,
        lifecycle: { ...facts.lifecycle, parseError: true },
      })
    ).pass,
    false,
  );
  assert.equal(
    (
      await verify("form", {
        ...facts,
        observations: [
          {
            ok: true,
            action: "find",
            query: "Delayed result ready",
            matches: [],
          },
        ],
      })
    ).pass,
    false,
  );
  assert.equal(
    (
      await verify("form", {
        ...facts,
        effective: [{ ...effective[0], thinkingLevel: "high" }],
      })
    ).pass,
    false,
  );
  assert.equal(
    (
      await verify("form", {
        ...facts,
        cleanup: { ...facts.cleanup, fixtureExited: false },
      })
    ).pass,
    false,
  );
});
test("advanced acceptance deduplicates download metadata and requires the actual reported path", async () => {
  const file = {
    name: "pi-advanced-owned.txt",
    file: "C:\\owned\\pi-advanced-owned.txt",
    state: "completed",
  };
  const facts = {
    ...formReport(),
    base: "http://127.0.0.1:1234/",
    observations: [
      {
        ok: true,
        action: "click",
        tab: { id: "t1", url: "http://127.0.0.1:1234/advanced" },
        dialog: { type: "alert" },
      },
      {
        ok: true,
        action: "keypress",
        tab: { id: "t1", url: "http://127.0.0.1:1234/advanced" },
        handledDialog: "accepted",
      },
    ],
    downloadName: file.name,
    downloadExact: true,
    finalReport: file.file,
    oracle: {
      upload: { name: "fixture-upload.txt", content: "upload fixture only" },
      uploadRequests: 1,
      downloads: 1,
    },
    advancedObserved: {
      child: true,
      returned: true,
      prompt: true,
      confirm: true,
      alert: true,
      upload: true,
    },
    downloads: [file, file],
  };
  assert.equal((await verify("advanced", facts)).pass, true);
  for (const intervening of [
    [
      {
        ok: true,
        action: "accessibility_tree",
        tab: { id: "t1", url: "http://127.0.0.1:1234/advanced" },
        text: "Advanced browser fixture",
      },
      {
        ok: true,
        action: "click",
        tab: { id: "t1", url: "http://127.0.0.1:1234/advanced" },
        dialog: { type: "prompt" },
      },
    ],
    [
      {
        ok: true,
        action: "click",
        tab: { id: "t1", url: "http://127.0.0.1:1234/advanced" },
        dialog: { type: "prompt" },
      },
    ],
    [
      {
        ok: true,
        action: "set_value",
        tab: { id: "t1", url: "http://127.0.0.1:1234/child" },
      },
      {
        ok: true,
        action: "click",
        tab: { id: "t1", url: "http://127.0.0.1:1234/advanced" },
        dialog: { type: "prompt" },
      },
    ],
  ])
    assert.equal(
      (
        await verify("advanced", {
          ...facts,
          observations: [
            facts.observations[0],
            ...intervening,
            facts.observations[1],
          ],
        })
      ).pass,
      false,
      "accepting a later prompt cannot certify the earlier alert",
    );

  assert.equal(
    (
      await verify("advanced", {
        ...facts,
        observations: [
          facts.observations[0],
          {
            ok: true,
            action: "accessibility_tree",
            tab: { id: "t1", url: "http://127.0.0.1:1234/advanced" },
            text: "Advanced browser fixture",
          },
        ],
      })
    ).pass,
    false,
  );
  assert.equal(
    (
      await verify("advanced", {
        ...facts,
        observations: [
          facts.observations[0],
          {
            ...facts.observations[1],
            tab: { id: "unowned", url: "http://127.0.0.1:1234/advanced" },
          },
        ],
      })
    ).pass,
    false,
  );

  assert.equal(
    (await verify("advanced", { ...facts, finalReport: "C:\\invented.txt" }))
      .pass,
    false,
  );
  assert.equal(
    (
      await verify("advanced", {
        ...facts,
        oracle: { ...facts.oracle, downloads: 2 },
      })
    ).pass,
    false,
  );
});
test("a guard-generated stale message never certifies product recovery", async () => {
  const facts = {
    ...formReport(),
    audit: [
      {
        type: "controlled_stale_result",
        result: {
          details: {
            ok: false,
            error: "SCOPED_FIXTURE_DENIED: STALE_BROWSER_REFERENCE",
          },
        },
      },
    ],
  };
  assert.equal((await verify("stale", facts)).pass, false);
});

test("stale recovery requires a successful result for the newly observed field action", async () => {
  const stale = { ok: false, error: "STALE_BROWSER_REFERENCE: old document" };
  const facts = {
    ...formReport(),
    promptObserved: true,
    oracle: {
      payload: {
        name: "Second form 中文 café 😀",
        notes: "Recovered second line\n第二行",
        accepted: true,
        choice: "beta",
      },
      events: { submissions: 1 },
    },
    audit: [
      {
        type: "first_form_oracle",
        oracle: {
          payload: {
            name: "First form 中文",
            notes: "Seed café 😀",
            accepted: true,
            choice: "alpha",
          },
          events: { submissions: 1 },
        },
      },
      { type: "controlled_reload", oldElementId: "t1:1" },
      { type: "controlled_stale_result", result: { details: stale } },
      {
        type: "after_stale_oracle",
        oracle: { payload: null, events: { submissions: 0 } },
        info: { details: { ok: true, element: { value: "" } } },
      },
      { type: "guard_tool_result", details: stale },
      {
        type: "guard_tool_result",
        toolName: "windows_computer_use_accessibility_tree",
        details: { ok: true, nodes: [{ name: "Name", id: "t1:2" }] },
      },
      {
        type: "guard_tool_call",
        toolName: "windows_computer_use_set_value",
        toolCallId: "fresh",
        input: { elementId: "t1:2" },
      },
      { type: "guard_tool_result", toolCallId: "fresh", details: { ok: true } },
    ],
  };
  assert.equal((await verify("stale", facts)).pass, true);
  assert.equal(
    (await verify("stale", { ...facts, audit: facts.audit.slice(0, -1) })).pass,
    false,
  );
  assert.equal(
    (
      await verify("stale", {
        ...facts,
        audit: [
          ...facts.audit.slice(0, -1),
          {
            type: "guard_tool_result",
            toolCallId: "other",
            details: { ok: true },
          },
        ],
      })
    ).pass,
    false,
  );
});

// These subprocess fixtures are Linux executables, never Windows workers or models.
for (const mode of ["query-failure", "deadline"]) {
  test(`retained ${mode} keeps fixture ownership and fences later dispatch/cases`, {
    skip: process.platform !== "linux",
  }, async () => {
    const folder = await mkdtemp(join(tmpdir(), "pi-browser-retention-"));
    const output = join(folder, "output"),
      bin = join(folder, "bin"),
      queries = join(folder, "queries");
    const put = async (path: string, body: string, executable = false) => {
      await mkdir(join(path, ".."), { recursive: true });
      await writeFile(path, body, { mode: executable ? 0o700 : 0o600 });
    };
    let controller: ReturnType<typeof spawn> | undefined,
      owner:
        | {
            keeperPid?: number;
            fixtureChildPid?: number;
            piPid?: number;
            profile?: string;
            fixtureUrl?: string;
          }
        | undefined;
    let journal = "";
    const until = async <T>(sample: () => Promise<T | undefined>) => {
      for (let i = 0; i < 400; i++) {
        const result = await sample();
        if (result !== undefined) return result;
        await new Promise((r) => setTimeout(r, 20));
      }
      throw Error("fixture observation deadline");
    };
    const fakeGone = async (pid: number, needle: string) => {
      try {
        return !(await readFile(`/proc/${pid}/cmdline`, "utf8")).includes(
          needle,
        );
      } catch {
        return true;
      }
    };
    const stopFake = async (pid: number | undefined, needle: string) => {
      if (pid && !(await fakeGone(pid, needle))) process.kill(pid, "SIGTERM");
    };
    try {
      for (const name of ["pi-browser-host.mjs", "pi-browser-fixture.mjs"])
        await put(
          join(folder, "tests", name),
          await readFile(new URL(name, import.meta.url), "utf8"),
        );
      for (const path of [
        "src/browser.ts",
        "src/worker.ts",
        "dist/browser.js",
        "dist/worker.js",
      ])
        await put(join(folder, path), "// Passive external-host fixture\n");
      await put(join(folder, "package.json"), '{"type":"module"}');
      await put(
        join(folder, "dist/launcher.js"),
        "export async function nativeWorkerLaunch(){return {executable:process.execPath}};",
      );
      await put(
        join(folder, "dist/extension.js"),
        "export default pi=>pi.registerTool({name:'windows_computer_use_set_value',execute:async()=>({details:{ok:true}})});",
      );
      await put(
        join(bin, "git"),
        "#!/bin/sh\nprintf '%s\\n' fixture-revision\n",
        true,
      );
      await put(
        join(bin, "wslpath"),
        "#!/bin/sh\nprintf '%s\\n' \"$2\"\n",
        true,
      );
      const shell = (value: string) =>
        "'" + value.replaceAll("'", "'\\''") + "'";
      const psFixture = join(folder, "powershell-fixture.cjs");
      await put(
        psFixture,
        `const fs=require('node:fs');const ps=Buffer.from(process.argv.at(-1),'base64').toString('utf16le');fs.appendFileSync(process.env.PI_CU_FAKE_QUERIES,ps+'\\n');if(ps.includes("$ErrorActionPreference='Stop'")&&/Get-CimInstance[^|]*-ErrorAction Stop/.test(ps))process.exit(7);console.log(JSON.stringify({count:0,version:'fixture'}));`,
      );
      await put(
        join(folder, "windows/System32/WindowsPowerShell/v1.0/powershell.exe"),
        `#!/bin/sh\nexec ${shell(process.execPath)} ${shell(psFixture)} "$@"\n`,
        true,
      );
      const pkg = join(folder, "node_modules/@earendil-works/pi-coding-agent");
      await put(
        join(pkg, "package.json"),
        '{"type":"module","version":"1.4.0","exports":"./dist/index.js"}',
      );
      await put(join(pkg, "dist/index.js"), "export {};");
      await put(
        join(pkg, "dist/bundle/cli.js"),
        mode === "deadline"
          ? "setInterval(()=>{},1000);"
          : "console.log(JSON.stringify({type:'agent_settled',aborted:false}));",
      );
      await put(
        join(folder, "tests/browser-actions-server.mjs"),
        `const http=require('node:http'),fs=require('node:fs'),p=require('node:path');const settings=p.join(process.env.PI_CU_FAKE_ROOT,'settings.json');fs.writeFileSync(settings,'{}');const s=http.createServer((q,r)=>{r.end('owned fixture');if(q.url==='/stop')s.close(()=>process.exit(0));});s.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({url:'http://127.0.0.1:'+s.address().port+'/',settings,upload:p.join(process.env.PI_CU_FAKE_ROOT,'upload.txt'),downloadName:'owned.txt'})));process.stdin.resume();process.stdin.on('end',()=>s.close(()=>process.exit(0)));`.replace(
          "const http=require",
          "import{createRequire}from'node:module';const require=createRequire(import.meta.url);const http=require",
        ),
      );
      controller = spawn(
        process.execPath,
        [join(folder, "tests/pi-browser-host.mjs"), "--scenario", "all"],
        {
          env: {
            ...process.env,
            PATH: bin,
            WINDIR: join(folder, "windows"),
            PI_CU_FAKE_ROOT: folder,
            PI_CU_FAKE_QUERIES: queries,
            PI_CU_RELEASE_OUTPUT: output,
            PI_CU_TEST_TIMEOUT_MS: mode === "deadline" ? "250" : "10000",
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      controller.stdout?.resume();
      controller.stderr?.resume();
      const retained = await until(async () => {
        try {
          const dirs = await readdir(output);
          if (dirs.length !== 1) return undefined;
          journal = join(output, dirs[0] ?? "", "owner.json");
          owner = JSON.parse(await readFile(journal, "utf8"));
          const r = JSON.parse(
            await readFile(join(output, dirs[0] ?? "", "report.json"), "utf8"),
          );
          return r.retained ? r : undefined;
        } catch {
          return undefined;
        }
      });
      assert.equal(retained.verification.pass, false);
      assert.equal(
        retained.reason,
        mode === "deadline"
          ? "host-deadline-ownership-retained"
          : "owned-process-or-profile-evidence-unavailable",
      );
      assert.equal(owner?.keeperPid, controller.pid);
      process.kill(controller.pid ?? 0, 0);
      assert.equal(
        await (await fetch(owner?.fixtureUrl ?? "")).text(),
        "owned fixture",
      );
      await new Promise((r) => setTimeout(r, 300));
      assert.equal(
        (await readdir(output)).length,
        1,
        "retention must not launch the next case",
      );
      if (mode === "query-failure")
        assert.match(
          await readFile(queries, "utf8"),
          /Get-CimInstance[^|]*-ErrorAction Stop/,
        );
      const guardJournal = join(folder, "guard-owner.json");
      await copyFile(journal, guardJournal);
      const script =
        "const handlers=new Map(),tools=new Map();const {default:scope}=await import(process.argv[1]);await scope({on:(n,h)=>handlers.set(n,h),registerTool:d=>tools.set(d.name,d)});let dispatches=0;const event={toolName:'windows_computer_use_set_value',input:{elementId:'new-tab',value:process.env.FIXTURE_BASE+'form'}};const blocked=await handlers.get('tool_call')(event);if(!blocked?.block){await tools.get(event.toolName).execute('id',event.input);dispatches++;}console.log(JSON.stringify({blocked:blocked?.block,dispatches}));";
      const blocked = await run(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          script,
          new URL(`file://${folder}/tests/pi-browser-fixture.mjs`).href,
        ],
        {
          env: {
            ...process.env,
            FIXTURE_BASE: owner?.fixtureUrl,
            PI_CU_TEST_SPEC: JSON.stringify({
              base: owner?.fixtureUrl,
              scenario: "form",
              auditFile: join(folder, "guard.jsonl"),
              journal: guardJournal,
            }),
          },
        },
      );
      assert.deepEqual(JSON.parse(blocked.stdout), {
        blocked: true,
        dispatches: 0,
      });
      const running = {
        ...JSON.parse(await readFile(guardJournal, "utf8")),
        phase: "running",
      };
      await writeFile(guardJournal, JSON.stringify(running));
      const allowed = await run(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          script,
          new URL(`file://${folder}/tests/pi-browser-fixture.mjs`).href,
        ],
        {
          env: {
            ...process.env,
            FIXTURE_BASE: owner?.fixtureUrl,
            PI_CU_TEST_SPEC: JSON.stringify({
              base: owner?.fixtureUrl,
              scenario: "form",
              auditFile: join(folder, "guard.jsonl"),
              journal: guardJournal,
            }),
          },
        },
      );
      assert.deepEqual(
        JSON.parse(allowed.stdout),
        { dispatches: 1 },
        "running journal permits the known initial fixture action",
      );
    } finally {
      // All listed children are known passive fixtures; no real desktop owner is killed.
      if (owner?.fixtureUrl)
        await fetch(owner.fixtureUrl + "stop").catch(() => {});
      await stopFake(owner?.piPid, folder);
      await stopFake(owner?.fixtureChildPid, folder);
      controller?.kill("SIGTERM");
      if (owner?.profile?.includes("pi-model-profile-"))
        await rm(owner.profile, { recursive: true, force: true });
      await rm(folder, { recursive: true, force: true });
    }
  });
}
