// Windows-only read-only screenshots against a dedicated passive fixture.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import { computerUseHost } from "./native-host.mjs";

assert.ok(
  process.argv
    .slice(2)
    .every((arg) =>
      [
        "--lifetime-only",
        "--window-only",
        "--display",
        "--control-capture",
        "--plan",
      ].includes(arg),
    ),
  "unknown capture test option",
);
const lifetimeOnly = process.argv.includes("--lifetime-only");
const windowOnly = process.argv.includes("--window-only");
const controlCapture = process.argv.includes("--control-capture");
const displayMode = controlCapture || process.argv.includes("--display");
assert.ok(
  process.argv.slice(2).filter((arg) => arg !== "--plan").length <= 1,
  "select one capture mode",
);
if (process.argv.includes("--plan")) {
  assert.ok(displayMode, "select a display capture mode for planning");
  console.log(
    JSON.stringify({
      executed: false,
      physicalInput: false,
      globalDisplayChanges: false,
      ownedWindowOnly: true,
      mode: controlCapture ? "control-capture" : "display",
      maxWidths: [0, 80],
    }),
  );
  process.exit(0);
}
assert.equal(process.platform, "win32");
const { default: computerUse } = await import("../dist/extension.js");
const folder = await mkdtemp(join(tmpdir(), "pi-cu-capture-fixture-"));
if (displayMode) {
  process.env.PI_CU_SETTINGS_FILE = join(folder, "settings.json");
  await writeFile(
    process.env.PI_CU_SETTINGS_FILE,
    JSON.stringify({
      indicatorEnabled: false,
      cursorIndicatorEnabled: false,
      remoteIndicatorVisible: true,
      indicatorIdleMs: 200,
    }),
  );
}
const executable = join(folder, "fixture.exe");
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
    fileURLToPath(new URL("./capture-fixture.cs", import.meta.url)),
  ],
  { encoding: "utf8", windowsHide: true, cwd: folder, timeout: 15000 },
);
assert.equal(built.status, 0, built.stdout + built.stderr);
let fixture,
  fixtureClosed,
  fixtureLines,
  handle,
  diagnostics = "";
