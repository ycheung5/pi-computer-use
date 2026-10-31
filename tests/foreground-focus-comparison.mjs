// Cross-process foreground restoration, owned fixtures; no physical input.
import assert from "node:assert/strict";

const args = process.argv.slice(2);
function retainCoordinator() {
  return setInterval(() => {}, 10000);
}
if (args.length === 1 && args[0] === "--retention-check") {
  retainCoordinator();
  console.log(JSON.stringify({ status: "retained" }));
}
if (args.length === 1 && args[0] === "--retention-check")
  await new Promise(() => {});
for (const arg of args)
  assert.ok(
    arg === "--plan" ||
      arg === "--provenance" ||
      arg === "--direct-uia" ||
      arg === "--dialog" ||
      arg === "--menu" ||
      arg === "--native-menu" ||
      arg === "--direct-mta" ||
      /^--(engine|reference|report|direct-report|menu-settlement-report)=.+/.test(
        arg,
      ),
    `Unknown option: ${arg}`,
  );
const option = (name) =>
  args.find((x) => x.startsWith(`--${name}=`))?.slice(name.length + 3);
function classifyDialog(e) {
  const { prior, target, before, pre, action, dialog, samples } = e;
  const valid = (x) =>
    x &&
    Number.isFinite(x.foregroundHandle) &&
    Number.isFinite(x.foregroundPid) &&
    Number.isFinite(x.foregroundRoot) &&
    Number.isFinite(x.lastInputTick);
  if (
    !prior ||
    !target ||
    !valid(before) ||
    !valid(pre) ||
    !Array.isArray(samples) ||
    !samples.length ||
    !samples.every(valid) ||
    !dialog
  )
    return {
      status: "inconclusive",
      reason: "Incomplete independent observation",
    };
  if (
    before.foregroundHandle !== prior.nativeWindowHandle ||
    before.foregroundPid !== prior.processId ||
    pre.foregroundHandle !== prior.nativeWindowHandle ||
    pre.foregroundPid !== prior.processId
  )
    return {
      status: "inconclusive",
      reason: "Prior foreground changed before dispatch",
    };
  if (
    pre.lastInputTick !== before.lastInputTick ||
    samples.some((x) => x.lastInputTick !== pre.lastInputTick)
  )
    return { status: "inconclusive", reason: "Input tick changed" };
  if (e.inputEventsBefore || e.inputEventsAfter) {
    const names = [
        "unmarkedMouse",
        "injectedMouse",
        "taggedMouse",
        "unmarkedKey",
        "injectedKey",
        "taggedKey",
      ],
      a = e.inputEventsBefore,
      b = e.inputEventsAfter;
    if (
      !a ||
      !b ||
      names.some(
        (k) =>
          !Number.isSafeInteger(a[k]) ||
          a[k] < 0 ||
          !Number.isSafeInteger(b[k]) ||
          b[k] < a[k],
      )
    )
      return { status: "inconclusive", reason: "Invalid input counters" };
    if (
      ["unmarkedMouse", "injectedMouse", "unmarkedKey", "injectedKey"].some(
        (k) => b[k] > a[k],
      )
    )
      return {
        status: "inconclusive",
        reason: "Unmarked or other injected event observed",
      };
  }
  if (action?.ok !== true || dialog.visible !== true)
    return {
      status: "fail",
      reason: "Owned dialog not observed after dispatch",
    };
  if (
    dialog.handle <= 0 ||
    dialog.owner !== target.nativeWindowHandle ||
    dialog.processId !== target.processId
  )
    return {
      status: "inconclusive",
      reason: "Dialog ownership not established",
    };
  if (
    !samples.every(
      (x) =>
        x.foregroundRoot === dialog.handle &&
        x.foregroundPid === target.processId,
    )
  )
    return {
      status: "inconclusive",
      reason: "Dialog foreground was not independently established",
    };
  return { status: "pass", reason: "Owned dialog remained foreground" };
}
function classifyMenu(e) {
  const { prior, target, before, pre, action, menu, samples } = e;
  const valid = (x) =>
    x &&
    Number.isFinite(x.foregroundHandle) &&
    Number.isFinite(x.foregroundPid) &&
    Number.isFinite(x.foregroundRoot) &&
    Number.isFinite(x.lastInputTick);
  if (
    !prior ||
    !Number.isSafeInteger(prior.nativeWindowHandle) ||
    prior.nativeWindowHandle <= 0 ||
    !Number.isSafeInteger(prior.processId) ||
    prior.processId <= 0 ||
    !target ||
    !Number.isSafeInteger(target.nativeWindowHandle) ||
    target.nativeWindowHandle <= 0 ||
    !Number.isSafeInteger(target.processId) ||
    target.processId <= 0 ||
    !valid(before) ||
    !valid(pre) ||
    !Array.isArray(samples) ||
    !samples.length ||
    !samples.every(valid) ||
    !menu
  )
    return {
      status: "inconclusive",
      reason: "Incomplete independent observation",
    };
  if (
    before.foregroundHandle !== prior.nativeWindowHandle ||
    before.foregroundPid !== prior.processId ||
    pre.foregroundHandle !== prior.nativeWindowHandle ||
    pre.foregroundPid !== prior.processId
  )
    return {
      status: "inconclusive",
      reason: "Prior foreground changed before dispatch",
    };
  if (
    pre.lastInputTick !== before.lastInputTick ||
    samples.some((x) => x.lastInputTick !== pre.lastInputTick)
  )
    return { status: "inconclusive", reason: "Input tick changed" };
  if (e.inputEventsBefore || e.inputEventsAfter) {
    const names = [
        "unmarkedMouse",
        "injectedMouse",
        "taggedMouse",
        "unmarkedKey",
        "injectedKey",
        "taggedKey",
      ],
      a = e.inputEventsBefore,
      b = e.inputEventsAfter;
    if (
      !a ||
      !b ||
      names.some(
        (k) =>
          !Number.isSafeInteger(a[k]) ||
          a[k] < 0 ||
          !Number.isSafeInteger(b[k]) ||
          b[k] < a[k],
      )
    )
      return { status: "inconclusive", reason: "Invalid input counters" };
    if (
      ["unmarkedMouse", "injectedMouse", "unmarkedKey", "injectedKey"].some(
        (k) => b[k] > a[k],
      )
    )
      return {
        status: "inconclusive",
        reason: "Unmarked or other injected event observed",
      };
  }
  if (
    e.nativeMenu &&
    (e.menuUia?.ok !== true ||
      !Array.isArray(e.menuUia.matches) ||
      e.menuUia.matches.length !== 1 ||
      e.menuUia.matches[0].processId !== target.processId ||
      e.menuUia.matches[0].name !== "Owned menu item" ||
      e.menuUia.matches[0].controlType !== "MenuItem")
  )
    return {
      status: "inconclusive",
      reason: "Native menu item UIA identity unavailable",
    };
  if (action?.ok !== true || menu.visible !== true)
    return { status: "fail", reason: "Owned menu not observed after dispatch" };
  if (
    !Number.isSafeInteger(menu.handle) ||
    menu.handle <= 0 ||
    menu.source !== target.nativeWindowHandle ||
    menu.processId !== target.processId ||
    menu.itemCount !== 1 ||
    menu.menuMode !== true
  )
    return {
      status: "inconclusive",
      reason: "Menu ownership or OS menu mode not established",
    };
  if (samples.some((x) => !x.menu || typeof x.menu.visible !== "boolean"))
    return { status: "inconclusive", reason: "A menu sample is unavailable" };
  if (samples.some((x) => x.menu.visible === false))
    return {
      status: "fail",
      reason: "Owned menu closed during post-action sampling",
    };
  if (
    samples.some(
      (x) =>
        x.menu.handle !== menu.handle ||
        x.menu.source !== target.nativeWindowHandle ||
        x.menu.processId !== target.processId ||
        x.menu.itemCount !== 1 ||
        x.menu.menuMode !== true,
    )
  )
    return {
      status: "inconclusive",
      reason: "Menu identity or OS menu mode changed during sampling",
    };
  if (
    !samples.every(
      (x) =>
        x.foregroundPid === target.processId &&
        [target.nativeWindowHandle, menu.handle].includes(x.foregroundRoot),
    )
  )
    return {
      status: "inconclusive",
      reason: "Target/menu foreground was not independently established",
    };
  return {
    status: "pass",
    reason: "Owned menu remained open while target process was foreground",
  };
}
function classifyEvidence(evidence) {
  if (evidence?.comparison === "owned-dialog") return classifyDialog(evidence);
  if (evidence?.comparison === "owned-menu") return classifyMenu(evidence);
  const { prior, before, pre, focus, samples } = evidence;
  const valid = (x) =>
    x &&
    Number.isFinite(x.foregroundHandle) &&
    Number.isFinite(x.foregroundPid) &&
    Number.isFinite(x.lastInputTick);
  if (
    !prior ||
    !Number.isFinite(prior.nativeWindowHandle) ||
    !Number.isFinite(prior.processId) ||
    !valid(before) ||
    !valid(pre) ||
    !Array.isArray(samples) ||
    samples.length === 0 ||
    !samples.every(valid)
  )
    return {
      status: "inconclusive",
      reason: "Incomplete identity or observation",
    };
  if (
    before.foregroundHandle !== prior.nativeWindowHandle ||
    before.foregroundPid !== prior.processId ||
    pre.foregroundHandle !== prior.nativeWindowHandle ||
    pre.foregroundPid !== prior.processId
  )
    return {
      status: "inconclusive",
      reason: "Prior foreground identity changed before dispatch",
    };
  if (
    pre.lastInputTick !== before.lastInputTick ||
    samples.some((x) => x.lastInputTick !== pre.lastInputTick)
  )
    return { status: "inconclusive", reason: "Intervening input observed" };
  if (evidence.inputEventsBefore || evidence.inputEventsAfter) {
    const names = [
      "unmarkedMouse",
      "injectedMouse",
      "taggedMouse",
      "unmarkedKey",
      "injectedKey",
      "taggedKey",
    ];
    const a = evidence.inputEventsBefore,
      b = evidence.inputEventsAfter;
    if (
      !a ||
      !b ||
      names.some(
        (name) =>
          !Number.isSafeInteger(a[name]) ||
          a[name] < 0 ||
          !Number.isSafeInteger(b[name]) ||
          b[name] < a[name],
      )
    )
      return { status: "inconclusive", reason: "Invalid input event counters" };
    if (
      ["unmarkedMouse", "injectedMouse", "unmarkedKey", "injectedKey"].some(
        (name) => b[name] > a[name],
      )
    )
      return {
        status: "inconclusive",
        reason: "Unmarked or foreign-injected input events observed",
      };
  }
  if (focus?.ok !== true || !samples.some((x) => x.activeEditor === true))
    return { status: "fail", reason: "Target focus not observed" };
  const preserved = samples.every(
    (x) =>
      x.foregroundHandle === prior.nativeWindowHandle &&
      x.foregroundPid === prior.processId,
  );
  return {
    status:
      evidence.focusDispatch === "direct-uia-control"
        ? "observed"
        : preserved
          ? "pass"
          : "fail",
    foregroundPreserved: preserved,
  };
}
function classifyDirect(evidence) {
  return evidence?.dispatched === true &&
    evidence.marker === "sent" &&
    evidence.closed === true &&
    evidence.exitCode === 0 &&
    evidence.signal === null
    ? {
        outcome: "returned",
        detail: "Direct SetFocus returned and caller exited successfully",
      }
    : {
        outcome: "unknown",
        detail: "Direct SetFocus completion is not proven",
      };
}
const directReportPath = option("direct-report");
if (directReportPath) {
  assert.equal(
    args.length,
    1,
    "direct-report cannot be combined with other options",
  );
  const { readFile } = await import("node:fs/promises");
  const outcome = classifyDirect(
    JSON.parse(await readFile(directReportPath, "utf8")),
  );
  console.log(JSON.stringify({ executed: false, ...outcome }));
  process.exit(outcome.outcome === "returned" ? 0 : 1);
}
function nativeMenuSettlementConfirmed(reply) {
  return reply === "native-menu-settlement:True:True:True";
}
const settlementReportPath = option("menu-settlement-report");
if (settlementReportPath) {
  assert.equal(
    args.length,
    1,
    "menu settlement report cannot be combined with other options",
  );
  const { readFile } = await import("node:fs/promises");
  const evidence = JSON.parse(await readFile(settlementReportPath, "utf8"));
  const confirmed = nativeMenuSettlementConfirmed(evidence.reply);
  console.log(JSON.stringify({ executed: false, confirmed }));
  process.exit(confirmed ? 0 : 1);
}
const reportPath = option("report");
if (reportPath) {
  assert.equal(args.length, 1, "report cannot be combined with other options");
  const { readFile } = await import("node:fs/promises");
  const outcome = classifyEvidence(
    JSON.parse(await readFile(reportPath, "utf8")),
  );
  console.log(JSON.stringify({ executed: false, ...outcome }));
  process.exit(["pass", "observed"].includes(outcome.status) ? 0 : 1);
}
const engine = option("engine") ?? "pi";
assert.ok(["pi", "reference"].includes(engine));
const directUia = args.includes("--direct-uia");
const directMta = args.includes("--direct-mta");
const dialogMode = args.includes("--dialog");
const nativeMenu = args.includes("--native-menu");
const menuMode = args.includes("--menu") || nativeMenu;
assert.ok(!(nativeMenu && args.includes("--menu")), "Choose one menu fixture");
assert.ok(!(menuMode && dialogMode), "Choose either dialog or menu");
assert.ok(
  !menuMode || (args.includes("--provenance") && !directUia),
  "Menu comparison requires --provenance and excludes --direct-uia",
);
const popupMode = dialogMode || menuMode;
assert.ok(
  !dialogMode || (args.includes("--provenance") && !directUia),
  "Dialog comparison requires --provenance and excludes --direct-uia",
);
assert.ok(!directMta || directUia, "--direct-mta requires --direct-uia");
assert.ok(
  !directUia || (engine === "pi" && args.includes("--provenance")),
  "Direct UIA control requires Pi setup and --provenance",
);
if (args.includes("--plan")) {
  console.log(
    JSON.stringify({
      executed: false,
      engine,
      physicalInput: false,
      foregroundChangesPossible: true,
      ...(directUia
        ? {
            focusDispatch: "direct-uia-control",
            directApartmentRequested: directMta ? "MTA" : "default",
          }
        : {}),
      ...(args.includes("--provenance")
        ? { inputProvenance: "aggregate hook counts only" }
        : {}),
      ...(popupMode ? { fixtureExpiry: "explicit-stop-only" } : {}),
      cases: [
        dialogMode
          ? "owned-dialog-foreground"
          : menuMode
            ? nativeMenu
              ? "native-menu-foreground"
              : "owned-menu-foreground"
            : "cross-process-prior-foreground",
      ],
    }),
  );
  process.exit(0);
}
assert.equal(
  process.env.PI_CU_WINDOW_MANAGEMENT_TEST,
  "1",
  "PI_CU_WINDOW_MANAGEMENT_TEST=1 requires an authorized idle desktop",
);
assert.equal(process.platform, "win32", "Windows Node required");
const referencePath = option("reference");
if (engine === "reference") assert.ok(referencePath, "reference path required");
const [
  { spawn, spawnSync },
  { once },
  { mkdtemp, rm },
  { tmpdir },
  { join },
  { createInterface },
  { setTimeout: delay },
  { fileURLToPath },
  { createComparisonClient },
] = await Promise.all([
  import("node:child_process"),
  import("node:events"),
  import("node:fs/promises"),
  import("node:os"),
  import("node:path"),
  import("node:readline"),
  import("node:timers/promises"),
  import("node:url"),
  import("./comparison-client.mjs"),
]);
const folder = await mkdtemp(join(tmpdir(), "pi-cu-cross-focus-"));
process.env.PI_CU_SETTINGS_FILE = join(folder, "settings.json");
const fixtures = [];
let client,
  observer,
  directDispatched = false,
  directSettled = false,
  popupDispatched = false,
  popupSettled = false,
  result = {
    engine,
    physicalInput: false,
    foregroundChangesPossible: true,
    status: "running",
    phase: "setup",
  },
  cleanupConfirmed = false;
