import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
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
    assert.deepEqual(plan.scenarios, [
      "form",
      "advanced",
      "stale",
      "mixed",
      "partial",
      "cancel",
    ]);
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
const { verifyOutcome } = await import(
  new URL("./pi-browser-fixture.mjs", import.meta.url).href
);
const verify = async (scenario: string, facts: unknown) =>
  verifyOutcome(scenario, JSON.parse(JSON.stringify(facts)));

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
for (const mode of [
  "query-failure",
  "deadline",
  "partial-not-ready",
  "held-not-ready",
]) {
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
        "tests/pi-host-command.mjs",
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
        mode.endsWith("not-ready")
          ? `import{writeFileSync}from'node:fs';writeFileSync(${JSON.stringify(join(folder, "model-started"))},"started");console.log(JSON.stringify({type:'agent_settled',aborted:false}));`
          : mode === "deadline"
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
        [
          join(folder, "tests/pi-browser-host.mjs"),
          "--scenario",
          mode === "held-not-ready"
            ? "cancel"
            : mode === "partial-not-ready"
              ? "partial"
              : "all",
        ],
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
          : mode.endsWith("not-ready")
            ? "collector-error-ownership-retained"
            : "owned-process-or-profile-evidence-unavailable",
      );
      if (mode.endsWith("not-ready")) {
        assert.equal(
          owner?.piPid,
          undefined,
          "unready partial fixture never launches Pi",
        );
        assert.deepEqual(
          JSON.parse(
            await readFile(
              join(journal, "..", "fixture-readiness.json"),
              "utf8",
            ),
          ),
          { ready: false },
        );
        await assert.rejects(readFile(join(folder, "model-started")), {
          code: "ENOENT",
        });
      }
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
      const probe = () =>
        run(
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
      const blocked = await probe();
      assert.deepEqual(JSON.parse(blocked.stdout), {
        blocked: true,
        dispatches: 0,
      });
      const running = {
        ...JSON.parse(await readFile(guardJournal, "utf8")),
        phase: "running",
      };
      await writeFile(guardJournal, JSON.stringify(running));
      const allowed = await probe();
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

test("mixed confirmation reveals a code only after exact submission and acknowledges actual owned counters", async () => {
  const { createServer } = await import("node:net");
  const { createInterface } = await import("node:readline");
  const folder = await mkdtemp(join(tmpdir(), "pi-mixed-http-"));
  const pipe =
    process.platform === "win32"
      ? `\\\\.\\pipe\\pi-mixed-${process.pid}`
      : join(folder, "owned.sock");
  const identity = {
    pid: 123,
    creation: "fixture-generation",
    executable: "owned-fixture",
  };
  let count = 0,
    otherCount = 0;
  const oracle = createServer((socket) =>
    socket.once("data", () =>
      socket.end(
        JSON.stringify({
          ok: true,
          identity,
          approve: { code: "7391", count },
          ignore: { code: "2846", count: otherCount },
        }) + "\n",
      ),
    ),
  );
  oracle.listen(pipe);
  await once(oracle, "listening");
  const child = spawn(process.execPath, ["tests/browser-actions-server.mjs"], {
    env: {
      ...process.env,
      PI_CU_MIXED_FIXTURE: JSON.stringify({ pipe, identity }),
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const closed = once(child, "close");
  child.stderr.resume();
  const lines = createInterface({ input: child.stdout });
  try {
    const [line] = await once(lines, "line");
    const { url } = JSON.parse(line);
    const page = await (await fetch(url + "form")).text();
    assert.equal(page.includes("7391"), false);
    assert.equal(page.includes("2846"), false);
    const pre = await (await fetch(url + "mixed/state")).json();
    assert.equal(JSON.stringify(pre).includes("7391"), false);
    const submit = (payload: object) =>
      fetch(url + "form/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
    assert.equal((await submit({ name: "wrong" })).status, 400);
    const payload = {
      name: "Mixed task 中文 café 😀",
      notes: "Browser to native",
      accepted: true,
      choice: "beta",
    };
    assert.deepEqual(await (await submit(payload)).json(), {
      ...payload,
      confirmationCode: "7391",
    });
    assert.equal(
      (await (await fetch(url + "mixed/state")).json()).acknowledgement,
      "Native confirmation pending",
    );
    otherCount = 1;
    assert.equal(
      (await (await fetch(url + "mixed/state")).json()).acknowledgement,
      "Native confirmation pending",
    );
    otherCount = 0;
    count = 1;
    assert.equal(
      (await (await fetch(url + "mixed/state")).json()).acknowledgement,
      "Native confirmation complete: 7391",
    );
    assert.deepEqual(await (await fetch(url + "form/state")).json(), payload);
  } finally {
    child.stdin.end();
    await closed;
    lines.close();
    await new Promise<void>((resolve) => oracle.close(() => resolve()));
    await rm(folder, { recursive: true, force: true });
  }
});

test("browser fixture faults deny dispatch through actual SDK hooks", async () => {
  const folder = await mkdtemp(join(tmpdir(), "pi-browser-guard-faults-"));
  try {
    await mkdir(join(folder, "tests"));
    await mkdir(join(folder, "dist"));
    await copyFile(
      new URL("./pi-browser-fixture.mjs", import.meta.url),
      join(folder, "tests/pi-browser-fixture.mjs"),
    );
    await writeFile(join(folder, "package.json"), '{"type":"module"}');
    await writeFile(
      join(folder, "dist/extension.js"),
      `export default pi=>pi.registerTool({name:'windows_computer_use_set_value',execute:async()=>({content:[],details:{ok:true,tab:{id:'t123',url:'http://127.0.0.1:1234/form'},nodes:[{id:'t123:e1',name:'Name'}]}})});`,
    );
    const script = `
      import {writeFileSync,mkdirSync,rmSync} from 'node:fs';
      import {join} from 'node:path';
      import {pathToFileURL} from 'node:url';
      import {ExtensionRunner,createExtensionRuntime} from '@earendil-works/pi-coding-agent';
      const root=process.argv[1], base='http://127.0.0.1:1234/';
      const {default:scope}=await import(pathToFileURL(join(root,'tests/pi-browser-fixture.mjs')));
      const receipts=[];
      for(const kind of ['running','retained','missing','malformed','unknown-phase','audit-io','window-ref','after-audit-io','after-processing-error','after-stop']) {
        const dir=join(root,kind);mkdirSync(dir);
        const journal=join(dir,'owner.json'),audit=join(dir,'audit.jsonl');
        if(kind!=='missing')writeFileSync(journal,kind==='malformed'?'{':JSON.stringify({phase:kind==='retained'?'retained':kind==='unknown-phase'?'settled':'running'}));
        if(kind==='audit-io')mkdirSync(audit);
        process.env.PI_CU_TEST_SPEC=JSON.stringify({base,scenario:'form',journal,auditFile:audit});
        const handlers=new Map(),tools=new Map();
        await scope({on:(n,h)=>handlers.set(n,[h]),registerTool:d=>tools.set(d.name,d)});
        const runner=new ExtensionRunner([{path:'owned-offline-fixture',handlers}],createExtensionRuntime(),process.cwd(),null,null);
        let errors=0;runner.onError(()=>errors++);
        const event={type:'tool_call',toolName:'windows_computer_use_set_value',toolCallId:kind,input:{elementId:'new-tab',value:base+'form'}};
        if(kind.startsWith('after-')) {
          await runner.emitToolCall(event);
          const result=await tools.get(event.toolName).execute(kind,event.input);
          await runner.emitToolResult({...event,type:'tool_result',...result});
          event.input={elementId:'t123:e1',value:'safe owned value'};
          if(kind==='after-audit-io'){rmSync(audit);mkdirSync(audit);}
          await runner.emitToolResult({...event,type:'tool_result',content:[],isError:kind==='after-audit-io',details:kind==='after-audit-io'?{ok:false,error:'UNKNOWN_MUTATION_RESULT'}:kind==='after-stop'?{ok:false,error:'COMPUTER_USE_STOPPED'}:{ok:true,nodes:{}}});
          if(kind==='after-audit-io'){rmSync(audit,{recursive:true});writeFileSync(audit,'');}
        }
        if(kind==='window-ref')event.input.windowRef='native-lifetime-reference';
        let decision,threw=false,dispatches=0;
        try{decision=await runner.emitToolCall(event);}catch{threw=true;}
        if(!threw&&!decision?.block){await tools.get(event.toolName).execute(kind,event.input);dispatches++;}
        receipts.push({kind,threw,blocked:decision?.block===true,dispatches,sdkErrors:errors});
      }
      console.log(JSON.stringify(receipts));
    `;
    const result = await run(process.execPath, [
      "--input-type=module",
      "-e",
      script,
      folder,
    ]);
    const receipts = JSON.parse(result.stdout) as Array<{
      kind: string;
      threw: boolean;
      blocked: boolean;
      dispatches: number;
      sdkErrors: number;
    }>;
    assert.equal(receipts.length, 10);
    for (const receipt of receipts) {
      assert.equal(receipt.threw, false, JSON.stringify(receipts));
      assert.equal(
        receipt.blocked,
        receipt.kind !== "running",
        JSON.stringify(receipts),
      );
      assert.equal(
        receipt.dispatches,
        receipt.kind === "running" ? 1 : 0,
        JSON.stringify(receipt),
      );
      assert.equal(receipt.sdkErrors, 0, JSON.stringify(receipt));
    }
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test("mixed acceptance requires browser-issued code before native effect and observed completion", async () => {
  const facts = {
    ...formReport(),
    base: "http://127.0.0.1:1234/",
    oracle: {
      payload: {
        name: "Mixed task 中文 café 😀",
        notes: "Browser to native",
        accepted: true,
        choice: "beta",
      },
      events: { submissions: 1 },
    },
    native: {
      owned: { nativeWindowHandle: 11, processId: 22 },
      initial: {
        approve: { code: "7391", count: 0 },
        ignore: { code: "2846", count: 0 },
      },
      final: {
        approve: { code: "7391", count: 1 },
        ignore: { code: "2846", count: 0 },
      },
      receipt: { issuedCode: "7391", confirmations: 1 },
      workerRetired: true,
      cleanup: { fixtureRetired: true, folderRemoved: true },
    },
    finalReport: "Confirmed native completion for 7391",
    audit: [
      {
        type: "guard_tool_result",
        toolName: "windows_computer_use_snapshot",
        details: {
          ok: true,
          tab: { id: "t123", url: "http://127.0.0.1:1234/form" },
          nodes: [
            {
              id: "t123:result",
              role: "status",
              name: 'Form confirmation: {"confirmationCode":"7391"}',
            },
            {
              id: "t123:ack",
              role: "status",
              name: "Native confirmation pending",
            },
          ],
        },
      },
      {
        type: "guard_tool_result",
        toolName: "windows_computer_use_snapshot",
        details: {
          ok: true,
          nativeWindowHandle: 11,
          processId: 22,
          tree: {
            children: [
              { id: "opaque-native", name: "", controlType: "Button" },
            ],
          },
        },
      },
      {
        type: "guard_tool_call",
        toolCallId: "once",
        toolName: "windows_computer_use_invoke",
        input: { elementId: "opaque-native", fallbackClick: false },
      },
      {
        type: "guard_tool_result",
        toolCallId: "once",
        toolName: "windows_computer_use_invoke",
        details: { ok: true, verification: "sent" },
      },
      {
        type: "guard_tool_result",
        toolName: "windows_computer_use_snapshot",
        details: {
          ok: true,
          tab: { id: "t123", url: "http://127.0.0.1:1234/form" },
          nodes: [
            {
              id: "t123:ack",
              role: "status",
              name: "Native confirmation complete: 7391",
            },
          ],
        },
      },
    ],
  };
  assert.equal((await verify("mixed", facts)).pass, true);
  const ack = "Native confirmation complete: 7391";
  const codeJson = '{"confirmationCode":"7391"}';
  const result = (details: object, tool = "snapshot", id = "status") => ({
    type: "guard_tool_result",
    toolCallId: id,
    toolName: "windows_computer_use_" + tool,
    details: {
      ok: true,
      tab: { id: "t123", url: facts.base + "form" },
      ...details,
    },
  });
  const call = (tool: string, id: string, input: object) => ({
    type: "guard_tool_call",
    toolCallId: id,
    toolName: "windows_computer_use_" + tool,
    input,
  });
  const passes = async (audit: unknown[]) =>
    (await verify("mixed", { ...facts, audit })).pass;
  const beforeAck = facts.audit.slice(0, 4);
  const editableEcho = (value: string) =>
    result({ nodes: [{ name: "Notes", role: "textbox", value }] });
  const falseProofs = [];
  for (const audit of [
    [editableEcho(codeJson), ...facts.audit.slice(1)],
    [...beforeAck, editableEcho(ack)],
    [
      ...beforeAck,
      result({
        action: "wait_for",
        verification: "inconclusive",
        found: false,
        conclusive: false,
        text: ack,
      }),
    ],
  ])
    falseProofs.push(await passes(audit));
  assert.deepEqual(falseProofs, [false, false, false]);
  const expectAcknowledgement = async (
    expected: boolean,
    ...events: unknown[]
  ) => {
    assert.equal(await passes([...beforeAck, ...events]), expected);
  };
  const waitCall = call("wait_for", "ack-wait", {
    browserTab: "t123",
    condition: "element",
    controlType: "status",
    query: ack,
  });
  const waitDetails = {
    action: "wait_for",
    condition: "element",
    query: ack,
    verification: "observed",
  };
  await expectAcknowledgement(
    true,
    waitCall,
    result(waitDetails, "wait_for", "ack-wait"),
  );
  for (const flags of [
    { found: false },
    { conclusive: false },
    { timedOut: true },
    { verification: "inconclusive", text: ack },
    { condition: "text", text: ack },
  ])
    await expectAcknowledgement(
      false,
      waitCall,
      result({ ...waitDetails, ...flags }, "wait_for", "ack-wait"),
    );
  const ackInfo = call("element_info", "ack-info", { elementId: "t123:ack" });
  await expectAcknowledgement(
    true,
    ackInfo,
    result(
      { element: { id: "t123:ack", tag: "p", text: ack } },
      "element_info",
      "ack-info",
    ),
  );
  const pendingCode = result({
    nodes: [
      { id: "t123:result", role: "status", name: "Form confirmation pending" },
    ],
  });
  const codeInfo = call("element_info", "code-info", {
    elementId: "t123:result",
  });
  assert.equal(
    await passes([
      pendingCode,
      codeInfo,
      result(
        { element: { id: "t123:result", tag: "pre", text: codeJson } },
        "element_info",
        "code-info",
      ),
      ...facts.audit.slice(1),
    ]),
    true,
  );
  const nestedEcho = result({
    nodes: [
      { role: "textbox", name: "Editable region", depth: 1 },
      { role: "status", name: ack, depth: 2 },
    ],
  });
  await expectAcknowledgement(false, nestedEcho);

  for (const audit of [
    facts.audit.slice(1),
    [
      facts.audit[1],
      facts.audit[2],
      facts.audit[3],
      facts.audit[0],
      facts.audit[4],
    ],
    facts.audit.slice(0, -1),
    [result({ query: codeJson, matches: [] }), ...facts.audit.slice(1)],
  ])
    assert.equal((await verify("mixed", { ...facts, audit })).pass, false);
  for (const native of [
    {
      ...facts.native,
      final: { ...facts.native.final, ignore: { code: "2846", count: 1 } },
    },
    { ...facts.native, receipt: { issuedCode: "2846", confirmations: 1 } },
    { ...facts.native, workerRetired: false },
  ])
    assert.equal((await verify("mixed", { ...facts, native })).pass, false);
});

test("mixed SDK routing preserves owned images and rejects cross-channel or uncertain dispatch", async () => {
  const folder = await mkdtemp(join(tmpdir(), "pi-mixed-sdk-"));
  try {
    await mkdir(join(folder, "tests"));
    await mkdir(join(folder, "dist"));
    for (const name of ["pi-browser-fixture.mjs", "pi-visual-fixture.mjs"])
      await copyFile(
        new URL(name, import.meta.url),
        join(folder, "tests", name),
      );
    await writeFile(join(folder, "package.json"), '{"type":"module"}');
    await writeFile(
      join(folder, "dist/extension.js"),
      'export default pi=>pi.registerTool({name:"windows_computer_use_snapshot",execute:async()=>({content:[],details:{ok:true}})});',
    );
    const result = await run(process.execPath, [
      "--input-type=module",
      "-e",
      `
      import assert from 'node:assert/strict';
      import {writeFileSync,readFileSync,mkdirSync,rmSync} from 'node:fs';
      import {join} from 'node:path';import {pathToFileURL} from 'node:url';
      import {ExtensionRunner,createExtensionRuntime} from '@earendil-works/pi-coding-agent';
      const root=process.argv[1],base='http://127.0.0.1:1234/';
      const {default:scope}=await import(pathToFileURL(join(root,'tests/pi-browser-fixture.mjs')));
      const box={x:0,y:0,width:600,height:400},client={x:10,y:30,width:580,height:350};
      const identity={pid:22,creation:'owned-generation',executable:'owned-fixture'};
      const owned={nativeWindowHandle:11,processId:22,title:'owned',windowsNode:process.execPath,pipeName:'offline',identity};
      const proof={ok:true,identity,target:{...owned,windowBounds:box,clientBounds:client}};
      const screenshot={windowCaptureFailed:false,occludedPossible:false,method:'printwindow',bounds:box,origin:{x:0,y:0},width:600,height:400,imageScale:1,imageScaleY:1};
      let imagePositive=false;
      for(const kind of ['running','mixed-tab','mixed-ref','implicit','retained','audit-io','unsafe','proof-failure']) {
        const dir=join(root,kind);mkdirSync(dir);
        const journal=join(dir,'owner.json'),nativeJournal=join(dir,'native.json'),auditFile=join(dir,'audit.jsonl');
        const running={phase:'running',expiresAt:Date.now()+60000};
        const proofPath=join(dir,'proof.json');writeFileSync(proofPath,JSON.stringify(proof));
        writeFileSync(journal,JSON.stringify(running));writeFileSync(nativeJournal,JSON.stringify(running));
        process.env.PI_CU_TEST_SPEC=JSON.stringify({scenario:'mixed',base,journal,auditFile,native:{owned,fixtureJournal:nativeJournal,clientCode:'console.log(require("node:fs").readFileSync('+JSON.stringify(proofPath)+',"utf8"))' }});
        const handlers=new Map();let registrations=0;
        await scope({on:(n,h)=>handlers.set(n,[...(handlers.get(n)??[]),h]),registerTool:()=>registrations++});
        assert.equal(registrations,1,'production registration occurs once');
        const runner=new ExtensionRunner([{path:'owned-mixed-fixture',handlers}],createExtensionRuntime(),process.cwd(),null,null);
        let sdkErrors=0;runner.onError(()=>sdkErrors++);
        const event=(name,input,id)=>({type:'tool_call',toolName:'windows_computer_use_'+name,toolCallId:id,input});
        const open=event('set_value',{elementId:'new-tab',value:base+'form'},'open');
        const openDecision=await runner.emitToolCall(open);assert.equal(openDecision?.block,undefined,JSON.stringify(openDecision));
        await runner.emitToolResult({...open,type:'tool_result',content:[],details:{ok:true,tab:{id:'t123',url:base+'form'},nodes:[{id:'t123:e1',name:'Name'}]}});
        if(kind==='running'){
          const browserImage=event('snapshot',{browserTab:'t123'},'browser-image');
          assert.equal((await runner.emitToolCall(browserImage))?.block,undefined);
          const original={...browserImage,type:'tool_result',isError:false,content:[{type:'image',mimeType:'image/png',data:'OWNED_BROWSER_IMAGE_BYTES'}],details:{ok:true,tab:{id:'t123',url:base+'form'},nodes:[],screenshot:{mimeType:'image/png',width:1,height:1}}};
          const patch=await runner.emitToolResult(original),outgoing={...original,...patch};
          assert.equal(outgoing.content[0].data,'OWNED_BROWSER_IMAGE_BYTES','SDK preserves owned browser image for provider');
          const audit=readFileSync(auditFile,'utf8');assert.equal(audit.includes('OWNED_BROWSER_IMAGE_BYTES'),false);assert.equal(/"(?:data|base64)"\\s*:/.test(audit),false);
        }

        const snap=event('snapshot',{nativeWindowHandle:11,processId:22,captureWindow:true},'native');
        const initialDecision=await runner.emitToolCall(snap);assert.equal(initialDecision?.block,undefined,JSON.stringify(initialDecision));
        const imageResult={...snap,type:'tool_result',isError:false,content:[{type:'image',data:'OWNED_IMAGE_BYTES'}],details:{ok:true,nativeWindowHandle:11,processId:22,windowRef:'actual-returned-ref',screenshot,tree:{children:[{id:'native-opaque',name:'',controlType:'Button',boundingBox:{x:40,y:50,width:200,height:80}}]}}};
        const forwarded=await runner.emitToolResult(imageResult);
        assert.equal(forwarded.content[0].data,'OWNED_IMAGE_BYTES');imagePositive=true;
        assert.equal(readFileSync(auditFile,'utf8').includes('OWNED_IMAGE_BYTES'),false);
        let args={elementId:'native-opaque',fallbackClick:false};let name='invoke';
        if(kind==='mixed-tab')args.browserTab='t123';
        if(kind==='mixed-ref')args={elementId:'t123:e1',windowRef:'actual-returned-ref',fallbackClick:false};
        if(kind==='implicit'){name='screenshot';args={};}
        if(kind==='retained')writeFileSync(nativeJournal,JSON.stringify({phase:'retained'}));
        if(kind==='audit-io'){rmSync(auditFile);mkdirSync(auditFile);}
        if(kind==='unsafe'){
          const unsafe=await runner.emitToolResult({...imageResult,details:{...imageResult.details,screenshot:{...screenshot,occludedPossible:true},text:'PRIVATE_DERIVED_TEXT'},content:[{type:'image',data:'PRIVATE_PIXELS'},{type:'text',text:'PRIVATE_DERIVED_TEXT'}]});
          assert.equal(unsafe.isError,true);
          assert.equal(JSON.stringify(unsafe).includes('PRIVATE_'),false);
          assert.equal(readFileSync(auditFile,'utf8').includes('PRIVATE_'),false);
        }
        if(kind==='proof-failure')writeFileSync(proofPath,JSON.stringify({...proof,identity:{...identity,creation:'different-generation'}}));
        const decision=await runner.emitToolCall(event(name,args,'attempt'));
        assert.equal(decision?.block,kind==='running'?undefined:true,kind);
        assert.equal(sdkErrors,0,kind);
      }
      assert.equal(imagePositive,true);console.log('Mixed actual SDK scope/privacy checks passed');
    `,
      folder,
    ]);
    assert.match(
      result.stdout,
      /Mixed actual SDK scope\/privacy checks passed/,
    );
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test("partial recovery requires each observed field effect and genuine confirmation", async () => {
  const base = "http://127.0.0.1:1234/",
    tab = { id: "t123", url: base + "form" };
  let serial = 0;
  const pair = (action: string, input: object, details: object) => {
    const toolCallId = String(++serial),
      toolName = "windows_computer_use_" + action;
    return [
      { type: "guard_tool_call", toolCallId, toolName, input },
      {
        type: "guard_tool_result",
        toolCallId,
        toolName,
        details: { ok: true, action, tab, ...details },
      },
    ];
  };
  const field = (id: string, name: string, role: string, extra = {}) => ({
    id,
    name,
    role,
    ...extra,
  });
  const controls = [
    field("name", "Name", "textbox"),
    field("notes", "Notes", "textbox"),
    field("accepted", "Accept terms", "checkbox"),
    field("choice", "Choice", "combobox"),
    field("beta", "Beta", "option"),
    field("submit", "Submit form", "button"),
  ];
  const restricted = [
    field("disabled", "Disabled field", "textbox", {
      value: "Disabled value",
      disabled: true,
    }),
    field("readonly", "Read-only field", "textbox", {
      value: "Read-only value",
      readonly: true,
    }),
  ];
  const facts = {
    ...formReport(),
    base,
    oracle: {
      ...formReport().oracle,
      events: { submissions: 1, starts: 0, ready: 0 },
    },
  };
  const initial = pair(
    "set_value",
    { elementId: "new-tab", value: tab.url },
    {
      source: "browser-accessibility",
      nodeCount: 500,
      truncated: true,
      truncationReason: "budget",
      nodes: Array.from({ length: 500 }, (_, i) => ({
        role: "paragraph",
        name: "Context row " + i,
      })),
    },
  );
  const read = (nodes = controls) =>
    pair("find", { browserTab: tab.id, query: "Name" }, { nodes });
  const effects = [
    pair(
      "set_value",
      { elementId: "name", value: facts.oracle.payload.name },
      {},
    ),
    pair(
      "set_value",
      { elementId: "notes", value: facts.oracle.payload.notes },
      {},
    ),
    pair("invoke", { elementId: "accepted" }, {}),
    pair("set_value", { elementId: "choice", value: "beta" }, {}),
  ];
  const submit = pair("click", { elementId: "submit" }, {});
  const confirmationName =
    "Form confirmation: " + JSON.stringify(facts.oracle.payload);
  const confirmation = pair(
    "find",
    { browserTab: tab.id, query: "Form confirmation" },
    { nodes: [...restricted, field("result", confirmationName, "status")] },
  );
  const complete = [
    ...initial,
    ...read(),
    ...effects.flat(),
    ...submit,
    ...confirmation,
  ];
  const accepted = async (audit: unknown, patch = {}) =>
    (await verify("partial", { ...facts, audit, ...patch })).pass;
  assert.equal(await accepted(complete), true);
  // Literal same-ID representations from the real cc70ece read-only gate.
  const actualSubmit = {
    id: "t96e620fc2bd3e621:226",
    name: "Submit form",
    role: "button",
  };
  const actualSubmitText = {
    id: "t96e620fc2bd3e621:226",
    name: "Submit form",
    role: "StaticText",
  };
  assert.equal(
    await accepted([
      ...initial,
      ...read([...controls.slice(0, 5), actualSubmit, actualSubmitText]),
      ...effects.flat(),
      ...pair("click", { elementId: actualSubmit.id }, {}),
      ...confirmation,
    ]),
    true,
    "literal real button survives its StaticText representation",
  );
  for (const contradiction of [
    { ...controls[0]!, name: "Notes" },
    { ...controls[0]!, role: "checkbox" },
  ])
    assert.equal(
      await accepted([
        ...initial,
        ...read([...controls, contradiction]),
        ...effects.flat(),
        ...submit,
        ...confirmation,
      ]),
      false,
      "contradictory actionable identity cannot be guessed",
    );

  assert.equal(
    await accepted([
      ...initial,
      ...read([controls[0]!, controls[5]!]),
      ...effects[0]!,
      ...submit,
      ...confirmation,
    ]),
    false,
    "reviewer Name-only causal false pass",
  );
  for (let missing = 0; missing < 4; missing++) {
    assert.equal(
      await accepted([
        ...initial,
        ...read(),
        ...effects.filter((_, i) => i !== missing).flat(),
        ...submit,
        ...confirmation,
      ]),
      false,
      "missing field effect " + missing,
    );
    assert.equal(
      await accepted([
        ...initial,
        ...read(controls.filter((_, i) => i !== missing)),
        ...effects.flat(),
        ...submit,
        ...confirmation,
      ]),
      false,
      "missing field observation " + missing,
    );
  }
  for (let wrongRole = 0; wrongRole < 4; wrongRole++)
    assert.equal(
      await accepted([
        ...initial,
        ...read(
          controls.map((node, i) =>
            i === wrongRole ? { ...node, role: "text" } : node,
          ),
        ),
        ...effects.flat(),
        ...submit,
        ...confirmation,
      ]),
      false,
      "wrong field role " + wrongRole,
    );
  const progressive = [...initial];
  for (let i = 0; i < 4; i++)
    progressive.push(...read([controls[i]!]), ...effects[i]!);
  progressive.push(...read([controls[5]!]), ...submit, ...confirmation);
  assert.equal(await accepted(progressive), true);
  const expanded = pair(
    "accessibility_tree",
    { browserTab: tab.id, maxNodes: 1200 },
    { nodes: controls },
  );
  assert.equal(
    await accepted([
      ...initial,
      ...expanded,
      ...effects.flat(),
      ...submit,
      ...confirmation,
    ]),
    true,
  );
  const alternatives = [
    ...effects[0]!,
    ...pair("focus", { elementId: "notes" }, {}),
    ...pair(
      "type_text",
      { browserTab: tab.id, text: facts.oracle.payload.notes },
      {},
    ),
    ...pair("set_value", { elementId: "accepted", value: "true" }, {}),
    ...pair("click", { elementId: "beta" }, {}),
  ];
  assert.equal(
    await accepted([
      ...initial,
      ...read(),
      ...alternatives,
      ...submit,
      ...confirmation,
    ]),
    true,
  );
  const keyboardChoice = [
    ...initial,
    ...read(),
    ...effects.slice(0, 3).flat(),
    ...pair("focus", { elementId: "choice" }, {}),
    ...pair("keypress", { browserTab: tab.id, keys: ["enter"] }, {}),
    ...submit,
    ...confirmation,
  ];
  const unsupported = await verify("partial", {
    ...facts,
    audit: keyboardChoice,
  });
  assert.equal(unsupported.pass, false);
  assert.ok(
    unsupported.verifierLimitations.includes(
      "keyboard field selection not covered by this verifier",
    ),
  );
  const waited = pair(
    "wait_for",
    {
      browserTab: tab.id,
      condition: "element",
      controlType: "status",
      query: confirmationName,
    },
    {
      condition: "element",
      query: confirmationName,
      verification: "observed",
    },
  );
  const waitAudit = [
    ...initial,
    ...read(),
    ...effects.flat(),
    ...submit,
    ...read(restricted),
    ...waited,
  ];
  assert.equal(await accepted(waitAudit), true);
  const replaceDetails = (rows: typeof initial, patch: object) =>
    rows.map((row) =>
      "details" in row
        ? { ...row, details: { ...row.details, ...patch } }
        : row,
    );
  for (const patch of [
    { conclusive: false },
    { found: false },
    { timedOut: true },
    { condition: "text" },
  ])
    assert.equal(
      await accepted([
        ...initial,
        ...read(),
        ...effects.flat(),
        ...submit,
        ...read(restricted),
        ...replaceDetails(waited, patch),
      ]),
      false,
    );
  for (const bad of [
    [...read(), ...effects.flat(), ...submit, ...confirmation],
    [
      ...replaceDetails(initial, { nodeCount: 499 }),
      ...read(),
      ...effects.flat(),
      ...submit,
      ...confirmation,
    ],
    [
      ...initial,
      ...pair(
        "find",
        {
          browserTab: tab.id,
          query: "Name Notes Accept terms Choice Submit form",
        },
        { nodes: [] },
      ),
      ...effects.flat(),
      ...submit,
      ...confirmation,
    ],
    [
      ...initial,
      ...replaceDetails(read(), { tab: { id: "t999", url: tab.url } }),
      ...effects.flat(),
      ...submit,
      ...confirmation,
    ],
    [...initial, ...effects.flat(), ...read(), ...submit, ...confirmation],
    [
      ...initial,
      ...read(),
      ...effects.flat(),
      ...submit,
      ...replaceDetails(confirmation, {
        nodes: restricted,
        query: confirmationName,
      }),
    ],
    [
      ...initial,
      ...read(),
      ...effects.flat(),
      ...submit,
      ...replaceDetails(confirmation, {
        nodes: [
          ...restricted,
          field("echo", confirmationName, "textbox", { value: "echo" }),
        ],
      }),
    ],
  ])
    assert.equal(await accepted(bad), false);
  for (const patch of [
    {
      oracle: {
        ...facts.oracle,
        events: { submissions: 2, starts: 0, ready: 0 },
      },
    },
    { effective: [{ ...effective[0], thinkingLevel: "high" }] },
    { cleanup: { ...facts.cleanup, processCount: 1 } },
  ])
    assert.equal(await accepted(complete, patch), false);
});

test("partial fixture readiness reports its optional mode before model startup", async () => {
  const { createInterface } = await import("node:readline");
  for (const partial of ["1", "0"]) {
    const child = spawn(
      process.execPath,
      ["tests/browser-actions-server.mjs", "edge", "false"],
      {
        env: {
          ...process.env,
          PI_CU_PARTIAL_FIXTURE: partial,
          PI_CU_MIXED_FIXTURE: "",
        },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    const closed = once(child, "close"),
      lines = createInterface({ input: child.stdout });
    child.stderr.resume();
    try {
      const [line] = await once(lines, "line");
      const source = JSON.parse(line);
      assert.equal(source.partialFixture, partial === "1" ? true : undefined);
      const html = await (await fetch(source.url + "form")).text();
      assert.equal(
        (html.match(/Context row /g) ?? []).length,
        partial === "1" ? 200 : 0,
      );
      assert.deepEqual(JSON.parse(await readFile(source.settings, "utf8")), {
        browserApp: "edge",
        browserVisible: false,
        browserSignIn: false,
      });
    } finally {
      lines.close();
      child.stdin.end();
      assert.equal((await closed)[0], 0);
    }
  }
});

test("held confirmation reports genuine HTTP entry and abort closure without completion", async () => {
  const { createInterface } = await import("node:readline");
  const child = spawn(
    process.execPath,
    ["tests/browser-actions-server.mjs", "edge", "false"],
    {
      env: {
        ...process.env,
        PI_CU_HELD_FIXTURE: "1",
        PI_CU_PARTIAL_FIXTURE: "0",
        PI_CU_MIXED_FIXTURE: "",
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  const closed = once(child, "close"),
    lines = createInterface({ input: child.stdout }),
    abort = new AbortController();
  child.stderr.resume();
  try {
    const [line] = await once(lines, "line"),
      source = JSON.parse(line);
    assert.equal(source.heldReady, true);
    assert.ok(source.heldUrl.startsWith(source.url + "held-"));
    const state = () => fetch(source.url + "held/state").then((r) => r.json());
    assert.equal((await state()).entries, 0);
    const pending = fetch(source.heldUrl, { signal: abort.signal }).catch(
      (error) => error,
    );
    for (let i = 0; (await state()).entries !== 1; i++) {
      assert.ok(i < 100);
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.deepEqual(
      { ...(await state()), urlHash: undefined },
      { entries: 1, completed: 0, closed: 0, urlHash: undefined },
    );
    abort.abort();
    await pending;
    for (let i = 0; (await state()).closed !== 1; i++) {
      assert.ok(i < 100);
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.equal((await state()).completed, 0);
  } finally {
    abort.abort();
    lines.close();
    child.stdin.end();
    assert.equal((await closed)[0], 0);
  }
});

test("cancel acceptance requires actual stopped/released proof and an interrupted truthful task", async () => {
  const pending = { id: 3, pid: 17, navigationHash: "a".repeat(64) };
  const facts = {
    ...formReport(),
    lifecycle: { settled: true, aborted: true, exitCode: 0 },
    cancel: {
      pending,
      assessment: {
        status: "observed",
        response: {
          id: 3,
          pid: 17,
          result: {
            ok: false,
            action: "set_value",
            error: "COMPUTER_USE_STOPPED",
          },
        },
        acknowledgment: { result: { released: true } },
      },
      workerRetired: true,
      http: {
        entries: 1,
        completed: 0,
        closed: 1,
        urlHash: pending.navigationHash,
      },
      noPostStopBusiness: true,
      noCompletionClaim: true,
      triggerCount: 1,
    },
  };
  assert.equal((await verify("cancel", facts)).pass, true);
  assert.equal(
    (
      await verify("cancel", {
        ...facts,
        cancel: {
          ...facts.cancel,
          assessment: {
            ...facts.cancel.assessment,
            response: {
              ...facts.cancel.assessment.response,
              result: {
                ok: false,
                action: "set_value",
                error: "COMPUTER_USE_CANCELLED",
              },
            },
          },
        },
      })
    ).pass,
    true,
  );
  for (const patch of [
    { assessment: { status: "pending" } },
    { workerRetired: false },
    { http: { entries: 0, completed: 0, closed: 0 } },
    { http: { entries: 2, completed: 0, closed: 2 } },
    { http: { entries: 1, completed: 1, closed: 1 } },
    { http: { entries: 1, completed: 0, closed: 0 } },
    { noPostStopBusiness: false },
    { noCompletionClaim: false },
    { triggerCount: 0 },
  ])
    assert.equal(
      (
        await verify("cancel", {
          ...facts,
          cancel: { ...facts.cancel, ...patch },
        })
      ).pass,
      false,
    );
  assert.equal(
    (
      await verify("cancel", {
        ...facts,
        lifecycle: { ...facts.lifecycle, aborted: false },
      })
    ).pass,
    false,
  );
  assert.equal(
    (
      await verify("cancel", {
        ...facts,
        cleanup: { ...facts.cleanup, processCount: 1 },
      })
    ).pass,
    false,
  );
});

test("form and held-state consumers share the bounded child-runtime fixture bridge", async () => {
  const { createInterface } = await import("node:readline");
  const { pathToFileURL } = await import("node:url");
  const folder = await mkdtemp(join(tmpdir(), "pi-fixture-state-bridge-"));
  await mkdir(join(folder, "tests"));
  await mkdir(join(folder, "dist"));
  await writeFile(join(folder, "package.json"), '{"type":"module"}');
  await copyFile(
    new URL("./pi-browser-fixture.mjs", import.meta.url),
    join(folder, "tests/pi-browser-fixture.mjs"),
  );
  await writeFile(
    join(folder, "dist/launcher.js"),
    `export async function nativeWorkerLaunch(){return {executable:${JSON.stringify(process.execPath)}}}`,
  );
  const child = spawn(
    process.execPath,
    ["tests/browser-actions-server.mjs", "edge", "false"],
    {
      env: {
        ...process.env,
        PI_CU_HELD_FIXTURE: "1",
        PI_CU_PARTIAL_FIXTURE: "0",
        PI_CU_MIXED_FIXTURE: "",
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  const closed = once(child, "close"),
    lines = createInterface({ input: child.stdout });
  child.stderr.resume();
  try {
    const [line] = await once(lines, "line"),
      source = JSON.parse(line);
    const { formState, heldState } = await import(
      pathToFileURL(join(folder, "tests/pi-browser-fixture.mjs")).href
    );
    assert.deepEqual(await formState(source.url), {
      payload: null,
      events: { starts: 0, ready: 0, submissions: 0 },
    });
    const held = await heldState(source.url);
    assert.equal(held.entries, 0);
    assert.equal(held.closed, 0);
    assert.equal(held.completed, 0);
    assert.match(held.urlHash, /^[a-f0-9]{64}$/);
    await assert.rejects(heldState(source.url + "missing/"));
  } finally {
    lines.close();
    child.stdin.end();
    assert.equal((await closed)[0], 0);
    await rm(folder, { recursive: true, force: true });
  }
});
