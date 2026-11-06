// Helper/layout/protocol checks; visible previews are explicitly opt-in.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

for (const arg of process.argv.slice(2))
  assert.ok(
    [
      "--layout-only",
      "--lifecycle-only",
      "--recording-preview",
      "--plan",
    ].includes(arg),
    "unknown indicator test option",
  );
assert.ok(
  process.argv.slice(2).filter((arg) => arg !== "--plan").length <= 1,
  "select one indicator test mode",
);
const mode = process.argv.includes("--layout-only")
  ? "layout"
  : process.argv.includes("--lifecycle-only")
    ? "lifecycle"
    : process.argv.includes("--recording-preview")
      ? "recording"
      : "default";
if (process.argv.includes("--plan")) {
  console.log(
    JSON.stringify({
      executed: false,
      mode,
      physicalInput: false,
      globalDisplayChanges: false,
      exclusiveControl: mode === "default" || mode === "lifecycle",
      ...(mode === "recording"
        ? { recordingPhases: [true, false], capturesPixels: false }
        : {}),
    }),
  );
  process.exit(0);
}
const [{ WorkerClient }, { nativeWorkerLaunch, windowsHostEnvironment }] =
  await Promise.all([
    import("../dist/client.js"),
    import("../dist/launcher.js"),
  ]);
const run = promisify(execFile);
const environment = await windowsHostEnvironment();
const folder = await mkdtemp(
  join(environment.localData, "pi-cu-indicator-fixture-"),
);
let file = join(folder, "settings.json");
if (process.platform === "linux")
  file = (await run("wslpath", ["-w", file])).stdout.trim();
const launch = await nativeWorkerLaunch();
const worker = new WorkerClient({
  launch: async () => ({
    ...launch,
    args: [
      "--input-type=module",
      "-e",
      `import{pathToFileURL}from'node:url';process.env.PI_CU_SETTINGS_FILE=${JSON.stringify(file)};await import(pathToFileURL(${JSON.stringify(launch.args[0])}).href);`,
    ],
  }),
});
const operation = "indicator-fixture";
try {
  const health = await worker.execute("health", {});
  assert.equal(health.ok, true);
  assert.equal(
    health.control.started,
    false,
    "quiet health does not start a global listener or overlays",
  );
  const saved = await worker.execute("settings_update", {
    changes: {
      indicatorEnabled: false,
      cursorIndicatorEnabled: false,
      remoteIndicatorVisible: false,
      indicatorText: "Pi fixture",
      indicatorPosition: "bottom",
      indicatorIdleMs: 200,
      stopShortcut: "Ctrl+Alt+F9",
    },
  });
  assert.equal(saved.ok, true, JSON.stringify(saved));
  const preview = await worker.execute("indicator_preview", { show: false });
  assert.equal(preview.ok, true, JSON.stringify(preview));
  assert.equal(preview.armed, false);
  assert.equal(preview.presentation.visible, false);
  assert.equal(preview.presentation.renderChecked, true);
  if (process.env.PI_CU_INDICATOR_ARTIFACT) {
    let png = preview.presentation.previewPath;
    if (process.platform === "linux")
      png = (await run("wslpath", ["-u", png])).stdout.trim();
    await writeFile(process.env.PI_CU_INDICATOR_ARTIFACT, await readFile(png));
  }
  assert.equal(preview.presentation.text, "Pi fixture");
  assert.equal(preview.presentation.position, "bottom");
  assert.equal(preview.presentation.screenEnabled, false);
  assert.equal(preview.presentation.pointerEnabled, false);
  assert.equal(preview.presentation.remoteVisible, false);
  assert.ok(preview.presentation.layout.length > 0);
  for (const display of preview.presentation.layout) {
    assert.ok(display.width > 0 && display.height > 0 && display.scale > 0);
    assert.ok(display.bar.width > 0 && display.bar.height > 0);
  }
  assert.equal(preview.stopShortcut, "Ctrl+Alt+F9");
  assert.equal(preview.shortcutVirtualKey, 0x78);
  assert.equal(preview.shortcutModifiers, 3);
  assert.equal(preview.escAlwaysEnabled, true);
  assert.equal(preview.injectedKeysIgnored, true);
  if (mode === "layout") {
    const after = await worker.execute("health", {});
    assert.equal(after.control.armed, false);
    assert.equal(after.control.presentation.visible, false);
    console.log(
      JSON.stringify({
        ok: true,
        check: "passive display inventory",
        layout: preview.presentation.layout,
        physicalInput: false,
        armed: false,
        visible: false,
      }),
    );
  } else if (mode === "lifecycle") await verifyHeldLifecycle(preview);
  else if (mode === "recording") await verifyRecordingPreview(preview);
  else await verifyControlProtocol(preview);
} finally {
  await worker.dispose();
  await rm(folder, { recursive: true, force: true });
}

