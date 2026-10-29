// Background actions only, against dedicated disposable controls. No physical input.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import computerUse from "../dist/extension.js";
import { computerUseHost } from "./native-host.mjs";

assert.equal(process.platform, "win32");
assert.equal(
  process.env.PI_CU_DEDICATED_INPUT_DESKTOP,
  "1",
  "Run only on a dedicated interactive test desktop; read docs/pointer.md first.",
);
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
const host = computerUseHost();
computerUse(host.api);
const call = async (action, args = {}) => {
  const tool = host.tools.get(`windows_computer_use_${action}`);
  assert.ok(tool, `Pi registers ${action}`);
  return (
    await tool.execute(action, { ...target, ...args }, undefined, undefined, {})
  ).details;
};
const find = async (query, controlType) => {
  const result = await call("find", { query, controlType, ocrFallback: false });
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.matches;
};
try {
  const button = (await find("Background action", "Button"))[0];
  const screenPoint = {
    x: Math.round(button.boundingBox.centerX),
    y: Math.round(button.boundingBox.centerY),
  };
  const captured = await call("screenshot", { maxWidth: 260 });
  assert.equal(captured.ok, true, JSON.stringify(captured));
  const capture = captured.screenshot;
  const imagePoint = {
    x: (screenPoint.x - capture.origin.x) * capture.imageScale,
    y: (screenPoint.y - capture.origin.y) * capture.imageScaleY,
  };
  const mapped = {
    x: Math.round(imagePoint.x / capture.imageScale + capture.origin.x),
    y: Math.round(imagePoint.y / capture.imageScaleY + capture.origin.y),
  };
  const clicked = await call("click", { ...mapped, dispatch: "foreground" });
  assert.equal(clicked.ok, true, JSON.stringify(clicked));
  assert.ok(
    (await find("Clicked 1", "Text")).length,
    "physical click reached the intended scaled point",
  );
  const doubled = await call("double_click", {
    elementId: button.id,
    dispatch: "foreground",
  });
  assert.equal(doubled.ok, true, JSON.stringify(doubled));
  const moved = await call("move", { elementId: button.id });
  assert.equal(moved.ok, true, JSON.stringify(moved));
  assert.match(moved.pointer, /requested hover/);
  const panel = (await find("Background scroller", "Pane"))[0];
  const scrolled = await call("scroll", {
    x: Math.round(panel.boundingBox.centerX),
    y: Math.round(panel.boundingBox.centerY),
    deltaY: 240,
  });
  assert.equal(scrolled.ok, true, JSON.stringify(scrolled));
  const surface = (await find("Pointer fixture surface", "Pane"))[0];
  const start = {
    x: Math.round(surface.boundingBox.centerX),
    y: Math.round(surface.boundingBox.centerY),
  };
  const path = Array.from({ length: 1000 }, (_, index) => ({
    x: start.x + (index % 2),
    y: start.y,
  }));
  const controller = new AbortController();
  let watchdog;
  const down = new Promise((resolve, reject) => {
    const receive = (chunk) => {
      if (chunk.toString().includes("pointer-down")) {
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
  const dragged = host.tools
    .get("windows_computer_use_drag")
    .execute(
      "cancel-drag",
      { ...target, path },
      controller.signal,
      undefined,
      {},
    );
  const result = dragged.then(
    () => {
      throw new Error("cancelled drag should reject");
    },
    (error) => assert.match(String(error), /abort|STOPPED|CANCELLED/i),
  );
  await down;
  await result;
  await host.emit("before_agent_start", { messageType: "user" });
  assert.ok(
    (await find("Released 1", "Text")).length,
    "button was released on cancellation",
  );
  console.log(
    JSON.stringify({
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
  for (const handler of host.shutdown) await handler();
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
