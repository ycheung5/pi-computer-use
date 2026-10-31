// Windows-only read-only screenshots against a dedicated passive fixture.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import computerUse from "../dist/extension.js";
import { computerUseHost } from "./native-host.mjs";

assert.equal(process.platform, "win32");
const lifetimeOnly = process.argv.includes("--lifetime-only");
const folder = await mkdtemp(join(tmpdir(), "pi-cu-capture-fixture-"));
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
  { encoding: "utf8", windowsHide: true, cwd: folder },
);
assert.equal(built.status, 0, built.stdout + built.stderr);
let fixture = spawn(executable, [`Pi CU Capture ${Date.now()}`], {
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
  cwd: folder,
});
const [ready] = await once(fixture.stdout, "data");
let handle = Number(ready.toString().trim());
const host = computerUseHost();
computerUse(host.api);
const tool = host.tools.get("windows_computer_use_screenshot");
assert.ok(tool, "Pi registers screenshot capability");
let centerPixel;
function pngCenter(png) {
  const width = png.readUInt32BE(16),
    height = png.readUInt32BE(20),
    channels = png[25] === 6 ? 4 : 3;
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
  for (let y = 0; y <= Math.floor(height / 2); y++) {
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
  return Array.from(
    previous.subarray(
      Math.floor(width / 2) * channels,
      Math.floor(width / 2) * channels + 3,
    ),
  );
}
const call = async (extra = {}) => {
  const result = await tool.execute(
    `capture-${Date.now()}`,
    {
      nativeWindowHandle: handle,
      processId: fixture.pid,
      maxWidth: 80,
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
  centerPixel = pngCenter(png);
  assert.equal(png.subarray(1, 4).toString(), "PNG");
  assert.equal(png.readUInt32BE(16), metadata.screenshot.width);
  assert.equal(png.readUInt32BE(20), metadata.screenshot.height);
  assert.equal(metadata.screenshot.width, 80);
  assert.equal(metadata.screenshot.origin.x, metadata.screenshot.bounds.x);
  assert.equal(metadata.screenshot.origin.y, metadata.screenshot.bounds.y);
  assert.ok(
    Math.abs(
      metadata.screenshot.imageScale * metadata.screenshot.bounds.width - 80,
    ) < 0.000001,
  );
  return metadata.screenshot;
};
const command = async (value) => {
  fixture.stdin.write(`${value}\n`);
  await once(fixture.stdout, "data");
};
try {
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
  fixture.stdin.end("stop\n");
  await once(fixture, "close");
  fixture = spawn(executable, [`Pi CU black ${Date.now()}`, "black"], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    cwd: folder,
  });
  const [blackReady] = await once(fixture.stdout, "data");
  handle = Number(blackReady.toString().trim());
  await command("cover");
  const composited = await call();
  assert.equal(composited.method, "wgc", JSON.stringify(composited));
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
} finally {
  fixture.stdin.end("stop\n");
  if (fixture.exitCode === null) await once(fixture, "close");
  for (const shutdown of host.shutdown) await shutdown();
  await rm(folder, { recursive: true, force: true });
}