async function bounded(promise, label, ms = 8000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error(`${label}: ${diagnostics}`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function nextLine() {
  const row = await bounded(fixtureLines.next(), "fixture reply unavailable");
  if (row.done) throw Error(`fixture exited before reply: ${diagnostics}`);
  return row.value;
}
async function startFixture(args) {
  diagnostics = "";
  fixture = spawn(executable, args, {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    cwd: folder,
  });
  fixtureClosed = once(fixture, "close").catch((error) => {
    diagnostics += String(error);
    return [-1];
  });
  fixture.stdin.on("error", () => {});
  fixture.stderr.on("data", (bytes) => {
    diagnostics = (diagnostics + bytes).slice(-8192);
  });
  fixtureLines = createInterface({ input: fixture.stdout })[
    Symbol.asyncIterator
  ]();
  handle = Number(await nextLine());
  assert.ok(
    Number.isSafeInteger(handle) && handle > 0 && fixture.pid > 0,
    "owned fixture identity required",
  );
}
async function closeFixture() {
  if (!fixture) return;
  let timer;
  try {
    if (fixture.exitCode === null && !fixture.killed) {
      fixture.stdin.end("stop\n");
      timer = setTimeout(() => fixture.kill(), 2000);
    }
    const [code] = await bounded(
      fixtureClosed,
      "owned fixture exit unconfirmed",
      5000,
    );
    assert.equal(code, 0, `fixture did not exit cleanly: ${diagnostics}`);
  } finally {
    clearTimeout(timer);
  }
}
const host = computerUseHost();
computerUse(host.api);
const tool = host.tools.get("windows_computer_use_screenshot");
assert.ok(tool, "Pi registers screenshot capability");
let centerPixel, lastPng;
function pngCenter(png, px, py) {
  const width = png.readUInt32BE(16),
    height = png.readUInt32BE(20),
    channels = png[25] === 6 ? 4 : 3;
  px ??= Math.floor(width / 2);
  py ??= Math.floor(height / 2);
  assert.ok(
    Number.isInteger(px) &&
      Number.isInteger(py) &&
      px >= 0 &&
      py >= 0 &&
      px < width &&
      py < height,
  );
  assert.equal(png[24], 8);
  assert.ok(png[25] === 6 || png[25] === 2);
  const chunks = [];
  for (let offset = 8; offset < png.length; ) {
    const length = png.readUInt32BE(offset);
    if (png.subarray(offset + 4, offset + 8).toString() === "IDAT")
      chunks.push(png.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const data = inflateSync(Buffer.concat(chunks)),
    stride = width * channels;
  let previous = Buffer.alloc(stride);
  for (let y = 0; y <= py; y++) {
    const row = Buffer.from(
      data.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)),
    );
    const filter = data[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? row[x - channels] : 0,
        up = previous[x],
        corner = x >= channels ? previous[x - channels] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = Math.floor((left + up) / 2);
      else if (filter === 4) {
        const guess = left + up - corner,
          a = Math.abs(guess - left),
          b = Math.abs(guess - up),
          c = Math.abs(guess - corner);
        predictor = a <= b && a <= c ? left : b <= c ? up : corner;
      } else assert.equal(filter, 0);
      row[x] = (row[x] + predictor) & 255;
    }
    previous = row;
  }
  return Array.from(previous.subarray(px * channels, px * channels + 3));
}
const call = async (extra = {}) => {
  const result = await tool.execute(
    `capture-${Date.now()}`,
    {
      nativeWindowHandle: handle,
      processId: fixture.pid,
      maxWidth: 80,
      ...(windowOnly || displayMode ? { windowOnly: true } : {}),
      ...extra,
    },
    undefined,
    undefined,
    {},
  );
  const text = result.content.find((item) => item.type === "text");
  const metadata = JSON.parse(text.text);
  assert.equal(metadata.ok, true, text.text);
  assert.equal(text.text.includes('"base64"'), false);
  const image = result.content.find((item) => item.type === "image");
  assert.equal(image.mimeType, "image/png");
  const png = Buffer.from(image.data, "base64");
  lastPng = png;
  centerPixel = pngCenter(png);
  assert.equal(png.subarray(1, 4).toString(), "PNG");
  assert.equal(png.readUInt32BE(16), metadata.screenshot.width);
  assert.equal(png.readUInt32BE(20), metadata.screenshot.height);
  assert.equal(
    metadata.screenshot.width,
    (extra.maxWidth ?? 80) === 0
      ? metadata.screenshot.bounds.width
      : Math.min(extra.maxWidth ?? 80, metadata.screenshot.bounds.width),
  );
  if (displayMode) {
    assert.equal(metadata.screenshot.source, "window");
    assert.equal(metadata.screenshot.windowCaptureFailed, false);
    assert.equal(metadata.screenshot.occludedPossible, false);
    assert.ok(["printwindow", "wgc"].includes(metadata.screenshot.method));
  }
  assert.equal(metadata.screenshot.origin.x, metadata.screenshot.bounds.x);
  assert.equal(metadata.screenshot.origin.y, metadata.screenshot.bounds.y);
  assert.ok(
    Math.abs(
      metadata.screenshot.imageScale * metadata.screenshot.bounds.width -
        metadata.screenshot.width,
    ) < 0.000001,
  );
  return metadata.screenshot;
};
const command = async (value) => {
  fixture.stdin.write(`${value}\n`);
  return nextLine();
};
try {
  await startFixture([
    `Pi CU Capture ${Date.now()}`,
    ...(displayMode ? ["--display"] : []),
  ]);
  if (displayMode) await verifyDisplay();
  else if (windowOnly) await verifyWindowOnly();
  else await verifyDefault();
} finally {
  try {
    for (const shutdown of host.shutdown) await shutdown();
  } finally {
    try {
      await closeFixture();
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  }
}

async function verifyWindowOnly() {
  const normal = await call();
  assert.equal(normal.method, "printwindow");
  assert.deepEqual(centerPixel, [20, 150, 80]);
  assert.equal(typeof normal.windowRef, "string");
  assert.ok(normal.windowRef.length > 0);
  const bound = await call({ windowRef: normal.windowRef });
  assert.equal(bound.windowRef, normal.windowRef);
  await command("cover");
  const covered = await call();
  assert.ok(["printwindow", "wgc"].includes(covered.method));
  assert.equal(covered.windowCaptureFailed, false);
  assert.equal(covered.occludedPossible, false);
  assert.deepEqual(centerPixel, [20, 150, 80]);
  await closeFixture();
  await startFixture([`Pi CU strict black ${Date.now()}`, "black"]);
  await command("cover");
  const composited = await call();
  assert.equal(composited.method, "wgc");
  assert.deepEqual(centerPixel, [0, 0, 0]);
  for (const state of ["minimize", "hide"]) {
    await command("restore");
    assert.deepEqual(JSON.parse(await command("state")), {
      visible: true,
      minimized: false,
    });
    await command(state);
    const observed = JSON.parse(await command("state"));
    assert.equal(observed.minimized, state === "minimize");
    if (state === "hide") assert.equal(observed.visible, false);
    const refused = await tool.execute(
      `strict-${state}`,
      {
        nativeWindowHandle: handle,
        processId: fixture.pid,
        windowOnly: true,
      },
      undefined,
      undefined,
      {},
    );
    assert.equal(refused.isError, true);
    assert.match(JSON.stringify(refused.details), /WINDOW_CAPTURE_UNAVAILABLE/);
    assert.equal(
      refused.content.some((item) => item.type === "image"),
      false,
    );
  }
  console.log(
    JSON.stringify({
      ok: true,
      check: "window-only screenshot",
      normal: normal.method,
      covered: covered.method,
      blank: composited.method,
      hiddenMinimizedRefused: true,
      pixels: true,
      physicalInput: false,
      desktopCapture: false,
    }),
  );
}

async function verifyDefault() {
  const normal = await call();
  assert.deepEqual(
    centerPixel,
    [20, 150, 80],
    "fixture pixels are captured, not an arbitrary desktop region",
  );
  assert.equal(normal.windowCaptureFailed, false);
  assert.equal(normal.occludedPossible, false);
  if (lifetimeOnly) {
    const bound = await call({ windowRef: normal.windowRef });
    assert.equal(bound.windowRef, normal.windowRef);
    assert.equal(bound.source, "window");
  }
  const snapshotTool = host.tools.get("windows_computer_use_snapshot");
  const snapshot = await snapshotTool.execute(
    "snapshot-image",
    {
      nativeWindowHandle: handle,
      processId: fixture.pid,
      captureWindow: true,
      ...(lifetimeOnly ? { windowRef: normal.windowRef } : {}),
      maxWidth: 80,
    },
    undefined,
    undefined,
    {},
  );
  assert.equal(snapshot.isError, false);
  assert.ok(
    snapshot.content.some((item) => item.type === "image"),
    "snapshot includes a separate PNG by default",
  );
  const snapshotText = JSON.parse(
    snapshot.content.find((item) => item.type === "text").text,
  );
  assert.equal(snapshotText.screenshot.width, 80);
  assert.equal("screenshotPending" in snapshotText, false);
  if (lifetimeOnly) {
    assert.equal(snapshotText.windowRef, normal.windowRef);
    assert.equal(snapshotText.screenshot.windowRef, normal.windowRef);
  }
  const noImage = await snapshotTool.execute(
    "snapshot-no-image",
    {
      nativeWindowHandle: handle,
      processId: fixture.pid,
      includeScreenshot: false,
    },
    undefined,
    undefined,
    {},
  );
  assert.equal(
    noImage.content.some((item) => item.type === "image"),
    false,
  );
  if (!lifetimeOnly) {
    const failedSnapshot = await snapshotTool.execute(
      "snapshot-failed-tree",
      {
        nativeWindowHandle: handle,
        processId: fixture.pid + 100000,
        maxWidth: 80,
      },
      undefined,
      undefined,
      {},
    );
    assert.equal(
      failedSnapshot.isError,
      true,
      "an attached screenshot does not turn failed UIA into success",
    );
    assert.ok(failedSnapshot.content.some((item) => item.type === "image"));
    const failedDetails = JSON.parse(
      failedSnapshot.content.find((item) => item.type === "text").text,
    );
    assert.equal(failedDetails.ok, false);
    assert.equal(
      failedDetails.screenshot.method,
      "screen",
      "snapshot defaults to desktop capture unless captureWindow is requested",
    );
  }
  await command("cover");
  const covered = await call();
  assert.deepEqual(
    centerPixel,
    [20, 150, 80],
    "PrintWindow captures the fixture behind the magenta cover",
  );
  assert.ok(["printwindow", "wgc", "screen-region"].includes(covered.method));
  if (covered.method === "screen-region")
    assert.equal(covered.occludedPossible, true);
  await closeFixture();
  await startFixture([`Pi CU black ${Date.now()}`, "black"]);
  await command("cover");
  const beforeWgc = JSON.parse(await command("oracle"));
  assert.equal(beforeWgc.frameHresult, 0);
  assert.equal(beforeWgc.nativeWindowHandle, handle);
  assert.equal(beforeWgc.processId, fixture.pid);
  assert.equal(beforeWgc.minimized, false);
  const composited = await call();
  assert.equal(composited.method, "wgc", JSON.stringify(composited));
  assert.deepEqual(composited.bounds, beforeWgc.frame);
  assert.deepEqual(composited.origin, {
    x: beforeWgc.frame.x,
    y: beforeWgc.frame.y,
  });
  const afterWgc = JSON.parse(await command("oracle"));
  assert.deepEqual(afterWgc.frame, beforeWgc.frame);
  assert.equal(afterWgc.lastInputTick, beforeWgc.lastInputTick);
  assert.equal(afterWgc.foregroundHandle, beforeWgc.foregroundHandle);
  if (lifetimeOnly) {
    const boundWgc = await call({ windowRef: composited.windowRef });
    assert.equal(boundWgc.windowRef, composited.windowRef);
    assert.equal(boundWgc.method, "wgc");
    assert.equal(
      JSON.stringify(boundWgc).includes("PiComputerUse.Window."),
      false,
    );
  }
  assert.deepEqual(
    centerPixel,
    [0, 0, 0],
    "WGC captures the black target behind the magenta cover",
  );
  if (!lifetimeOnly) {
    await command("minimize");
    const minimized = await call();
    assert.equal(minimized.windowCaptureFailed, true);
    assert.equal(minimized.method, "screen");
    assert.match(minimized.captureWarnings.join(" "), /WINDOW_CAPTURE_FAILED/);
  }
  const wrong = await tool.execute(
    "wrong-owner",
    { nativeWindowHandle: handle, processId: fixture.pid + 100000 },
    undefined,
    undefined,
    {},
  );
  assert.equal(wrong.isError, true);
  assert.match(JSON.stringify(wrong.details), /WINDOW_IDENTITY_CHANGED/);
  console.log(
    JSON.stringify({
      ok: true,
      check: "native fixture screenshot",
      normal: normal.method,
      covered: covered.method,
      composited: composited.method,
      minimizedFallback: !lifetimeOnly,
      lifetimeOnly,
      boundWgc: lifetimeOnly,
      pixels: true,
      pngDimensions: true,
      coordinateMapping: true,
      wrongOwner: true,
      physicalInput: false,
    }),
  );
}

async function verifyDisplay() {
  const layout = JSON.parse(await command("layout")),
    samples = [];
  assert.ok(layout.length > 0);
  const health = async () =>
    (
      await host.tools
        .get("windows_computer_use_health")
        .execute("display-health", {}, undefined, undefined, {})
    ).details;
  for (let index = 0; index < layout.length; index++) {
    const monitor = layout[index],
      b = monitor.bounds;
    const placement = controlCapture
      ? `owned-region:${b.x}:${b.y}`
      : `place:${b.x + Math.floor((b.width - 320) / 2)}:${b.y + Math.floor((b.height - 200) / 2)}`;
    const before = JSON.parse(await command(placement));
    assert.equal(before.awareness, 2);
    assert.equal(before.windowDpi, monitor.dpiX);
    let controlling;
    if (controlCapture) {
      const activated = (
        await host.tools
          .get("windows_computer_use_activate_window")
          .execute(
            "owned-display-activate",
            { nativeWindowHandle: handle, processId: fixture.pid },
            undefined,
            undefined,
            {},
          )
      ).details;
      assert.equal(activated.activated, true, JSON.stringify(activated));
      if (index === 0) {
        const refused = (
          await host.tools
            .get("windows_computer_use_click")
            .execute(
              "no-dispatch-acquisition",
              { nativeWindowHandle: 1, processId: 1, x: 0, y: 0 },
              undefined,
              undefined,
              {},
            )
        ).details;
        assert.equal(refused.ok, false);
        assert.match(refused.error, /TARGET_IDENTITY_CHANGED/);
        assert.equal(refused.cleanupConfirmed, true);
      }
      controlling = (await health()).control;
      assert.equal(controlling.exclusiveControl, true);
      assert.equal(controlling.presentation.visible, true);
    }
    for (const maxWidth of [0, 80]) {
      const baseline = controlCapture
        ? JSON.parse(
            await command("sample-screen:" + controlling.listenerProcessId),
          )
        : undefined;
      if (baseline)
        assert.ok(
          baseline.some((p) => p.rgb[2] > 85),
          JSON.stringify({
            message:
              "live border must visibly alter an owned green edge pixel before capture",
            index,
            maxWidth,
            baseline,
            controlling,
            before,
          }),
        );
      const screenshot = await call({ maxWidth });
      assert.deepEqual(screenshot.bounds, before.frame);
      assert.deepEqual(screenshot.origin, {
        x: before.frame.x,
        y: before.frame.y,
      });
      assert.ok(
        Math.abs(
          screenshot.imageScale - screenshot.width / before.frame.width,
        ) < 1e-10,
      );
      assert.ok(
        Math.abs(
          screenshot.imageScaleY - screenshot.height / before.frame.height,
        ) < 1e-10,
      );
      assert.ok(
        Math.abs(
          screenshot.height -
            (before.frame.height * screenshot.width) / before.frame.width,
        ) <= 0.5,
      );
      const points = controlCapture ? baseline : before.points;
      const pixels = points.map((p) => {
        const x = Math.floor(
            (p.x - screenshot.origin.x) * screenshot.imageScale,
          ),
          y = Math.floor((p.y - screenshot.origin.y) * screenshot.imageScaleY);
        const rgb = pngCenter(lastPng, x, y),
          expected = controlCapture ? [20, 150, 80] : p.rgb;
        assert.ok(
          rgb.every((c, i) => Math.abs(c - expected[i]) <= 2),
          JSON.stringify({ point: p, image: { x, y }, rgb, expected }),
        );
        return { screen: { x: p.x, y: p.y }, image: { x, y }, rgb, expected };
      });
      const after = JSON.parse(await command("oracle"));
      assert.deepEqual(after.frame, before.frame);
      if (!controlCapture) {
        assert.equal(after.foregroundHandle, before.foregroundHandle);
      }
      assert.equal(after.nativeWindowHandle, handle);
      assert.equal(after.processId, fixture.pid);
      let controlAfter;
      if (controlCapture) {
        assert.ok(["printwindow", "wgc"].includes(screenshot.method));
        assert.equal(screenshot.occludedPossible, false);
        controlAfter = (await health()).control;
        assert.equal(
          controlAfter.listenerProcessId,
          controlling.listenerProcessId,
        );
        assert.equal(controlAfter.operationId, controlling.operationId);
        assert.equal(controlAfter.exclusiveControl, true);
        assert.equal(controlAfter.armed, true);
        assert.equal(controlAfter.cancelEventSet, false);
        assert.equal(controlAfter.presentation.suspended, false);
        assert.ok(
          controlAfter.presentation.captureSuspensions >
            controlling.presentation.captureSuspensions,
        );
        const restored = JSON.parse(
          await command("sample-screen:" + controlling.listenerProcessId),
        );
        assert.ok(restored.some((p) => p.rgb[2] > 85));
      }
      samples.push({
        index,
        monitor,
        before,
        after,
        inputActivityChanged: after.lastInputTick !== before.lastInputTick,
        screenshot,
        pixels,
        liveBorderPixels: baseline,
        captureSuspensions: controlAfter?.presentation.captureSuspensions,
      });
      if (controlCapture) controlling = controlAfter;
    }
  }
  if (controlCapture) {
    await host.emit("agent_settled", { aborted: false });
    const released = (await health()).control;
    assert.equal(released.exclusiveControl, false);
    assert.equal(released.presentation.visible, false);
  }
  assert.deepEqual(
    JSON.parse(await command("layout")),
    layout,
    "display settings must remain unchanged",
  );
  console.log(
    JSON.stringify({
      ok: true,
      check: controlCapture
        ? "owned pixels exclude held control border"
        : "Pi display fixture geometry",
      layout,
      samples,
      physicalInput: false,
      globalDisplayChanges: false,
      actualScales: [...new Set(layout.map((x) => x.dpiX / 96))],
      unverifiedScales: [1.5, 2].filter(
        (scale) => !layout.some((x) => x.dpiX / 96 === scale),
      ),
    }),
  );
}