async function verifyRecordingPreview(preview) {
  const phases = [];
  for (const remoteVisible of [true, false]) {
    // Let the preceding two-second preview expire before changing phase.
    await new Promise((resolve) => setTimeout(resolve, 2200));
    const configured = await worker.execute("settings_update", {
      changes: {
        indicatorEnabled: true,
        cursorIndicatorEnabled: false,
        remoteIndicatorVisible: remoteVisible,
        indicatorText: remoteVisible
          ? "Pi recording visible"
          : "Pi recording hidden",
      },
    });
    assert.equal(configured.ok, true, JSON.stringify(configured));
    const samples = [];
    for (let i = 0; i < 8; i++) {
      const shown = await worker.execute("indicator_preview", { show: true });
      assert.equal(shown.ok, true, JSON.stringify(shown));
      assert.equal(shown.armed, false);
      assert.equal(shown.exclusiveControl, false);
      assert.equal(shown.presentation.held, false);
      assert.equal(shown.presentation.visible, true);
      assert.equal(shown.presentation.remoteVisible, remoteVisible);
      assert.equal(shown.presentation.captureAffinityApplied, true);
      assert.deepEqual(shown.presentation.frameErrors, []);
      assert.equal(
        shown.presentation.visibleWindows,
        preview.presentation.layout.length * 2,
      );
      samples.push({
        listenerProcessId: shown.listenerProcessId,
        remoteVisible: shown.presentation.remoteVisible,
        visibleWindows: shown.presentation.visibleWindows,
        captureAffinityApplied: shown.presentation.captureAffinityApplied,
      });
      if (i === 0)
        console.log(
          JSON.stringify({
            stage: remoteVisible ? "recording-enabled" : "recording-hidden",
            seconds: 8,
            localVisible: true,
            armed: false,
            exclusiveControl: false,
          }),
        );
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    phases.push({ remoteVisible, samples });
  }
  await new Promise((resolve) => setTimeout(resolve, 2200));
  const ended = (await worker.execute("health", {})).control;
  assert.equal(ended.armed, false);
  assert.equal(ended.exclusiveControl, false);
  assert.equal(ended.presentation.visible, false);
  console.log(
    JSON.stringify({
      ok: true,
      check: "recording preview helper protocol",
      phases,
      physicalInput: false,
      capturesPixels: false,
      thirdPartyRecording:
        "requires user observation; metadata is not a recorder verdict",
    }),
  );
}

async function verifyControlProtocol(preview) {
  const prepared = await worker.execute(
    "prepare_input",
    {},
    undefined,
    operation,
  );
  assert.equal(prepared.ok, true, JSON.stringify(prepared));
  assert.equal(
    prepared.armed,
    true,
    "disabling indicators does not disable emergency stopping",
  );
  assert.equal(prepared.presentation.visible, false);
  assert.equal(
    prepared.presentation.held,
    false,
    "arming alone does not claim physical input occurred",
  );
  const guarded = await worker.execute(
    "click",
    { x: 0, y: 0, nativeWindowHandle: 1, processId: 1 },
    undefined,
    operation,
  );
  assert.equal(guarded.ok, false);
  const afterGuard = await worker.execute("health", {});
  assert.equal(afterGuard.control.exclusiveControl, true);
  assert.equal(afterGuard.control.presentation.held, true);
  assert.equal(afterGuard.control.presentation.visible, true);
  worker.stopOperation(operation);
  const stopped = await worker.execute(
    "list_windows",
    { maxWindows: 1 },
    undefined,
    operation,
  );
  assert.equal(stopped.ok, false);
  assert.match(stopped.error, /STOPPED/);
  await worker.execute("operation_end", {}, undefined, operation);
  if (process.env.PI_CU_ENABLE_INDICATOR_PREVIEW === "1") {
    const enabled = await worker.execute("settings_update", {
      changes: { indicatorEnabled: true, cursorIndicatorEnabled: true },
    });
    assert.equal(enabled.ok, true);
    const shown = await worker.execute("indicator_preview", { show: true });
    assert.equal(shown.presentation.visible, true);
    assert.deepEqual(
      shown.presentation.frameErrors,
      [],
      "every requested screen-edge frame must render without errors",
    );
    assert.equal(
      shown.presentation.visibleWindows,
      shown.presentation.layout.length * 2 + 1,
      "preview shows one screen-edge frame and status bar per monitor, plus the pointer tag",
    );
    assert.equal(
      shown.presentation.clickThroughHitTestPassed,
      true,
      "native WindowFromPoint skips the disabled indicator bars",
    );
    assert.equal(shown.armed, false);
    const captured = await worker.execute(
      "screenshot",
      { scope: "desktop", maxWidth: 1 },
      undefined,
      "preview-capture",
    );
    assert.equal(captured.ok, true, JSON.stringify(captured));
    const captureStatus = await worker.execute("health", {});
    assert.equal(captureStatus.control.presentation.suspended, false);
    assert.ok(captureStatus.control.presentation.captureSuspensions > 0);
    assert.equal(captureStatus.control.armed, false);
    await worker.execute("operation_end", {}, undefined, "preview-capture");
    await new Promise((resolve) => setTimeout(resolve, 2200));
    const hidden = await worker.execute("health", {});
    assert.equal(hidden.control.presentation.visible, false);
  }
  let peer = fileURLToPath(new URL("./indicators-peer.mjs", import.meta.url));
  if (process.platform === "linux")
    peer = (await run("wslpath", ["-w", peer])).stdout.trim();
  const protocol = await run(launch.executable, [peer], {
    cwd: launch.cwd,
    timeout: 30000,
  });
  assert.equal(JSON.parse(protocol.stdout.trim()).ok, true);
  console.log(
    JSON.stringify({
      ok: true,
      check: "independent indicator/shortcut helper",
      quietStartup: true,
      nonvisualRendering: true,
      optionalIndicatorsDoNotDisableStop: true,
      requiredBorderDespiteSettings: true,
      invalidPointerInputRefused: true,
      monitorsReported: preview.presentation.layout.length,
      shortcutConfigured: true,
      injectedFilter: "configured; accepted physical evidence remains in #31",
      visiblePreview:
        process.env.PI_CU_ENABLE_INDICATOR_PREVIEW === "1"
          ? "state transition checked; visual acceptance pending"
          : "not run",
      physicalInput: false,
    }),
  );
}

async function verifyHeldLifecycle(preview) {
  const samples = [];
  const observe = async (stage) => {
    const health = await worker.execute("health", {});
    assert.equal(health.ok, true, JSON.stringify(health));
    const c = health.control,
      p = c.presentation;
    samples.push({
      stage,
      operationId: c.operationId,
      listenerProcessId: c.listenerProcessId,
      armed: c.armed,
      exclusiveControl: c.exclusiveControl,
      held: p.held,
      visible: p.visible,
      visibleWindows: p.visibleWindows,
      frameErrors: p.frameErrors,
      remoteVisible: p.remoteVisible,
      captureAffinityApplied: p.captureAffinityApplied,
    });
    return c;
  };
  const held = (c) => {
    assert.equal(c.exclusiveControl, true);
    assert.equal(c.armed, true);
    assert.equal(c.presentation.held, true);
    assert.equal(c.presentation.visible, true);
    assert.deepEqual(c.presentation.frameErrors, []);
  };
  assert.equal(
    (
      await worker.execute("settings_update", {
        changes: {
          indicatorEnabled: true,
          cursorIndicatorEnabled: true,
          remoteIndicatorVisible: true,
        },
      })
    ).ok,
    true,
  );
  const ready = await worker.execute("prepare_input", {}, undefined, operation);
  assert.equal(ready.ok, true, JSON.stringify(ready));
  const invalid = async (id) => {
    const r = await worker.execute(
      "click",
      { x: 0, y: 0, nativeWindowHandle: 1, processId: 1 },
      undefined,
      id,
    );
    assert.equal(r.ok, false);
    assert.match(r.error, /TARGET_IDENTITY_CHANGED/);
    assert.equal(r.cleanupConfirmed, true);
  };
  await invalid(operation);
  const first = await observe("acquired");
  held(first);
  assert.equal(first.presentation.remoteVisible, true);
  assert.equal(
    first.presentation.visibleWindows,
    preview.presentation.layout.length * 2 + 1,
  );
  await worker.execute("wait", { milliseconds: 750 }, undefined, operation);
  const gap = await observe("after-read-and-gap");
  held(gap);
  assert.equal(gap.listenerProcessId, first.listenerProcessId);
  assert.equal(gap.operationId, first.operationId);
  const changed = await worker.execute("settings_update", {
    changes: {
      indicatorEnabled: false,
      cursorIndicatorEnabled: false,
      remoteIndicatorVisible: false,
      indicatorText: "Pi changed while held",
      indicatorIdleMs: 200,
    },
  });
  assert.equal(changed.ok, true, JSON.stringify(changed));
  const configured = await observe("disabled-optional-visuals");
  held(configured);
  assert.equal(configured.presentation.remoteVisible, false);
  assert.equal(
    configured.presentation.visibleWindows,
    preview.presentation.layout.length,
  );
  assert.equal(configured.presentation.text, "Pi changed while held");
  await worker.execute("wait", { milliseconds: 750 }, undefined, operation);
  held(await observe("beyond-configured-idle"));
  const bad = await worker.execute("settings_update", {
    changes: { indicatorPosition: "invalid" },
  });
  assert.equal(bad.ok, false);
  held(await observe("after-settings-refusal"));
  const ended = await worker.execute("operation_end", {}, undefined, operation);
  assert.equal(ended.ok, true);
  assert.equal(ended.released, true);
  const released = await observe("settled-handback");
  assert.equal(released.exclusiveControl, false);
  assert.equal(released.presentation.visible, false);
  const continued = operation + "-new-user-operation";
  const next = await worker.execute("prepare_input", {}, undefined, continued);
  assert.equal(next.ok, true);
  assert.notEqual(next.cancelEvent, ready.cancelEvent);
  await invalid(continued);
  const reacquired = await observe("explicit-new-operation");
  held(reacquired);
  assert.notEqual(reacquired.operationId, first.operationId);
  worker.stopOperation(continued);
  const stopped = await worker.execute(
    "wait",
    { milliseconds: 1 },
    undefined,
    continued,
  );
  assert.equal(stopped.ok, false);
  assert.match(stopped.error, /STOPPED/);
  const deadline = Date.now() + 3000;
  let final;
  do {
    final = await observe("after-stop");
    if (
      final.exclusiveControl === false &&
      final.presentation.visible === false
    )
      break;
    await new Promise((r) => setTimeout(r, 20));
  } while (Date.now() < deadline);
  assert.equal(final.exclusiveControl, false);
  assert.equal(final.presentation.visible, false);
  assert.equal(
    (await worker.execute("operation_end", {}, undefined, continued)).ok,
    true,
  );
  console.log(
    JSON.stringify({
      ok: true,
      check: "required border operation lifecycle",
      samples,
      physicalInput: false,
      globalDisplayChanges: false,
      ownCapturePixels: "separate owned-capture case",
      thirdPartyCapture: "not tested",
    }),
  );
}
