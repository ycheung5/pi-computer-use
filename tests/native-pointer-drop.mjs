// Dedicated Windows desktop only. Both engines act through their public interfaces.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateGeometry } from "./pointer-drop-geometry.mjs";
import { assessDrop } from "./pointer-drop-report.mjs";

// Readiness is bounded and includes startup failures in the owned cleanup scope.
function fixtureReady(peer) {
  return new Promise((resolve, reject) => {
    let buffer = "",
      diagnostic = "";
    const onError = (error) => finish(error);
    const onExit = (code) =>
      finish(
        Error(`drop fixture exited before readiness (${code}): ${diagnostic}`),
      );
    const onStderr = (chunk) => {
      diagnostic = (diagnostic + chunk.toString()).slice(-4096);
    };
    const onData = (chunk) => {
      buffer += chunk.toString();
      if (!buffer.includes("\n")) return;
      const handle = Number(buffer.trim());
      finish(
        Number.isSafeInteger(handle) && handle > 0
          ? null
          : Error("invalid fixture window handle"),
        handle,
      );
    };
    const timeout = setTimeout(
      () => finish(Error(`drop fixture readiness timed out: ${diagnostic}`)),
      10000,
    );
    function finish(error, handle) {
      clearTimeout(timeout);
      peer.off("error", onError);
      peer.off("exit", onExit);
      peer.stdout.off("data", onData);
      peer.stderr.off("data", onStderr);
      error ? reject(error) : resolve(handle);
    }
    peer.on("error", onError);
    peer.on("exit", onExit);
    peer.stdout.on("data", onData);
    peer.stderr.on("data", onStderr);
  });
}