async function fixture(label) {
  const child = spawn(
    join(folder, "controls.exe"),
    [
      label,
      ...(popupMode ? ["--no-expiry"] : []),
      ...(nativeMenu ? ["--native-menu"] : []),
    ],
    {
      cwd: folder,
      windowsHide: false,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  fixtures.push(child);
  child.stderr.resume();
  const iter = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  async function next() {
    let timer;
    try {
      return await Promise.race([
        iter.next().then((x) => {
          if (x.done) throw new Error("Fixture exited");
          return x.value.trim();
        }),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Fixture response timeout")),
            10000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  async function command(s) {
    child.stdin.write(`${s}\n`);
    return next();
  }
  const hwnd = Number(await next());
  assert.ok(hwnd > 0 && child.pid > 0);
  return {
    child,
    identity: { nativeWindowHandle: hwnd, processId: child.pid },
    command,
    async observe() {
      const x = (await command("observe")).split(":");
      assert.equal(x[0], "state");
      return {
        activeEditor: x[7] === "True",
        foregroundHandle: Number(x[8]),
        lastInputTick: Number(x[9]),
        fixtureHandle: Number(x[10]),
        foregroundPid: Number(x[11]),
        foregroundRoot: Number(x[12]),
      };
    },
  };
}
try {
  const compiler = join(
    process.env.WINDIR,
    "Microsoft.NET",
    "Framework64",
    "v4.0.30319",
    "csc.exe",
  );
  const build = spawnSync(
    compiler,
    [
      "/nologo",
      "/target:exe",
      `/out:${join(folder, "controls.exe")}`,
      "/r:System.Windows.Forms.dll",
      "/r:System.Drawing.dll",
      fileURLToPath(new URL("./controls-fixture.cs", import.meta.url)),
    ],
    { encoding: "utf8", windowsHide: true, cwd: folder },
  );
  assert.equal(build.status, 0, build.stdout + build.stderr);
  if (args.includes("--provenance")) {
    const observerExe = join(folder, "input-observer.exe");
    const compiled = spawnSync(
      compiler,
      [
        "/nologo",
        "/target:exe",
        `/out:${observerExe}`,
        fileURLToPath(
          new URL("./input-provenance-fixture.cs", import.meta.url),
        ),
      ],
      { encoding: "utf8", windowsHide: true, cwd: folder },
    );
    assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
    observer = spawn(observerExe, [], {
      cwd: folder,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    fixtures.push(observer);
    observer.stderr.resume();
    const lines = createInterface({ input: observer.stdout })[
      Symbol.asyncIterator
    ]();
    async function readObserver() {
      let timer;
      try {
        return await Promise.race([
          lines.next().then((x) => {
            if (x.done) throw new Error("Input observer exited");
            return x.value.trim();
          }),
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("Input observer timeout")),
              5000,
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    }
    assert.equal(
      await readObserver(),
      "ready",
      "Both low-level observer hooks must be available",
    );
    observer.snapshot = async () => {
      observer.stdin.write("snapshot\n");
      const value = (await readObserver()).split(":");
      assert.equal(value[0], "counts");
      assert.equal(value.length, 7);
      const numbers = value.slice(1).map(Number);
      assert.ok(numbers.every(Number.isSafeInteger));
      return {
        unmarkedMouse: numbers[0],
        injectedMouse: numbers[1],
        taggedMouse: numbers[2],
        unmarkedKey: numbers[3],
        injectedKey: numbers[4],
        taggedKey: numbers[5],
      };
    };
  }

  if (popupMode) result.comparison = menuMode ? "owned-menu" : "owned-dialog";
  if (nativeMenu) result.nativeMenu = true;
  const prior = await fixture("Pi CU prior foreground");
  const target = await fixture("Pi CU focus target");
  async function readMenuState() {
    const x = (await target.command("menu-state")).split(":");
    assert.equal(x[0], "menu-state");
    assert.equal(x.length, 7);
    return {
      handle: Number(x[1]),
      source: Number(x[2]),
      processId: Number(x[3]),
      visible: x[4] === "True",
      itemCount: Number(x[5]),
      menuMode: x[6] === "True" ? true : x[6] === "False" ? false : null,
    };
  }
  result.prior = prior.identity;
  result.target = target.identity;
  assert.notEqual(prior.identity.processId, target.identity.processId);
  client = await createComparisonClient({ engine, referencePath, cwd: folder });
  result.phase = "activation";
  const activation = await client.execute("activate_window", prior.identity);
  result.activation = activation;
  if (observer) result.inputEventsAfterActivation = await observer.snapshot();
  if (!activation.ok || !activation.activated) {
    const e = new Error("Prior fixture activation not confirmed");
    e.details = activation;
    throw e;
  }
  const before = await target.observe();
  result.before = before;
  assert.equal(before.foregroundHandle, prior.identity.nativeWindowHandle);
  assert.equal(before.foregroundPid, prior.identity.processId);
  assert.equal(await target.command("prepare-focus"), "focus-ready");
  if (observer) result.inputEventsAfterPreparation = await observer.snapshot();
  if (dialogMode) {
    const state = (await target.command("dialog-state")).split(":");
    assert.equal(state[0], "dialog-state");
    assert.equal(Number(state[1]), 0, "Dialog must not exist before action");
    result.dialogBefore = {
      handle: Number(state[1]),
      visible: state[4] === "True",
    };
  }
  if (menuMode) {
    const state = (await target.command("menu-state")).split(":");
    assert.equal(state[0], "menu-state");
    assert.equal(Number(state[1]), 0, "Menu must not exist before action");
    result.menuBefore = {
      handle: Number(state[1]),
      visible: state[4] === "True",
    };
  }
  result.phase = "find";
  const found = await client.execute("find", {
    ...target.identity,
    query: dialogMode
      ? "Open owned test dialog"
      : menuMode
        ? "Open owned test menu"
        : "Background editor",
    controlType: popupMode ? "Button" : "Edit",
    ocrFallback: false,
    activate: false,
  });
  result.found = found;
  if (observer) result.inputEventsAfterFind = await observer.snapshot();
  assert.equal(found.ok, true, JSON.stringify(found));
  assert.equal(found.matches?.length, 1, "Exact single owned editor required");
  const pre = await target.observe();
  result.pre = pre;
  if (pre.lastInputTick !== before.lastInputTick) {
    const e = new Error("Intervening input before action");
    e.inconclusive = true;
    throw e;
  }
  if (
    pre.foregroundHandle !== prior.identity.nativeWindowHandle ||
    pre.foregroundPid !== prior.identity.processId
  ) {
    const e = new Error("Prior foreground identity changed before dispatch");
    e.inconclusive = true;
    throw e;
  }
  let direct;
  if (directUia) {
    const hwnd = found.matches[0].nativeWindowHandle,
      pid = target.identity.processId;
    assert.ok(
      Number.isSafeInteger(hwnd) &&
        hwnd > 0 &&
        Number.isSafeInteger(pid) &&
        pid > 0,
      "Owned native edit HWND and PID required",
    );
    const ps = `$ErrorActionPreference='Stop'; Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes; $e=[System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]${hwnd}); if($null -eq $e -or $e.Current.ProcessId -ne ${pid} -or $e.Current.NativeWindowHandle -ne ${hwnd}){throw 'UIA identity mismatch'}; [Console]::WriteLine('ready:' + [Threading.Thread]::CurrentThread.GetApartmentState().ToString()); [Console]::Out.Flush(); if([Console]::ReadLine() -ne 'focus'){throw 'Focus gate rejected'}; $e.SetFocus(); [Console]::WriteLine('sent'); [Console]::Out.Flush()`;
    const child = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        ...(directMta ? ["-Mta"] : []),
        "-EncodedCommand",
        Buffer.from(ps, "utf16le").toString("base64"),
      ],
      { cwd: folder, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
    );
    fixtures.push(child);
    const directEvidence = {
      pid: child.pid,
      phase: "initializing",
      dispatched: false,
      marker: null,
      closed: false,
      exitCode: null,
      signal: null,
      stderr: "",
      stderrTruncated: false,
    };
    result.directEvidence = directEvidence;
    child.stdin.on("error", (error) => {
      directEvidence.stdinError = String(error);
    });
    child.stderr.on("data", (chunk) => {
      const text = String(chunk);
      const available = 4096 - directEvidence.stderr.length;
      if (available > 0) directEvidence.stderr += text.slice(0, available);
      if (text.length > available) directEvidence.stderrTruncated = true;
    });
    const closed = once(child, "close").then(([code, signal]) => {
      directEvidence.closed = true;
      directEvidence.exitCode = code;
      directEvidence.signal = signal;
      return [code, signal];
    });
    const lines = createInterface({ input: child.stdout })[
      Symbol.asyncIterator
    ]();
    const read = async () => {
      const x = await lines.next();
      if (x.done) throw new Error("Direct UIA control exited without response");
      return x.value.trim();
    };
    const ready = (await read()).match(/^ready:(STA|MTA)$/);
    assert.ok(
      ready,
      "Direct UIA FromHandle, identity and apartment must be reported before sampling",
    );
    directEvidence.apartment = ready[1];
    directEvidence.apartmentRequested = directMta ? "MTA" : "default";
    assert.ok(
      !directMta || ready[1] === "MTA",
      "Requested MTA was not observed; no focus sent",
    );
    directEvidence.phase = "ready";
    direct = { child, closed, read, evidence: directEvidence };
    result.focusDispatch = "direct-uia-control";
    result.inputEventsAfterDirectPreparation = await observer.snapshot();
    result.directPre = await target.observe();
    if (
      result.directPre.lastInputTick !== pre.lastInputTick ||
      result.directPre.foregroundHandle !== prior.identity.nativeWindowHandle ||
      result.directPre.foregroundPid !== prior.identity.processId
    ) {
      const e = new Error(
        "Foreground or input changed during direct UIA preparation",
      );
      e.inconclusive = true;
      throw e;
    }
  }
  if (observer) result.inputEventsBefore = await observer.snapshot();
  result.phase = "focus";
  const dispatchedAt = performance.now();
  let focus;
  if (direct) {
    directDispatched = true;
    direct.evidence.dispatched = true;
    direct.evidence.phase = "gate-sent";
    direct.child.stdin.end("focus\n");
    try {
      direct.evidence.marker = await direct.read();
      direct.evidence.phase = "marker-received";
    } catch (error) {
      direct.evidence.readError = String(error);
      direct.evidence.phase = "response-missing";
    }
    // A process exit alone is not evidence of SetFocus completion. Await close
    // for bounded diagnostics, then retain the owners unless a return marker
    // and a successful exit independently establish the caller boundary.
    let timer;
    try {
      await Promise.race([
        direct.closed,
        new Promise((resolve) => {
          timer = setTimeout(resolve, 2000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
    const assessment = classifyDirect(direct.evidence);
    direct.evidence.outcome = assessment.outcome;
    if (assessment.outcome !== "returned") {
      const e = new Error("Direct UIA completion unconfirmed");
      e.inconclusive = true;
      throw e;
    }
    directSettled = true;
    direct.evidence.phase = "returned";
    focus = {
      ok: true,
      action: "focus",
      method: "direct-uia-control",
      verification: "sent",
    };
  } else if (popupMode) {
    popupDispatched = true;
    focus = await client.execute("invoke", {
      ...target.identity,
      elementId: found.matches[0].id,
      activate: false,
      fallbackClick: false,
    });
    result.action = focus;
  } else
    focus = await client.execute("focus", {
      ...target.identity,
      elementId: found.matches[0].id,
      activate: false,
    });
  result.focus = focus;
  if (dialogMode) {
    const x = (await target.command("dialog-state")).split(":");
    assert.equal(x[0], "dialog-state");
    assert.equal(x.length, 5);
    result.dialog = {
      handle: Number(x[1]),
      owner: Number(x[2]),
      processId: Number(x[3]),
      visible: x[4] === "True",
    };
  }
  if (menuMode) result.menu = await readMenuState();
  if (nativeMenu)
    result.menuUia = await client.execute("find", {
      ...target.identity,
      query: "Owned menu item",
      controlType: "MenuItem",
      ocrFallback: false,
      activate: false,
    });
  if (observer) result.inputEventsAfter = await observer.snapshot();
  const samples = [];
  result.samples = samples;
  for (const wait of [0, 50, 200, 500]) {
    if (wait) await delay(wait);
    const observation = await target.observe();
    const menu = menuMode ? await readMenuState() : undefined;
    samples.push({
      afterDispatchMs: Math.round(performance.now() - dispatchedAt),
      ...observation,
      ...(menuMode ? { menu } : {}),
    });
  }
  if (popupMode && observer)
    result.inputEventsAfter = await observer.snapshot();
  result.diagnostic = menuMode
    ? "public non-fallback invoke and independent owned-menu/OS menu-mode observations; no internal guard-phase observation"
    : dialogMode
      ? "public non-fallback invoke and independent owned-dialog/foreground observations; no internal guard-phase observation"
      : directUia
        ? "direct managed UIA control, not a Pi focus call; aggregate input counts cannot prove event source"
        : "public focus dispatch and independent after-return observations; no internal guard-phase observation";
  Object.assign(result, classifyEvidence(result));
  if (popupMode && result.status === "pass") {
    if (nativeMenu) {
      result.nativeMenuSettlement = await target.command("dismiss-native-menu");
      if (!nativeMenuSettlementConfirmed(result.nativeMenuSettlement)) {
        result.status = "inconclusive";
        result.reason = "Native menu handler settlement was not confirmed";
      }
    }
    if (result.status === "pass") popupSettled = true;
  }
  if (!["pass", "observed"].includes(result.status)) process.exitCode = 1;
} catch (error) {
  result.status = error.inconclusive ? "inconclusive" : "fail";
  result.error = String(error);
  if (error.details) {
    result.status = "blocked";
    result.details = error.details;
  }
  process.exitCode = 1;
} finally {
  if (
    (directDispatched && !directSettled) ||
    (popupDispatched && !popupSettled)
  ) {
    if (result.status !== "fail") result.status = "inconclusive";
    result.cleanupError =
      directDispatched && !directSettled
        ? "Direct UIA settlement unconfirmed; owned processes retained"
        : "Menu/dialog dispatch or clean observation unconfirmed; owned processes retained";
    result.retainedFolder = folder;
    if (popupDispatched && !popupSettled) retainCoordinator();
    process.exitCode = 1;
  } else
    try {
      if (client) await client.dispose();
      for (const child of fixtures) {
        if (child.exitCode !== null || child.signalCode !== null) continue;
        const closed = once(child, "close");
        child.stdin.end("stop\n");
        let timer;
        try {
          await Promise.race([
            closed,
            new Promise((_, reject) => {
              timer = setTimeout(
                () => reject(new Error("Fixture cleanup unconfirmed")),
                5000,
              );
            }),
          ]);
        } finally {
          clearTimeout(timer);
        }
      }
      await rm(folder, { recursive: true, force: true });
      cleanupConfirmed = true;
    } catch (error) {
      result.status = "fail";
      result.cleanupError = String(error);
      result.retainedFolder = folder;
      if (popupMode) retainCoordinator();
      process.exitCode = 1;
    }
}
console.log(JSON.stringify({ ...result, cleanupConfirmed }));
