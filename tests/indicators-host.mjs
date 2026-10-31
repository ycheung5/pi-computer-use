// Nonvisual helper/layout/protocol checks; visible preview is separately opt-in.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { WorkerClient } from "../dist/client.js";
import {
  nativeWorkerLaunch,
  windowsHostEnvironment,
} from "../dist/launcher.js";

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
  assert.equal(afterGuard.control.presentation.held, false);
  assert.equal(afterGuard.control.presentation.visible, false);
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
      disabledIndicatorsStillStop: true,
      invalidPointerQuiet: true,
      monitorsReported: preview.presentation.layout.length,
      shortcutConfigured: true,
      injectedFilter: "configured; physical test pending",
      visiblePreview:
        process.env.PI_CU_ENABLE_INDICATOR_PREVIEW === "1"
          ? "state transition checked; visual acceptance pending"
          : "not run",
      physicalInput: false,
    }),
  );
} finally {
  await worker.dispose();
  await rm(folder, { recursive: true, force: true });
}
