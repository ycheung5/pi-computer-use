// Opt-in real input, scoped to newly created, uniquely named Notepad files.
// Never uses the clipboard, existing tabs' contents, or background-input fallback.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createComparisonClient } from "./comparison-client.mjs";

const flatten = (node) =>
  node ? [node, ...(node.children ?? []).flatMap(flatten)] : [];
const observe = (target) =>
  client.execute("snapshot", {
    ...target,
    includeScreenshot: false,
    activate: false,
    detailLevel: "full",
    maxDepth: 8,
  });
const normalize = (text) => text.replace(/\r\n?|\n/g, "\n");
const cases = [
  { seed: "x", text: "\n" },
  { seed: "", text: " \t " },
  {
    seed: "Reuse test\n中文測試 café 😀",
    text: "\nSendInput check: 中文測試 café 😀",
  },
  { seed: "", text: "Pi input check 中文 😀" },
  { seed: "", text: "Abc 123 中文測試 café 😀 ".repeat(5) },
  { seed: "", text: "LF\nCR\rCRLF\r\nTab\tend 😀" },
];
const option = (name) =>
  process.argv
    .slice(2)
    .find((arg) => arg.startsWith(`--${name}=`))
    ?.slice(name.length + 3);
// The report path is a test-runner interface for inspecting retained results;
// it does not start a backend, create resources or dispatch input.
function cleanupReport({ caseFailure = null, cleanupFailures, retainedTabs }) {
  assert.ok(Array.isArray(cleanupFailures), "cleanupFailures must be an array");
  assert.ok(
    Number.isInteger(retainedTabs) && retainedTabs >= 0,
    "retainedTabs must be non-negative",
  );
  return {
    caseFailure,
    cleanupFailures,
    retainedTabs,
    cleanupConfirmed: cleanupFailures.length === 0 && retainedTabs === 0,
  };
}
const reportPath = option("report-cleanup");
function legacyContextReport(observation) {
  assert.equal(typeof observation.succeeded, "boolean");
  assert.ok(Array.isArray(observation.contexts));
  return {
    observation,
    classification:
      observation.succeeded &&
      observation.contexts.length === 1 &&
      observation.contexts[0].open === true
        ? "observed"
        : "unknown",
    focusedContextIdentified: false,
    legacyOpenState: "unknown",
    tsfState: "unknown",
  };
}
const imeReportPath = option("report-ime");
if (imeReportPath !== undefined) {
  assert.equal(
    process.argv.length,
    3,
    "report-ime cannot be combined with other options",
  );
  assert.ok(imeReportPath, "report-ime requires a path");
  console.log(
    JSON.stringify(
      legacyContextReport(JSON.parse(await readFile(imeReportPath, "utf8"))),
    ),
  );
  process.exit();
}
if (reportPath !== undefined) {
  assert.equal(
    process.argv.length,
    3,
    "report-cleanup cannot be combined with other options",
  );
  assert.ok(reportPath, "report-cleanup requires a path");
  const report = cleanupReport(JSON.parse(await readFile(reportPath, "utf8")));
  console.log(JSON.stringify(report));
  if (report.caseFailure || !report.cleanupConfirmed) process.exitCode = 1;
  process.exit();
}
for (const arg of process.argv.slice(2))
  assert.ok(
    arg === "--list" || /^--(engine|reference|case|diagnostic)=/.test(arg),
    `Unknown option: ${arg}`,
  );
const engine = option("engine") ?? "pi";
assert.ok(
  ["pi", "reference"].includes(engine),
  "engine must be pi or reference",
);
const diagnosticName = option("diagnostic") ?? "baseline";
const diagnostics = {
  baseline: { name: "baseline", variable: null },
  "pi-no-delay": {
    name: "pi-no-delay",
    variable: "inter-character-delay",
    engine: "pi",
    before: 50,
    after: 0,
  },
  "reference-keyup-scan": {
    name: "reference-keyup-scan",
    variable: "unicode-keyup-scan",
    engine: "reference",
    before: 0,
    after: "same-as-keydown",
  },
  "reference-pair-batches": {
    name: "reference-pair-batches",
    variable: "events-per-batch",
    engine: "reference",
    before: 64,
    after: 2,
  },
};
const diagnostic = Object.hasOwn(diagnostics, diagnosticName)
  ? diagnostics[diagnosticName]
  : undefined;