export async function runDragDrop({
  engine,
  referencePath,
  discoveryOnly = false,
  crossApp = false,
}) {
  const folder = await mkdtemp(join(tmpdir(), "pi-cu-drop-"));
  process.env.PI_CU_SETTINGS_FILE = join(folder, "settings.json");
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
      fileURLToPath(new URL("./pointer-drop-fixture.cs", import.meta.url)),
    ],
    { encoding: "utf8", cwd: folder, windowsHide: true },
  );
  assert.equal(built.status, 0, built.stdout + built.stderr);
  const fixture = spawn(
    executable,
    [`Pi CU Drop ${Date.now()}`, ...(crossApp ? ["--source"] : [])],
    {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: folder,
    },
  );
  let target;
  let receiver;
  let host, client, execute;
  let inputStarted = false,
    released = false;
  const observe = (peer = fixture) =>
    new Promise((resolve, reject) => {
      let buffer = "";
      const writeError = (error) => finish(error);
      const timeout = setTimeout(
        () => finish(new Error("drop oracle timed out")),
        5000,
      );
      const receive = (chunk) => {
        buffer += chunk.toString();
        const match = buffer.match(
          /state:(\d+):(\d+):(-?\d+):(\d+):(\d+)\r?\n/,
        );
        if (match)
          finish(null, {
            drops: Number(match[1]),
            held: Number(match[2]),
            foreground: Number(match[3]),
            heldActivation: Number(match[4]),
            heldAtEntry: Number(match[5]),
          });
      };
      function finish(error, state) {
        clearTimeout(timeout);
        peer.stdout.off("data", receive);
        peer.stdin.off("error", writeError);
        error ? reject(error) : resolve(state);
      }
      peer.stdout.on("data", receive);
      peer.stdin.on("error", writeError);
      peer.stdin.write("observe\n");
    });
  const geometry = (peer = fixture) =>
    new Promise((resolve, reject) => {
      let buffer = "";
      const writeError = (error) => finish(error);
      const timeout = setTimeout(
        () => finish(new Error("geometry oracle timed out")),
        5000,
      );
      const receive = (chunk) => {
        buffer += chunk.toString();
        const match = buffer.match(/geometry:([-\d:]+)\r?\n/);
        if (!match) return;
        const [
          nativeWindowHandle,
          processId,
          visible,
          osVisible,
          sx,
          sy,
          sw,
          sh,
          dx,
          dy,
          dw,
          dh,
        ] = match[1].split(":").map(Number);
        finish(null, {
          nativeWindowHandle,
          processId,
          visible: visible === 1,
          osVisible: osVisible === 1,
          source: { x: sx, y: sy, width: sw, height: sh },
          destination: { x: dx, y: dy, width: dw, height: dh },
        });
      };
      function finish(error, value) {
        clearTimeout(timeout);
        peer.stdout.off("data", receive);
        peer.stdin.off("error", writeError);
        error ? reject(error) : resolve(value);
      }
      peer.stdout.on("data", receive);
      peer.stdin.on("error", writeError);
      peer.stdin.write("geometry\n");
    });
  try {
    target = {
      nativeWindowHandle: await fixtureReady(fixture),
      processId: fixture.pid,
    };
    if (crossApp) {
      receiver = spawn(
        executable,
        [`Pi CU Drop receiver ${Date.now()}`, "--receiver"],
        {
          stdio: ["pipe", "pipe", "pipe"],
          cwd: folder,
        },
      );
      receiver.target = {
        nativeWindowHandle: await fixtureReady(receiver),
        processId: receiver.pid,
      };
      assert.notEqual(
        receiver.pid,
        fixture.pid,
        "cross-app destination must have another PID",
      );
    }
    if (engine === "pi") {
      const [{ default: computerUse }, { computerUseHost }] = await Promise.all(
        [import("../dist/extension.js"), import("./native-host.mjs")],
      );
      host = computerUseHost();
      computerUse(host.api);
      execute = async (action, args) =>
        (
          await host.tools
            .get(`windows_computer_use_${action}`)
            .execute(action, args, undefined, undefined, {})
        ).details;
    } else {
      const { createComparisonClient } = await import(
        "./comparison-client.mjs"
      );
      client = await createComparisonClient({
        engine,
        referencePath,
        cwd: folder,
      });
      execute = (action, args) => client.execute(action, args);
    }
    const call = async (action, args = {}) => {
      const result = await execute(action, { ...target, ...args });
      console.log(JSON.stringify({ engine, action, result }));
      return result;
    };
    const initial = await observe();
    assert.equal(initial.drops, 0);
    assert.equal(initial.held, 0, "fresh fixture and released button required");
    if (receiver) {
      const state = await observe(receiver);
      assert.equal(state.drops, 0);
      assert.equal(state.held, 0);
      assert.equal(state.heldActivation, 0);
    }
    if (discoveryOnly) {
      await call("accessibility_tree", {
        viewMode: "raw",
        detailLevel: "full",
        activate: false,
      });
      for (const query of ["Drop source", "Drop target"]) {
        await call("find", { query, ocrFallback: false, activate: false });
      }
    }
    // The provider root is an independent observation; control geometry is
    // read from the fixture immediately before dispatch, never inferred from UIA.
    const root = await call("accessibility_tree", {
      maxDepth: 0,
      maxNodes: 1,
      activate: false,
    });
    const ownedGeometry = await geometry();
    const sourcePoints = validateGeometry(target, root, ownedGeometry);
    const start = sourcePoints.start;
    let end = sourcePoints.end;
    if (receiver) {
      const peerRoot = await call("accessibility_tree", {
        ...receiver.target,
        maxDepth: 0,
        maxNodes: 1,
        activate: false,
      });
      const peerGeometry = await geometry(receiver);
      end = validateGeometry(receiver.target, peerRoot, peerGeometry).end;
      console.log(
        JSON.stringify({
          check: "cross-app-destination",
          target: receiver.target,
          geometry: peerGeometry,
          root: peerRoot,
        }),
      );
    }
    console.log(
      JSON.stringify({
        engine,
        check: "owned-drop-geometry",
        target,
        root,
        geometry: ownedGeometry,
        start,
        end,
        inputDispatched: false,
      }),
    );
    if (discoveryOnly) return;
    const steps = crossApp ? 40 : 20;
    const path = Array.from({ length: steps + 1 }, (_, i) => ({
      x: Math.round(start.x + ((end.x - start.x) * i) / steps),
      y: Math.round(start.y + ((end.y - start.y) * i) / steps),
    }));
    inputStarted = true;
    let dispatch;
    try {
      dispatch = {
        status: "fulfilled",
        value: await call("drag", {
          path,
          ...(crossApp ? { activate: true } : {}),
        }),
      };
    } catch (error) {
      dispatch = {
        status: "rejected",
        error: { name: error.name, message: String(error.message) },
      };
    }
    let state, observationError;
    try {
      for (let i = 0; i < 50; i++) {
        state = await observe(receiver ?? fixture);
        if (state.held === 0 && state.drops === 1) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    } catch (error) {
      observationError = String(error.message);
    }
    const report = assessDrop({ dispatch, state, observationError });
    released = report.cleanupVerification === "released";
    // Cleanup is assessed separately; an incorrect foreground is a task failure.
    const foregroundCorrect =
      !receiver ||
      (state?.foreground === receiver.target.nativeWindowHandle &&
        state.heldActivation > 0);
    let sourceUnchanged = !receiver,
      sourceObservationError;
    if (receiver)
      try {
        sourceUnchanged = (await observe()).drops === 0;
      } catch (error) {
        sourceObservationError = String(error.message);
      }
    console.log(
      JSON.stringify({
        engine,
        check: crossApp ? "cross-app-drag-drop" : "successful-drag-drop",
        ok: report.ok && foregroundCorrect && sourceUnchanged,
        foregroundCorrect,
        sourceUnchanged,
        sourceObservationError,
        dispatch,
        state,
        observationError,
        cleanupVerification: report.cleanupVerification,
      }),
    );
    assert.ok(
      report.ok && foregroundCorrect && sourceUnchanged,
      "drag/drop, foreground or independent cleanup was not confirmed",
    );
  } finally {
    if (inputStarted && !released) {
      console.error(
        "Input cleanup unconfirmed: retaining the engine and fixture; stop dependent tests and investigate before terminating the input owner.",
      );
      const { retainPointerOwner } = await import("./pointer-input-safety.mjs");
      await retainPointerOwner();
    }
    for (const handler of host?.shutdown ?? []) await handler();
    await client?.dispose();
    for (const peer of [receiver, fixture].filter(Boolean)) {
      if (peer.pid && peer.exitCode === null) {
        const closed = once(peer, "close");
        const timeout = setTimeout(() => peer.kill(), 3000);
        peer.stdin.once("error", () => {});
        peer.stdin.end("stop\n");
        try {
          await closed;
        } finally {
          clearTimeout(timeout);
        }
      }
    }
    await rm(folder, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  }
}
