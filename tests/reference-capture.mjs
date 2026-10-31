// Paired passive capture/OCR evidence. No physical input, clipboard or daily profiles.
import assert from "node:assert/strict";
import { execFile, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { release, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { inflateSync } from "node:zlib";

function assertMonitorFrame(seen, engine) {
  const frame = seen.oracle.frame;
  assert.ok(
    frame &&
      [frame.x, frame.y, frame.width, frame.height].every(
        Number.isSafeInteger,
      ) &&
      frame.width > 0 &&
      frame.height > 0,
    "Physical DWM extended frame unavailable",
  );
  assert.ok(["pi", "reference"].includes(engine));
  assert.equal(
    seen.method,
    "printwindow",
    "Focused fixture expects PrintWindow, not an alternate capture path",
  );
  assert.deepEqual(
    seen.bounds,
    frame,
    "Capture bounds must equal independently measured DWM frame",
  );
  assert.deepEqual(
    seen.origin,
    { x: frame.x, y: frame.y },
    "Capture origin must equal independently measured DWM frame",
  );
  assert.equal(
    seen.width,
    seen.maxWidth === 0 ? frame.width : Math.min(seen.maxWidth, frame.width),
  );
  assert.ok(
    Math.abs(seen.height - (frame.height * seen.width) / frame.width) <= 0.5,
    "PNG height must preserve the independently measured frame aspect ratio",
  );
  assert.ok(
    Math.abs(seen.scale - seen.width / frame.width) <=
      (engine === "reference" ? 0.00005 + 1e-10 : 1e-10),
    "Image X scale must match PNG/frame dimensions within pinned DSH four-decimal precision",
  );
  if (engine === "pi")
    assert.ok(
      Math.abs(seen.scaleY - seen.height / frame.height) < 1e-10,
      "Pi Y scale must match actual PNG/frame dimensions",
    );
  else {
    assert.equal(
      seen.scaleY,
      seen.scale,
      "Pinned DSH reports one uniform image scale",
    );
    assert.ok(
      Math.abs(seen.scaleY * frame.height - seen.height) <=
        0.5 + frame.height * 0.00005 + 1e-10,
      "DSH uniform Y scale permits half an output pixel of resized-height rounding plus four-decimal scale precision",
    );
  }
}
const monitorReport = process.argv.find((arg) =>
  arg.startsWith("--verify-monitor-report="),
);
if (monitorReport) {
  const report = JSON.parse(
    await readFile(
      monitorReport.slice("--verify-monitor-report=".length),
      "utf8",
    ),
  );
  assert.ok(Array.isArray(report.cases) && report.cases.length > 0);
  for (const row of report.cases) {
    assert.ok(
      ["pass", "fail"].includes(row.status),
      "Blocked prerequisites are not recorded captures",
    );
    assert.ok(row.scenario.startsWith("monitor-"));
    assertMonitorFrame(row.observation, row.engine);
  }
  console.log(
    JSON.stringify({
      ok: true,
      scope:
        "Independent frame/scale assertions only; original collection outcomes preserved",
      verified: report.cases.length,
      collectionFailures: report.cases.filter((row) => row.status === "fail")
        .length,
      checks: report.cases.map((row) => ({
        engine: row.engine,
        scenario: row.scenario,
        originalStatus: row.status,
        ...(row.error ? { originalError: row.error } : {}),
        frameVerified: true,
      })),
    }),
  );
  process.exit(0);
}

const selectedScenario = process.argv.includes("--scenario")
  ? process.argv[process.argv.indexOf("--scenario") + 1]
  : undefined;
const selectedEngine = process.argv.includes("--engine")
  ? process.argv[process.argv.indexOf("--engine") + 1]
  : undefined;
if (
  selectedScenario === "monitor-placements" &&
  process.argv.includes("--plan")
) {
  console.log(
    JSON.stringify({
      executed: false,
      physicalInput: false,
      ocr: false,
      globalDisplayChanges: false,
      placements: ["primary", "negative-x", "boundary"],
      maxWidths: [0, 80],
      engines: ["reference", "pi"],
    }),
  );
  process.exit(0);
}
const [
  { WorkerClient },
  { nativeWorkerLaunch },
  { ReferenceClient, referenceResult },
] = await Promise.all([
  import("../dist/client.js"),
  import("../dist/launcher.js"),
  import("./reference-client.mjs"),
]);

assert.ok(process.argv[2], "Pass the pinned reference checkout");
if (process.platform === "linux") {
  const run = promisify(execFile),
    launch = await nativeWorkerLaunch();
  const win = async (p) =>
    (await run("wslpath", ["-w", resolve(p)])).stdout.trim();
  const script = await win(fileURLToPath(import.meta.url)),
    reference = await win(process.argv[2]);
  const output = process.env.PI_CU_RELEASE_OUTPUT
    ? await win(process.env.PI_CU_RELEASE_OUTPUT)
    : undefined;
  const code = `import{pathToFileURL}from'node:url';${output ? `process.env.PI_CU_RELEASE_OUTPUT=${JSON.stringify(output)};` : "delete process.env.PI_CU_RELEASE_OUTPUT;"}process.argv=[process.execPath,${JSON.stringify(script)},${JSON.stringify(reference)},...${JSON.stringify(process.argv.slice(3))}];await import(pathToFileURL(${JSON.stringify(script)}).href);`;
  try {
    const p = run(launch.executable, ["--input-type=module", "-e", code], {
      cwd: launch.cwd,
      timeout: 240000,
      maxBuffer: 8 * 1024 * 1024,
    });
    p.child.stdin.end();
    const r = await p;
    process.stdout.write(r.stdout);
    process.stderr.write(r.stderr);
  } catch (e) {
    process.stdout.write(e.stdout ?? "");
    process.stderr.write(e.stderr ?? String(e));
    process.exitCode = Number.isInteger(e.code) ? e.code : 1;
  }
  process.exit(process.exitCode ?? 0);
}
assert.equal(process.platform, "win32");
const root = fileURLToPath(new URL("../", import.meta.url)),
  reference = resolve(process.argv[2]);
const folder = await mkdtemp(join(tmpdir(), "pi-cu-capture-comparison-"));
process.env.PI_CU_SETTINGS_FILE = join(folder, "settings.json");
const compiler = join(
  process.env.WINDIR,
  "Microsoft.NET",
  "Framework64",
  "v4.0.30319",
  "csc.exe",
);
const cases = [],
  fixtures = [];
const ownedRoots = new Set();
let ref, worker, lastResult, haltReason;
const safeMetadata = (metadata) =>
  JSON.parse(
    JSON.stringify(metadata, (key, value) =>
      ["base64", "data", "path", "image"].includes(key) ? undefined : value,
    ),
  );
function pngCenter(bytes) {
  const width = bytes.readUInt32BE(16),
    height = bytes.readUInt32BE(20),
    channels = bytes[25] === 6 ? 4 : 3;
  assert.equal(bytes.subarray(1, 4).toString(), "PNG");
  assert.equal(bytes[24], 8);
  assert.ok([2, 6].includes(bytes[25]));
  const chunks = [];
  for (let o = 8; o < bytes.length; ) {
    const n = bytes.readUInt32BE(o);
    if (bytes.subarray(o + 4, o + 8).toString() === "IDAT")
      chunks.push(bytes.subarray(o + 8, o + 8 + n));
    o += n + 12;
  }
  const data = inflateSync(Buffer.concat(chunks)),
    stride = width * channels;
  let previous = Buffer.alloc(stride);
  for (let y = 0; y <= Math.floor(height / 2); y++) {
    const row = Buffer.from(
        data.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)),
      ),
      filter = data[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? row[x - channels] : 0,
        up = previous[x],
        corner = x >= channels ? previous[x - channels] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = Math.floor((left + up) / 2);
      else if (filter === 4) {
        const p = left + up - corner,
          a = Math.abs(p - left),
          b = Math.abs(p - up),
          c = Math.abs(p - corner);
        predictor = a <= b && a <= c ? left : b <= c ? up : corner;
      } else assert.equal(filter, 0);
      row[x] = (row[x] + predictor) & 255;
    }
    previous = row;
  }
  return {
    width,
    height,
    center: [
      ...previous.subarray(
        Math.floor(width / 2) * channels,
        Math.floor(width / 2) * channels + 3,
      ),
    ],
  };
}
async function closeChild(child, command = "stop\n") {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const ended = once(child, "close");
  child.stdin.end(command);
  let force, deadline;
  try {
    force = setTimeout(() => child.kill(), 3000);
    await Promise.race([
      ended,
      new Promise((_, reject) => {
        deadline = setTimeout(
          () => reject(new Error("Fixture cleanup unconfirmed")),
          6000,
        );
      }),
    ]);
  } finally {
    clearTimeout(force);
    clearTimeout(deadline);
  }
}
async function fixture(kind = "capture", black = false) {
  const exe = join(folder, `${kind}.exe`);
  const built = spawnSync(
    compiler,
    [
      "/nologo",
      "/target:exe",
      `/out:${exe}`,
      "/r:System.Windows.Forms.dll",
      "/r:System.Drawing.dll",
      join(root, "tests", `${kind}-fixture.cs`),
    ],
    { cwd: folder, encoding: "utf8", windowsHide: true },
  );
  assert.equal(built.status, 0, built.stdout + built.stderr);
  const child = spawn(
    exe,
    [`Pi capture compare ${kind} ${Date.now()}`, ...(black ? ["black"] : [])],
    { cwd: folder, stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
  );
  fixtures.push(child);
  if (selectedScenario === "monitor-placements") ownedRoots.add(child.pid);
  const lines = createInterface({ input: child.stdout });
  const queue = [],
    pending = [];
  let failure;
  lines.on("line", (line) => {
    const wait = pending.shift();
    if (wait) wait.resolve(line);
    else queue.push(line);
  });
  const fail = (error) => {
    failure = error;
    for (const w of pending.splice(0)) w.reject(error);
  };
  child.on("error", fail);
  child.on("close", () => fail(new Error("Fixture exited")));
  const next = () =>
    queue.length
      ? Promise.resolve(queue.shift())
      : failure
        ? Promise.reject(failure)
        : new Promise((resolveLine, reject) => {
            let timer;
            const entry = {
              resolve: (line) => {
                clearTimeout(timer);
                resolveLine(line);
              },
              reject: (e) => {
                clearTimeout(timer);
                reject(e);
              },
            };
            pending.push(entry);
            timer = setTimeout(() => {
              const i = pending.indexOf(entry);
              if (i >= 0) pending.splice(i, 1);
              reject(new Error("Fixture response timeout"));
            }, 10000);
          });
  const handle = Number(await next());
  assert.ok(Number.isSafeInteger(handle) && handle > 0);
  return {
    target: { nativeWindowHandle: handle, processId: child.pid },
    command: async (action) => {
      const response = next();
      child.stdin.write(`${action}\n`);
      return await response;
    },
    close: () => closeChild(child),
  };
}
async function call(engine, action, args) {
  let result;
  if (engine === "reference") {
    const raw = await ref.call(action, args);
    result = {
      metadata: referenceResult(raw),
      image: raw.content?.find((x) => x.type === "image")?.data,
    };
  } else {
    const metadata = await worker.execute(action, args);
    result = { metadata, image: metadata.screenshot?.base64 };
  }
  lastResult = safeMetadata(result.metadata);
  if (
    /CANCELLED|CANCELED|STOPPED|stop requested/i.test(
      JSON.stringify(lastResult),
    )
  )
    throw new Error(`Operation stopped: ${JSON.stringify(lastResult)}`);
  return result;
}
function captureObservation(result) {
  const shot = result.metadata.screenshot;
  assert.ok(shot && result.image, "Expected screenshot image");
  const decoded = pngCenter(Buffer.from(result.image, "base64"));
  return {
    ...decoded,
    bounds: shot.bounds,
    origin: shot.origin ?? { x: shot.bounds.x, y: shot.bounds.y },
    scale: shot.imageScale,
    scaleY: shot.imageScaleY ?? shot.imageScale,
    method: shot.method,
    windowCaptureFailed: shot.windowCaptureFailed === true,
    occludedPossible: shot.occludedPossible === true,
    captureWarnings: shot.captureWarnings ?? [],
  };
}
async function sample(engine, scenario, body) {
  if (
    selectedScenario &&
    selectedScenario !== scenario &&
    !(
      selectedScenario === "monitor-placements" &&
      scenario.startsWith("monitor-")
    )
  )
    return;
  const row = { engine, scenario, status: "fail", cause: "unknown" };
  const start = performance.now();
  lastResult = undefined;
  if (haltReason) {
    cases.push({
      ...row,
      status: "blocked",
      cause: "stopped-or-cleanup",
      error: haltReason,
    });
    return;
  }
  try {
    row.observation = await body();
    row.status = "pass";
    delete row.cause;
  } catch (error) {
    row.error = String(error);
    if (error.observation) row.observation = error.observation;
    if (lastResult) row.result = lastResult;
    if (
      /CANCELLED|CANCELED|STOPPED|stop requested|cleanup unconfirmed/i.test(
        row.error,
      )
    )
      haltReason = row.error;
  }
  row.durationMs = Math.round(performance.now() - start);
  cases.push(row);
}
async function verifyCapture(engine, f, maxWidth, color) {
  const oracle = JSON.parse(await f.command("oracle"));
  const result = await call(engine, "screenshot", {
    ...f.target,
    maxWidth,
    activate: false,
  });
  assert.equal(result.metadata.ok, true, JSON.stringify(result.metadata));
  const seen = captureObservation(result);
  const observation = {
    oracle,
    expectedCenter: color,
    result: safeMetadata(result.metadata),
    ...seen,
    contentVerified: !seen.occludedPossible,
  };
  try {
    assert.equal(seen.windowCaptureFailed, false);
    assert.equal(seen.width, maxWidth || seen.bounds.width);
    assert.ok(Math.abs(seen.scale * seen.bounds.width - seen.width) < 0.05);
    assert.ok(Math.abs(seen.scaleY * seen.bounds.height - seen.height) <= 1);
    assert.ok(
      seen.bounds.x >= oracle.window.x - 1 &&
        seen.bounds.x + seen.bounds.width <=
          oracle.window.x + oracle.window.width + 1,
    );
    const mapped = {
      x: seen.origin.x + seen.width / 2 / seen.scale,
      y: seen.origin.y + seen.height / 2 / seen.scaleY,
    };
    assert.ok(
      mapped.x >= oracle.client.x &&
        mapped.x <= oracle.client.x + oracle.client.width,
    );
    assert.ok(
      mapped.y >= oracle.client.y &&
        mapped.y <= oracle.client.y + oracle.client.height,
    );
    if (seen.occludedPossible) assert.equal(seen.method, "screen-region");
    else assert.deepEqual(seen.center, color);
    observation.mappedCenter = mapped;
  } catch (error) {
    error.observation = observation;
    throw error;
  }
  return observation;
}
async function verifyOcr(engine, f, maxWidth) {
  const oracle = JSON.parse(await f.command("oracle"));
  const result = await call(engine, "ocr", {
    ...f.target,
    maxWidth,
    query: "h e L L o  123",
    activate: false,
    resolveControl: false,
    includeScreenshot: maxWidth > 0,
  });
  const metadata = result.metadata,
    observation = { oracle, ...safeMetadata(metadata) };
  if (metadata.matched?.[0]) {
    const box = metadata.matched[0].boundingBox;
    observation.paintedInkOffset = {
      x: box.x - oracle.ink.x,
      y: box.y - oracle.ink.y,
      width: box.width - oracle.ink.width,
      height: box.height - oracle.ink.height,
    };
  }
  try {
    assert.equal(metadata.ok, true, JSON.stringify(safeMetadata(metadata)));
    assert.match(metadata.text, /HELLO\s*123/i);
    assert.equal(metadata.coordinateSpace, "screen");
    assert.ok(metadata.matched.length > 0 && metadata.matched.length <= 3);
    for (const hit of metadata.matched) {
      assert.equal(hit.source, "ocr");
      assert.equal(hit.control, null);
      assert.equal("id" in hit, false);
      assert.ok(
        hit.boundingBox.x >= oracle.client.x &&
          hit.boundingBox.x + hit.boundingBox.width <=
            oracle.client.x + oracle.client.width + 2,
      );
      assert.ok(
        hit.boundingBox.y >= oracle.client.y &&
          hit.boundingBox.y + hit.boundingBox.height <=
            oracle.client.y + oracle.client.height + 2,
      );
      assert.ok(
        hit.word.x >= hit.boundingBox.x &&
          hit.word.x <= hit.boundingBox.x + hit.boundingBox.width,
      );
      assert.ok(
        hit.word.y >= hit.boundingBox.y &&
          hit.word.y <= hit.boundingBox.y + hit.boundingBox.height,
      );
    }
    if (maxWidth > 0) {
      observation.image = captureObservation(result);
      assert.equal(observation.image.width, maxWidth);
    } else assert.equal(result.image, undefined);
  } catch (error) {
    error.observation = observation;
    throw error;
  }
  return observation;
}
async function monitorPlacements(engine) {
  const f = await fixture();
  try {
    const layout = JSON.parse(await f.command("layout"));
    const primary = layout.find((m) => m.primary),
      left = layout.find(
        (m) =>
          m.bounds.x < 0 && m.bounds.x + m.bounds.width === primary?.bounds.x,
      );
    if (
      !primary ||
      !left ||
      [primary, left].some((m) => m.dpiX !== 96 || m.dpiY !== 96)
    ) {
      cases.push({
        engine,
        scenario: "monitor-prerequisites",
        status: "blocked",
        cause: "environment",
        observation: { layout },
        error:
          "This fixture slice needs adjacent primary and negative-X monitors at96 DPI; other DPI/topology cases remain unexercised",
      });
      return;
    }
    const initial = JSON.parse(await f.command("oracle"));
    if (!initial.frame) {
      cases.push({
        engine,
        scenario: "monitor-frame-prerequisite",
        status: "blocked",
        cause: "fixture-frame-query",
        observation: { layout, initial },
        error: "Physical DWM extended-frame query unavailable",
      });
      return;
    }
    const top = Math.max(primary.workArea.y, left.workArea.y) + 80;
    const placements = [
      ["primary", primary.workArea.x + 80, primary.workArea.y + 80],
      ["negative-x", left.workArea.x + 80, left.workArea.y + 80],
      [
        "boundary",
        primary.bounds.x - Math.floor(initial.window.width / 2),
        top,
      ],
    ];
    for (const [placement, x, y] of placements) {
      const before = JSON.parse(await f.command("oracle"));
      const placed = JSON.parse(await f.command(`place:${x}:${y}`));
      const setup = { layout, placement, requested: { x, y }, before, placed };
      const w = placed.window,
        contains = (monitor) =>
          w.x >= monitor.bounds.x &&
          w.y >= monitor.bounds.y &&
          w.x + w.width <= monitor.bounds.x + monitor.bounds.width &&
          w.y + w.height <= monitor.bounds.y + monitor.bounds.height;
      const visible =
        placement === "boundary"
          ? w.x >= left.bounds.x &&
            w.x + w.width <= primary.bounds.x + primary.bounds.width &&
            w.y >= Math.max(left.bounds.y, primary.bounds.y) &&
            w.y + w.height <=
              Math.min(
                left.bounds.y + left.bounds.height,
                primary.bounds.y + primary.bounds.height,
              )
          : contains(placement === "primary" ? primary : left);
      if (
        !visible ||
        placed.window.width !== before.window.width ||
        placed.window.height !== before.window.height ||
        placed.window.x !== x ||
        placed.window.y !== y ||
        placed.nativeWindowHandle !== f.target.nativeWindowHandle ||
        placed.processId !== f.target.processId ||
        placed.foregroundHandle !== before.foregroundHandle ||
        placed.lastInputTick !== before.lastInputTick
      ) {
        cases.push({
          engine,
          scenario: `monitor-${placement}-placement`,
          status: "blocked",
          cause: "fixture-placement",
          observation: setup,
          error:
            "Owned nonactivating placement or identity not independently confirmed",
        });
        continue;
      }
      for (const maxWidth of [0, 80]) {
        await sample(
          engine,
          `monitor-${placement}-${maxWidth === 0 ? "native" : "scaled"}`,
          async () => {
            let observation = { setup };
            try {
              observation = {
                ...(await verifyCapture(engine, f, maxWidth, [20, 150, 80])),
                setup,
                maxWidth,
              };
              assertMonitorFrame(observation, engine);
              observation.after = JSON.parse(await f.command("oracle"));
              assert.equal(
                observation.occludedPossible,
                false,
                "Unknown screen-region content is not known fixture capture",
              );
              assert.equal(
                observation.after.lastInputTick,
                placed.lastInputTick,
              );
              assert.equal(
                observation.after.foregroundHandle,
                placed.foregroundHandle,
              );
              if (placement === "primary") assert.ok(observation.origin.x >= 0);
              else
                assert.ok(
                  observation.origin.x < 0,
                  "Actual screenshot origin must be negative",
                );
              if (placement === "boundary")
                assert.ok(
                  observation.bounds.x + observation.bounds.width > 0,
                  "Fixture capture spans the real monitor boundary",
                );
              return observation;
            } catch (error) {
              error.observation = { ...observation, ...error.observation };
              throw error;
            }
          },
        );
      }
    }
  } finally {
    await f.close();
  }
}
const artifacts = {};
for (const [name, path] of Object.entries({
  referenceServer: join(reference, "mcp", "server.mjs"),
  referenceBackend: join(reference, "scripts", "windows-uia.ps1"),
  piWorker: join(root, "dist", "worker.js"),
  piCapture: join(root, "dist", "capture.js"),
  piOcr: join(root, "dist", "ocr.js"),
  piNativeCapture: join(root, "assets", "capture.cs"),
  piNativeWgc: join(root, "assets", "wgc.cs"),
  piNativeOcr: join(root, "assets", "ocr.cs"),
  referenceClient: join(root, "tests", "reference-client.mjs"),
  captureFixture: join(root, "tests", "capture-fixture.cs"),
  ocrFixture: join(root, "tests", "ocr-fixture.cs"),
  runner: fileURLToPath(import.meta.url),
}))
  artifacts[name] = createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
let cleanup = { confirmed: false };
try {
  ref = new ReferenceClient(reference, {
    cwd: folder,
    env: { WCU_SETTINGS_JSON: "{}", WCU_TOOL_MODE: "full" },
  });
  await ref.init();
  worker = new WorkerClient({
    launch: async () => ({
      executable: process.execPath,
      args: [join(root, "dist", "worker.js")],
      cwd: folder,
    }),
    timeoutMs: 60000,
  });
  if (selectedScenario === "monitor-placements") {
    ownedRoots.add(ref.child.pid);
    ownedRoots.add(Number((await worker.execute("health", {})).processId));
  }
  for (const engine of ["reference", "pi"].filter(
    (name) => !selectedEngine || name === selectedEngine,
  )) {
    if (haltReason) {
      for (const scenario of [
        "normal-scaled",
        "normal-native",
        "covered",
        "minimized",
        "wrong-owner",
        "closed-target",
        "black-fallback",
        "ocr-native",
        "ocr-scaled",
        "ocr-literal-miss",
        "ocr-clipped",
        "ocr-minimized",
      ])
        await sample(engine, scenario, () => {});
      continue;
    }
    if (selectedScenario === "monitor-placements") {
      await monitorPlacements(engine);
      continue;
    }
    const f = await fixture();
    try {
      for (const [scenario, maxWidth] of [
        ["normal-scaled", 80],
        ["normal-native", 0],
      ])
        await sample(engine, scenario, () =>
          verifyCapture(engine, f, maxWidth, [20, 150, 80]),
        );
      if (!haltReason) await f.command("cover");
      await sample(engine, "covered", () =>
        verifyCapture(engine, f, 80, [20, 150, 80]),
      );
      if (!haltReason) await f.command("minimize");
      await sample(engine, "minimized", async () => {
        const oracle = JSON.parse(await f.command("oracle"));
        assert.equal(oracle.minimized, true);
        const result = await call(engine, "screenshot", {
          ...f.target,
          maxWidth: 80,
          activate: false,
        });
        if (result.metadata.ok === false) {
          assert.ok(result.metadata.error);
          return {
            oracle,
            outcome: "explicit-unavailable",
            error: result.metadata.error,
          };
        }
        const seen = captureObservation(result),
          observation = {
            oracle,
            ...seen,
            expected:
              "known target pixels or explicit unavailable/inconclusive capture",
          };
        try {
          assert.ok(
            seen.windowCaptureFailed ||
              seen.occludedPossible ||
              seen.center.every(
                (value, index) => value === [20, 150, 80][index],
              ),
            "A minimized caption/desktop image must not be presented as verified target content",
          );
        } catch (error) {
          error.observation = observation;
          throw error;
        }
        return observation;
      });
      await sample(engine, "wrong-owner", async () => {
        const result = await call(engine, "screenshot", {
          ...f.target,
          processId: f.target.processId + 100000,
          maxWidth: 80,
          activate: false,
        });
        assert.equal(result.metadata.ok, false);
        assert.match(
          String(result.metadata.error),
          /process|identity|owner|target/i,
        );
        assert.equal(result.image, undefined);
        return result.metadata;
      });
    } finally {
      await f.close();
    }
    await sample(engine, "closed-target", async () => {
      const result = await call(engine, "screenshot", {
        ...f.target,
        maxWidth: 80,
        activate: false,
      });
      assert.equal(result.metadata.ok, false);
      assert.ok(result.metadata.error);
      assert.equal(result.image, undefined);
      return safeMetadata(result.metadata);
    });
    if (!haltReason) {
      const black = await fixture("capture", true);
      try {
        await black.command("cover");
        await sample(engine, "black-fallback", () =>
          verifyCapture(engine, black, 80, [0, 0, 0]),
        );
      } finally {
        await black.close();
      }
    } else await sample(engine, "black-fallback", () => {});
    if (haltReason) {
      for (const scenario of [
        "ocr-native",
        "ocr-scaled",
        "ocr-literal-miss",
        "ocr-clipped",
        "ocr-minimized",
      ])
        await sample(engine, scenario, () => {});
      continue;
    }
    const o = await fixture("ocr");
    try {
      await sample(engine, "ocr-native", () => verifyOcr(engine, o, 0));
      await sample(engine, "ocr-scaled", async () => {
        const seen = await verifyOcr(engine, o, 480);
        const native = cases.find(
          (row) => row.engine === engine && row.scenario === "ocr-native",
        )?.observation?.matched?.[0]?.boundingBox;
        if (native) {
          const scaled = seen.matched[0].boundingBox;
          seen.nativeDelta = { x: scaled.x - native.x, y: scaled.y - native.y };
          assert.ok(
            Math.abs(seen.nativeDelta.x) < 6 &&
              Math.abs(seen.nativeDelta.y) < 6,
          );
        }
        return seen;
      });
      await sample(engine, "ocr-literal-miss", async () => {
        const result = await call(engine, "ocr", {
          ...o.target,
          maxWidth: 480,
          query: "HELLO.*123",
          activate: false,
          resolveControl: false,
        });
        assert.equal(result.metadata.ok, true);
        assert.equal(result.metadata.matched.length, 0);
        assert.notEqual(result.metadata.conclusive, true);
        return safeMetadata(result.metadata);
      });
      if (!haltReason) await o.command("clip");
      await sample(engine, "ocr-clipped", async () => {
        const seen = await verifyOcr(engine, o, 480);
        assert.equal(seen.oracle.client.height, 265);
        seen.clippedRow =
          "Fourth painted row starts at client y251 and is only partly visible; OCR text is retained without assuming exact recognition";
        return seen;
      });
      if (!haltReason) await o.command("minimize");
      await sample(engine, "ocr-minimized", async () => {
        const oracle = JSON.parse(await o.command("oracle"));
        assert.equal(oracle.minimized, true);
        const result = await call(engine, "ocr", {
          ...o.target,
          maxWidth: 480,
          query: "HELLO 123",
          activate: false,
          resolveControl: false,
        });
        if (result.metadata.ok === false) {
          assert.ok(result.metadata.error);
          return { oracle, ...safeMetadata(result.metadata) };
        }
        assert.equal(result.metadata.matched.length, 0);
        assert.notEqual(result.metadata.conclusive, true);
        return { oracle, ...safeMetadata(result.metadata) };
      });
    } finally {
      await o.close();
    }
  }
} catch (error) {
  cases.push({
    engine: "setup",
    scenario: "setup-or-cleanup",
    status: "blocked",
    cause: "environment",
    error: String(error),
  });
} finally {
  const errors = [];
  if (worker)
    try {
      await worker.dispose();
    } catch (e) {
      errors.push(String(e));
    }
  if (ref)
    try {
      await ref.close();
    } catch (e) {
      errors.push(String(e));
    }
  for (const f of fixtures)
    try {
      await closeChild(f);
    } catch (e) {
      errors.push(String(e));
    }
  let processes;
  if (selectedScenario === "monitor-placements") {
    try {
      const ids = Array.from(ownedRoots);
      assert.ok(
        ids.length >= 2 &&
          ids.every((id) => Number.isSafeInteger(id) && id > 0),
        "Owned controller identities unavailable",
      );
      const code = `$ErrorActionPreference='Stop';$rows=@(foreach($identity in @(${ids.join(",")})){try{$p=[Diagnostics.Process]::GetProcessById($identity);@{pid=$identity;absent=$p.HasExited};$p.Dispose()}catch [ArgumentException]{@{pid=$identity;absent=$true}}});ConvertTo-Json -InputObject $rows -Compress`;
      const probe = spawnSync(
        join(
          process.env.WINDIR,
          "System32",
          "WindowsPowerShell",
          "v1.0",
          "powershell.exe",
        ),
        [
          "-NoProfile",
          "-NonInteractive",
          "-EncodedCommand",
          Buffer.from(code, "utf16le").toString("base64"),
        ],
        { encoding: "utf8", windowsHide: true, timeout: 15000 },
      );
      assert.equal(probe.status, 0, probe.stderr);
      processes = JSON.parse(probe.stdout);
      assert.ok(Array.isArray(processes));
      assert.equal(
        processes.length,
        ids.length,
        "Process enumeration must cover every recorded owned root",
      );
      assert.ok(
        processes.every((p) => ids.includes(p.pid) && p.absent === true) &&
          new Set(processes.map((p) => p.pid)).size === ids.length,
        "Recorded owned fixture/controller root still exists; retain artifacts",
      );
    } catch (error) {
      errors.push(String(error));
    }
  }
  if (!errors.length)
    try {
      await rm(folder, { recursive: true, force: true });
    } catch (e) {
      errors.push(String(e));
    }
  cleanup = {
    confirmed: errors.length === 0,
    errors,
    ...(processes ? { processes } : {}),
  };
}
const report = {
  ok:
    cases.length > 0 &&
    cases.every((row) => row.status === "pass") &&
    cleanup.confirmed,
  scope:
    selectedScenario === "monitor-placements"
      ? "Owned same-DPI primary/negative-X/boundary screenshot mapping only"
      : "Owned passive fixture screenshot/OCR comparison only",
  ...(selectedScenario === "monitor-placements"
    ? { unexercised: ["150%", "200%", "mixed-DPI", "changed-primary/topology"] }
    : {}),
  physicalInput: false,
  artifacts,
  versions: {
    node: process.version,
    windows: release(),
    reference: JSON.parse(
      await readFile(join(reference, "package.json"), "utf8"),
    ).version,
    pi: JSON.parse(await readFile(join(root, "package.json"), "utf8")).version,
  },
  cases,
  cleanup,
};
if (process.env.PI_CU_RELEASE_OUTPUT) {
  await mkdir(process.env.PI_CU_RELEASE_OUTPUT, { recursive: true });
  await writeFile(
    join(process.env.PI_CU_RELEASE_OUTPUT, "capture-comparison.json"),
    JSON.stringify(report, null, 2),
  );
}
console.log(JSON.stringify(report));
if (!report.ok) process.exitCode = 1;
