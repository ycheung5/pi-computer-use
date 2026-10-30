// Opt-in dedicated-desktop checks: sends real pointer input. Read docs/pointer.md first.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const options = process.argv.slice(2);
for (const option of options)
  assert.ok(
    option === "--list" ||
      /^--(engine|reference|report-drag|case)=.+/.test(option),
    `Unknown option: ${option}`,
  );
const option = (name) =>
  options.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
// Offline reports use the same assessment as the live runner and never dispatch input.
function dragReport(evidence) {
  const last = evidence.observations?.at(-1);
  const cancellationText =
    evidence.dispatch?.status === "rejected"
      ? evidence.dispatch.error?.message
      : evidence.dispatch?.value?.ok === false
        ? evidence.dispatch.value.error
        : "";
  const cancellationConfirmed =
    evidence.down?.status === "fulfilled" &&
    /abort|STOPPED|CANCELLED/i.test(cancellationText ?? "");
  const releaseConfirmed =
    !evidence.observationError &&
    last?.held === 0 &&
    Number.isInteger(evidence.before?.releases) &&
    Number.isInteger(last?.releases) &&
    last.releases > evidence.before.releases;
  return {
    ok: cancellationConfirmed && releaseConfirmed,
    check: "drag-cancellation-release",
    cancellationConfirmed,
    releaseConfirmed,
    cleanupVerification: releaseConfirmed
      ? "released"
      : last?.held === 1
        ? "held"
        : "unconfirmed",
    evidence,
  };
}
if (option("report-drag")) {
  const evidence = JSON.parse(await readFile(option("report-drag"), "utf8"));
  const report = dragReport(evidence);
  console.log(JSON.stringify({ ...report, inputDispatched: false }));
  process.exit(report.ok ? 0 : 1);
}
const engine = option("engine") ?? "pi";
const selectedCase = option("case");
assert.ok(!selectedCase || selectedCase === "drag-drop", "unknown case");
assert.ok(
  ["pi", "reference"].includes(engine),
  "engine must be pi or reference",
);
if (options.includes("--list")) {
  console.log(
    JSON.stringify({
      engine,
      executed: false,
      cases: selectedCase
        ? ["successful-drag-drop"]
        : [
            "scaled-click",
            "double-click",
            "hover",
            "coordinate-scroll",
            "drag-cancellation-release",
          ],
      pending: [
        "successful-drag-drop",
        "foreground-restoration",
        "user-interference",
        "menus-dialogs",
        "window-launch-close-veto",
        "same-process-distractors",
        "replaced-targets",
        "mixed-dpi-negative-origin",
        "physical-stop",
      ],
    }),
  );
  process.exit(0);
}
assert.equal(
  process.env.PI_CU_DEDICATED_INPUT_DESKTOP,
  "1",
  "Opt in with PI_CU_DEDICATED_INPUT_DESKTOP=1 only on a dedicated interactive test desktop; physical runs are deferred.",
);
assert.equal(process.platform, "win32", "Run with Windows Node after building");
if (selectedCase === "drag-drop") {
  const { runDragDrop } = await import("./native-pointer-drop.mjs");
  await runDragDrop({ engine, referencePath: option("reference") });
  process.exit(0);
}
const folder = await mkdtemp(join(tmpdir(), "pi-cu-controls-"));
const executable = join(folder, "fixture.exe");
process.env.PI_CU_SETTINGS_FILE = join(folder, "settings.json");
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
    "/target:exe",
    `/out:${executable}`,
    "/r:System.Windows.Forms.dll",
    "/r:System.Drawing.dll",
    fileURLToPath(new URL("./controls-fixture.cs", import.meta.url)),
  ],
  { encoding: "utf8", cwd: folder, windowsHide: true },
);
assert.equal(built.status, 0, built.stdout + built.stderr);
const fixture = spawn(executable, [`Pi CU Controls ${Date.now()}`], {
  stdio: ["pipe", "pipe", "pipe"],
  cwd: folder,
  windowsHide: true,
});
const [ready] = await once(fixture.stdout, "data");
const target = {
  nativeWindowHandle: Number(ready.toString().trim()),
  processId: fixture.pid,
};
let host;
let client;
let execute;
let watchdog;
try {
  if (engine === "pi") {
    const [{ default: computerUse }, { computerUseHost }] = await Promise.all([
      import("../dist/extension.js"),
      import("./native-host.mjs"),
    ]);
    host = computerUseHost();
    computerUse(host.api);
    execute = async (action, args, signal) => {
      const tool = host.tools.get(`windows_computer_use_${action}`);
      assert.ok(tool, `Pi registers ${action}`);
      return (await tool.execute(action, args, signal, undefined, {})).details;
    };
  } else {
    const { createComparisonClient } = await import("./comparison-client.mjs");
    client = await createComparisonClient({
      engine,
      referencePath: option("reference"),
      cwd: folder,
    });
    execute = (action, args, signal) => client.execute(action, args, signal);
  }
  const call = async (action, args = {}, signal) => {
    try {
      const result = await execute(action, { ...target, ...args }, signal);
      console.log(JSON.stringify({ engine, action, result }));
      return result;
    } catch (error) {
      console.log(
        JSON.stringify({
          engine,
          action,
          error: { message: error.message, rpcError: error.rpcError },
        }),
      );
      throw error;
    }
  };
  // Fixture-owned state is independent of both engines' targeting/remembered foreground.
  const observePointer = () =>
    new Promise((resolve, reject) => {
      let buffered = "";
      const timeout = setTimeout(
        () => finish(new Error("pointer oracle timed out")),
        5000,
      );
      const receive = (chunk) => {
        buffered += chunk.toString();
        const lines = buffered.split(/\r?\n/);
        buffered = lines.pop();
        for (const line of lines) {
          if (line.startsWith("pointer-state:")) {
            const [clicks, doubles, hover, scroll, held, releases, foreground] =
              line.slice(14).split(":").map(Number);
            finish(null, {
              clicks,
              doubles,
              hover,
              scroll,
              held,
              releases,
              foreground,
            });
            return;
          }
        }
      };
      function finish(error, state) {
        clearTimeout(timeout);
        fixture.stdout.off("data", receive);
        if (error) reject(error);
        else resolve(state);
      }
      fixture.stdout.on("data", receive);
      fixture.stdin.write("observe-pointer\n");
    });
  const find = async (query, controlType) => {
    const result = await call("find", {
      query,
      controlType,
      ocrFallback: false,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    return result.matches;
  };
  const initial = await observePointer();
  assert.equal(initial.clicks, 0);
  const button = (await find("Background action", "Button"))[0];
  const screenPoint = {
    x: Math.round(button.boundingBox.centerX),
    y: Math.round(button.boundingBox.centerY),
  };
  const captured = await call("screenshot", { maxWidth: 260 });
  assert.equal(captured.ok, true, JSON.stringify(captured));
  const capture = captured.screenshot;
  // DSH exposes one uniform scale; Pi additionally exposes exact Y scaling.
  const scaleY = capture.imageScaleY ?? capture.imageScale;
  assert.ok(Number.isFinite(capture.imageScale) && capture.imageScale > 0);
  assert.ok(Number.isFinite(scaleY) && scaleY > 0);
  const imagePoint = {
    x: (screenPoint.x - capture.origin.x) * capture.imageScale,
    y: (screenPoint.y - capture.origin.y) * scaleY,
  };
  const mapped = {
    x: Math.round(imagePoint.x / capture.imageScale + capture.origin.x),
    y: Math.round(imagePoint.y / scaleY + capture.origin.y),
  };
  const clicked = await call("click", { ...mapped, dispatch: "foreground" });
  assert.equal(clicked.ok, true, JSON.stringify(clicked));
  assert.ok(
    (await find("Clicked 1", "Text")).length,
    "physical click reached the intended scaled point",
  );
  assert.equal((await observePointer()).clicks, 1);
  const surface = (await find("Pointer fixture surface", "Pane"))[0];
  const doubled = await call("double_click", {
    elementId: surface.id,
    dispatch: "foreground",
  });
  assert.equal(doubled.ok, true, JSON.stringify(doubled));
  assert.equal(
    (await observePointer()).doubles,
    1,
    "fixture received exactly one double click",
  );
  const activated = await call("activate_window", { activate: true });
  assert.equal(activated.activated, true, JSON.stringify(activated));
  assert.equal(
    (await observePointer()).foreground,
    target.nativeWindowHandle,
    "owned fixture must independently be foreground before hover",
  );
  const moved = await call("move", { elementId: button.id, activate: true });
  assert.equal(moved.ok, true, JSON.stringify(moved));
  let hoverState;
  for (let attempt = 0; attempt < 20; attempt++) {
    hoverState = await observePointer();
    if (hoverState.hover === 1) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(hoverState.hover, 1, "fixture independently observed hover");
  const panel = (await find("Background scroller", "Pane"))[0];
  const scrolled = await call("scroll", {
    x: Math.round(panel.boundingBox.centerX),
    y: Math.round(panel.boundingBox.centerY),
    deltaY: 240,
  });
  assert.equal(scrolled.ok, true, JSON.stringify(scrolled));
  assert.ok(
    (await observePointer()).scroll > initial.scroll,
    "inner panel actually scrolled",
  );
  const beforeDrag = await observePointer();
  const start = {
    x: Math.round(surface.boundingBox.centerX),
    y: Math.round(surface.boundingBox.centerY),
  };
  const path = Array.from({ length: 1000 }, (_, index) => ({
    x: start.x + (index % 2),
    y: start.y,
  }));
  const controller = new AbortController();
  const down = new Promise((resolve, reject) => {
    let buffered = "";
    const receive = (chunk) => {
      buffered += chunk.toString();
      if (
        buffered.includes("pointer-down\n") ||
        buffered.includes("pointer-down\r\n")
      ) {
        fixture.stdout.off("data", receive);
        clearTimeout(watchdog);
        controller.abort();
        resolve();
      }
    };
    fixture.stdout.on("data", receive);
    watchdog = setTimeout(() => {
      fixture.stdout.off("data", receive);
      controller.abort();
      reject(new Error("fixture did not receive mouse down"));
    }, 15000);
  });
  const dragged = call("drag", { path }, controller.signal);
  const [downResult, dispatchResult] = await Promise.allSettled([
    down,
    dragged,
  ]);
  const retainedResult = (result) =>
    result.status === "fulfilled"
      ? { status: result.status, value: result.value }
      : {
          status: result.status,
          error: {
            name: result.reason?.name,
            message: String(result.reason?.message ?? result.reason),
          },
        };
  const evidence = {
    engine,
    before: beforeDrag,
    down: retainedResult(downResult),
    dispatch: retainedResult(dispatchResult),
    observations: [],
  };
  // Always observe release, including timeout/unexpected-error paths, before teardown.
  // This is read-only: a held/unconfirmed button is reported, never automatically released.
  try {
    for (let attempt = 0; attempt < 50; attempt++) {
      const state = await observePointer();
      evidence.observations.push(state);
      if (state.held === 0 && state.releases > beforeDrag.releases) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  } catch (error) {
    evidence.observationError = { name: error.name, message: error.message };
  }
  const report = dragReport(evidence);
  console.log(JSON.stringify(report));
  assert.equal(report.ok, true, JSON.stringify(report));
  console.log(
    JSON.stringify({
      engine,
      ok: true,
      physicalInput: true,
      scaledPoint: true,
      click: true,
      doubleClick: true,
      move: true,
      coordinateScroll: true,
      dragCancellation: true,
      physicalEsc: "manual check pending",
      restoration:
        "inspect returned pointer/foreground reports and validate user interference manually",
    }),
  );
} finally {
  clearTimeout(watchdog);
  for (const handler of host?.shutdown ?? []) await handler();
  await client?.dispose();
  if (fixture.exitCode === null) {
    const closed = once(fixture, "close");
    fixture.stdin.end("stop\n");
    const timeout = setTimeout(() => fixture.kill(), 1000);
    await closed;
    clearTimeout(timeout);
  }
  await rm(folder, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  });
}