assert.ok(
  diagnostic && (!diagnostic.engine || diagnostic.engine === engine),
  "diagnostic must be known and match the selected engine",
);
const selectedCase = option("case");
assert.ok(
  selectedCase === undefined || /^[1-6]$/.test(selectedCase),
  "case must be an integer from 1 to 6",
);
const selectedCases = cases
  .map((value, index) => ({ ...value, id: index + 1 }))
  .filter(
    (value) => selectedCase === undefined || value.id === Number(selectedCase),
  );
if (process.argv.includes("--list")) {
  console.log(
    JSON.stringify({
      engine,
      executed: false,
      requestedMethod: "sendinput",
      diagnostic,
      cases: selectedCases.map(({ seed, text, id }) => ({
        id,
        seed,
        text,
        expected: normalize(seed + text),
      })),
    }),
  );
  process.exit(0);
}
assert.equal(
  process.env.PI_CU_NOTEPAD_INPUT_TEST,
  "1",
  "Opt in on a dedicated idle desktop with PI_CU_NOTEPAD_INPUT_TEST=1; physical runs are currently deferred",
);
assert.equal(process.platform, "win32", "Run with Windows Node after building");
const folder = await mkdtemp(join(tmpdir(), "pi-cu-notepad-unicode-"));
let client;
let variant;
let provenance;
let operationError;
const cleanupFailures = [];
const retained = new Set();
const hash = (value) => createHash("sha256").update(value).digest("hex");
async function prepareVariant() {
  if (diagnosticName === "baseline") return;
  const root = fileURLToPath(new URL("../", import.meta.url));
  // Under the staged package, the private worker resolves its ancestor node_modules.
  variant = await mkdtemp(join(root, ".pi-cu-unicode-variant-"));
  const sourceRoot = engine === "pi" ? root : option("reference");
  assert.ok(sourceRoot, "reference diagnostic requires --reference");
  for (const name of engine === "pi" ? ["dist", "assets"] : ["mcp", "scripts"])
    await cp(join(sourceRoot, name), join(variant, name), { recursive: true });
  await cp(join(sourceRoot, "package.json"), join(variant, "package.json"));
  const relative =
    engine === "pi" ? "assets/text.cs" : "scripts/windows-uia.ps1";
  const original = await readFile(join(sourceRoot, relative), "utf8");
  const [before, after] =
    diagnosticName === "pi-no-delay"
      ? [
          "const int UnicodeInputDelayMs=50;",
          "const int UnicodeInputDelayMs=0;",
        ]
      : diagnosticName === "reference-keyup-scan"
        ? ["inputs[n].U.ki.wScan = 0;", "inputs[n].U.ki.wScan = ch;"]
        : [
            "int chunk = Math.Min(64, n - sent);",
            "int chunk = Math.Min(2, n - sent);",
          ];
  assert.equal(
    original.split(before).length - 1,
    1,
    "diagnostic requires exactly one expected source location",
  );
  const changed = original.replace(before, after);
  await writeFile(join(variant, relative), changed);
  assert.equal(
    hash(await readFile(join(sourceRoot, relative))),
    hash(original),
    "original source must remain unchanged",
  );
  provenance = {
    diagnostic,
    sourceFile: relative,
    originalSha256: hash(original),
    variantSha256: hash(changed),
    replacement: { before, after },
    productionSourceChanged: false,
  };
  console.log(JSON.stringify({ engine, diagnosticPreparation: provenance }));
}
const compiler = join(
  process.env.WINDIR,
  "Microsoft.NET",
  "Framework64",
  "v4.0.30319",
  "csc.exe",
);
const stateProbe = join(folder, "unicode-input-state.exe");
function inputState(target) {
  const observed = spawnSync(
    stateProbe,
    [String(target.nativeWindowHandle), String(target.processId)],
    { encoding: "utf8", windowsHide: true, cwd: folder },
  );
  assert.equal(observed.status, 0, observed.stdout + observed.stderr);
  const state = JSON.parse(observed.stdout);
  state.legacyContexts = legacyContextReport(state.legacyContexts);
  return state;
}
try {
  const built = spawnSync(
    compiler,
    [
      "/nologo",
      `/out:${stateProbe}`,
      "/r:System.Web.Extensions.dll",
      fileURLToPath(new URL("./unicode-input-state.cs", import.meta.url)),
    ],
    { encoding: "utf8", windowsHide: true, cwd: folder },
  );
  assert.equal(built.status, 0, built.stdout + built.stderr);
  await prepareVariant();
  if (engine === "pi" && variant) {
    const { WorkerClient } = await import(
      pathToFileURL(join(variant, "dist/client.js")).href
    );
    client = new WorkerClient({
      launch: async () => ({
        executable: process.execPath,
        args: [join(variant, "dist/worker.js")],
        cwd: folder,
      }),
    });
  } else {
    client = await createComparisonClient({
      engine,
      referencePath: variant ?? option("reference"),
      cwd: folder,
    });
  }
  for (const { id: caseId, seed, text } of selectedCases) {
    const started = performance.now();
    let typed;
    let dispatchMs;
    let actual;
    let disk;
    let failure;
    let environment;
    const expected = normalize(seed + text);
    try {
      const path = join(folder, `pi-unicode-${randomUUID()}.txt`);
      const stem = basename(path, ".txt");
      await writeFile(path, seed);
      const launched = await client.execute("launch_app", {
        target: "notepad.exe",
        arguments: `"${path}"`,
        waitMs: 1500,
      });
      assert.equal(launched.ok, true, JSON.stringify(launched));
      retained.add(path);
      let window;
      for (let attempt = 0; attempt < 30; attempt++) {
        const result = await client.execute("list_windows", {});
        window = result.windows?.find((item) => item.name.includes(stem));
        if (window) break;
        await delay(100);
      }
      assert.ok(window, "uniquely named Notepad test file must be open");
      const target = {
        nativeWindowHandle: window.nativeWindowHandle,
        processId: window.processId,
      };
      const before = await observe(target);
      assert.equal(before.ok, true, JSON.stringify(before));
      const editors = flatten(before.tree).filter(
        (node) => node.controlType === "Document",
      );
      assert.equal(editors.length, 1, "require one unambiguous test editor");
      assert.equal(
        normalize(editors[0].value ?? ""),
        normalize(seed),
        "test file must contain only its known seed",
      );
      const activated = await client.execute("activate_window", target);
      assert.equal(activated.activated, true, JSON.stringify(activated));
      const focused = await client.execute("focus", {
        ...target,
        elementId: editors[0].id,
      });
      assert.equal(focused.ok, true, JSON.stringify(focused));
      if (seed) {
        const end = await client.execute("keypress", {
          ...target,
          keys: ["Ctrl", "End"],
        });
        assert.equal(end.ok, true, JSON.stringify(end));
      }
      environment = inputState(target);
      assert.equal(
        environment.foregroundHwnd,
        target.nativeWindowHandle,
        "independent foreground must be the owned Notepad window before typing",
      );
      assert.equal(
        environment.focusProcessId,
        target.processId,
        "independent focused child must belong to the owned Notepad process",
      );
      const dispatchStarted = performance.now();
      typed = await client.execute("type_text", {
        ...target,
        text,
        method: "sendinput",
        activate: true,
      });
      dispatchMs = performance.now() - dispatchStarted;
      assert.equal(typed.ok, true, JSON.stringify(typed));
      if (typed.cleanupConfirmed !== undefined)
        assert.equal(typed.cleanupConfirmed, true);
      // Let the application process its queued character messages before reading.
      await delay(1000);
      const after = await client.execute("element_info", {
        ...target,
        elementId: editors[0].id,
        detailLevel: "full",
      });
      assert.equal(after.ok, true, JSON.stringify(after));
      actual = normalize(after.element.value);
      // Save ONLY this uniquely named test file to independently verify actual bytes.
      const current = await observe(target);
      assert.ok(
        current.tree?.name.includes(stem),
        "tab identity must still match before save",
      );
      const saved = await client.execute("keypress", {
        ...target,
        keys: ["Ctrl", "s"],
      });
      assert.equal(saved.ok, true, JSON.stringify(saved));
      for (let attempt = 0; attempt < 30; attempt++) {
        disk = await readFile(path, "utf8");
        if (normalize(disk) === actual) break;
        await delay(100);
      }
      assert.equal(
        normalize(disk),
        actual,
        "saved bytes must independently agree with UIA",
      );
      const savedView = await observe(target);
      assert.ok(
        savedView.tree?.name.includes(stem),
        "tab identity must still match before close",
      );
      const closed = await client.execute("keypress", {
        ...target,
        keys: ["Ctrl", "w"],
      });
      assert.equal(closed.ok, true, JSON.stringify(closed));
      let remains = true;
      for (let attempt = 0; attempt < 30; attempt++) {
        const listed = await client.execute("list_windows", {});
        const original = listed.windows?.find(
          (item) =>
            item.nativeWindowHandle === target.nativeWindowHandle &&
            item.processId === target.processId,
        );
        if (!original) {
          remains = false;
          break;
        }
        const snapshot = await observe(target);
        if (
          snapshot.ok &&
          !snapshot.truncated &&
          !flatten(snapshot.tree).some((node) => node.name?.includes(stem))
        ) {
          remains = false;
          break;
        }
        await delay(100);
      }
      assert.equal(
        remains,
        false,
        "confirm test tab closure before deleting its file",
      );
      retained.delete(path);
      assert.equal(
        actual,
        expected,
        "Notepad must receive every requested Unicode character exactly once",
      );
      assert.equal(normalize(disk), expected);
    } catch (error) {
      failure = { message: error.message, rpcError: error.rpcError };
      throw error;
    } finally {
      console.log(
        JSON.stringify({
          engine,
          case: caseId,
          diagnostic,
          provenance,
          environment,
          ok: !failure,
          seed,
          text,
          expected,
          actual,
          savedText: disk === undefined ? undefined : normalize(disk),
          elapsedMs: performance.now() - started,
          requestedMethod: "sendinput",
          dispatch: typed,
          dispatchMs,
          ownedTabCleanupConfirmed: !retained.size,
          failure,
        }),
      );
    }
  }
} catch (error) {
  operationError = error;
} finally {
  let shutdownAcknowledged = !client;
  try {
    await client?.dispose();
    shutdownAcknowledged = true;
  } catch (error) {
    cleanupFailures.push({ stage: "client-dispose", message: error.message });
  }
  // Do not remove resources still potentially in use by an unconfirmed client.
  if (shutdownAcknowledged) {
    for (const [stage, path, recursive] of [
      ["variant", variant, true],
      ["state-probe", stateProbe, false],
      ...(retained.size === 0 ? [["folder", folder, true]] : []),
    ]) {
      if (!path) continue;
      try {
        await rm(path, {
          recursive,
          force: true,
          maxRetries: 10,
          retryDelay: 100,
        });
      } catch (error) {
        cleanupFailures.push({
          stage,
          message: error.message,
          code: error.code,
        });
      }
    }
  }
  if (retained.size)
    console.error(
      `Retained test files/tabs after an uncertain action: ${folder}`,
    );
  const report = cleanupReport({
    caseFailure: operationError
      ? { message: operationError.message, rpcError: operationError.rpcError }
      : null,
    cleanupFailures,
    retainedTabs: retained.size,
  });
  // Disposal acknowledgment is not independent proof of OS process retirement.
  console.log(
    JSON.stringify({
      engine,
      action: "cleanup",
      ...report,
      clientShutdownAcknowledged: shutdownAcknowledged,
      processRetirementIndependentlyVerified: false,
    }),
  );
}
if (operationError) throw operationError;
if (cleanupFailures.length || retained.size) {
  throw new Error("Unicode test cleanup unconfirmed; see cleanup report");
}
