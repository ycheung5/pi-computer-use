// Passive provider fixture: no activation, screenshots, mouse or keyboard input.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { WorkerClient } from "../dist/client.js";

assert.equal(process.platform, "win32");
const folder = await mkdtemp(join(tmpdir(), "pi-null-uia-"));
const framework = join(
  process.env.WINDIR,
  "Microsoft.NET",
  "Framework64",
  "v4.0.30319",
);
const exe = join(folder, "fixture.exe");
const refs = [
  "UIAutomationClient.dll",
  "UIAutomationProvider.dll",
  "UIAutomationTypes.dll",
  "WindowsBase.dll",
].map((name) => `/r:${join(framework, "WPF", name)}`);
const built = spawnSync(
  join(framework, "csc.exe"),
  [
    "/nologo",
    `/out:${exe}`,
    "/r:System.Windows.Forms.dll",
    ...refs,
    fileURLToPath(new URL("./nullable-uia-fixture.cs", import.meta.url)),
  ],
  { encoding: "utf8", cwd: folder, windowsHide: true },
);
assert.equal(built.status, 0, built.stdout + built.stderr);
const fixture = spawn(exe, [], {
  stdio: ["pipe", "pipe", "pipe"],
  cwd: folder,
  windowsHide: true,
});
const fixtureClosed = new Promise((resolve) => fixture.once("close", resolve));
const lines = createInterface({ input: fixture.stdout });
const hwnd = await new Promise((resolve, reject) => {
  const timer = setTimeout(
    () => reject(Error("fixture startup timeout")),
    10000,
  );
  lines.once("line", (line) => {
    clearTimeout(timer);
    resolve(Number(line));
  });
  fixture.once("error", reject);
});
process.env.PI_CU_SETTINGS_FILE = join(folder, "settings.json");
const client = new WorkerClient({
  launch: async () => ({
    executable: process.execPath,
    args: [fileURLToPath(new URL("../dist/worker.js", import.meta.url))],
    cwd: folder,
  }),
});
const targetArgs = () => ({ nativeWindowHandle: hwnd, processId: fixture.pid });
try {
  const r = await client.execute("snapshot", {
    nativeWindowHandle: hwnd,
    processId: fixture.pid,
    includeScreenshot: false,
    activate: false,
  });
  console.log(
    JSON.stringify({
      ok: r.ok,
      nodes: r.nodeCount,
      tree: r.tree != null,
      error: r.error,
    }),
  );
  assert.equal(
    r.ok,
    true,
    "a newer/unknown control type must not discard the tree",
  );
  assert.ok(r.tree);
  const text = JSON.stringify(r.tree);
  assert.match(text, /Before custom provider/);
  assert.match(text, /After custom provider/);
  assert.match(text, /Newer UIA control/);
  const visit = (node) =>
    node.name === "Newer UIA control"
      ? node
      : (node.children ?? []).map(visit).find(Boolean);
  assert.equal(visit(r.tree)?.controlType, "Unknown");
  assert.equal(
    r.conclusive,
    false,
    "unknown role metadata must not prove absence",
  );
  const unknown = visit(r.tree);
  const inspected = await client.execute("element_info", {
    nativeWindowHandle: hwnd,
    processId: fixture.pid,
    elementId: unknown.id,
    detailLevel: "full",
  });
  assert.equal(inspected.ok, true, "unknown metadata is not a stale element");
  assert.equal(inspected.element.controlType, "Unknown");
  assert.equal(inspected.conclusive, false);
  const found = await client.execute("find", {
    nativeWindowHandle: hwnd,
    processId: fixture.pid,
    query: "After custom provider",
    ocrFallback: false,
  });
  assert.equal(found.ok, true);
  assert.ok(
    found.matches.some((node) => node.name === "After custom provider"),
    "traversal continues after unknown role",
  );
  const flatten = (node) =>
    node ? [node, ...(node.children ?? []).flatMap(flatten)] : [];
  for (const viewMode of ["control", "raw", "content"]) {
    const included = await client.execute("snapshot", {
      ...targetArgs(),
      includeScreenshot: false,
      activate: false,
      viewMode,
      includeOffscreen: true,
    });
    const ancestor = flatten(included.tree).find(
      (node) => node.name === "Offscreen ancestor",
    );
    const visible = flatten(ancestor).find(
      (node) => node.name === "Visible descendant",
    );
    assert.equal(ancestor?.isOffscreen, true, "fixture ancestor is offscreen");
    assert.equal(visible?.isOffscreen, false, "fixture descendant is visible");
    const visibleOnly = await client.execute("snapshot", {
      ...targetArgs(),
      includeScreenshot: false,
      activate: false,
      viewMode,
      includeOffscreen: false,
    });
    assert.ok(
      flatten(visibleOnly.tree).some(
        (node) => node.name === "Visible descendant",
      ),
      `${viewMode} promotes visible descendants through filtered ancestors`,
    );
    assert.equal(
      flatten(visibleOnly.tree).some(
        (node) => node.name === "Offscreen ancestor",
      ),
      false,
    );
    const located = await client.execute("find", {
      ...targetArgs(),
      query: "Visible descendant",
      ocrFallback: false,
      activate: false,
      viewMode,
      includeOffscreen: false,
    });
    assert.equal(located.matches.length, 1, "visible descendant can be found");
  }
  const absent = await client.execute("wait_for", {
    nativeWindowHandle: hwnd,
    processId: fixture.pid,
    condition: "element",
    query: "Definitely absent",
    appear: false,
    timeoutMs: 300,
    intervalMs: 50,
  });
  assert.equal(
    absent.ok,
    false,
    "incomplete role metadata must not prove disappearance",
  );
  assert.equal(absent.verification, "inconclusive");
  if (process.argv.includes("--quiet-scroll")) {
    await client.execute("operation_end", {});
    const observe = (prefix) =>
      new Promise((resolve, reject) => {
        const receive = (line) => {
          if (line.startsWith(prefix)) {
            clearTimeout(timer);
            lines.removeListener("line", receive);
            resolve(line);
          }
        };
        const timer = setTimeout(() => {
          lines.removeListener("line", receive);
          reject(new Error(`fixture did not report ${prefix}`));
        }, 10000);
        lines.on("line", receive);
      });
    const command = (text, prefix = text) => {
      const reply = observe(prefix);
      fixture.stdin.write(`${text}\n`);
      return reply;
    };
    const operation = "owned-quiet-scroll";
    // Observe the normal quiet path before testing interruption; no native wheel
    // fallback is available on this owned provider, which exposes ScrollPattern.
    const normal = await client.execute(
      "scroll",
      { ...targetArgs(), elementId: unknown.id, deltaY: 240 },
      undefined,
      operation,
    );
    assert.equal(normal.ok, true, JSON.stringify(normal));
    assert.equal(normal.method, "uia_scroll");
    assert.equal(normal.cleanupConfirmed, true);
    const health = await client.execute("health", {}, undefined, operation);
    assert.equal(
      health.control.presentation.visible,
      false,
      "quiet dispatch does not announce physical control",
    );
    const initial = await command("scroll-state");
    const initialCalls = Number(initial.split(":")[1]);
    await command("scroll-hold", "scroll:armed");
    const entered = observe("scroll:entered:");
    const controller = new AbortController();
    const pending = client.execute(
      "scroll",
      { ...targetArgs(), elementId: unknown.id, deltaY: 240 },
      controller.signal,
      operation,
    );
    const cancelled = assert.rejects(
      pending,
      /CANCELLED|owned scroll cancellation/,
    );
    await entered;
    const held = await command("scroll-state");
    assert.equal(held, `scroll-state:${initialCalls + 1}:${initialCalls}`);
    controller.abort(new Error("owned scroll cancellation"));
    await cancelled;
    const competitor = new WorkerClient({
      launch: async () => ({
        executable: process.execPath,
        args: [fileURLToPath(new URL("../dist/worker.js", import.meta.url))],
        cwd: folder,
      }),
    });
    try {
      const busy = await competitor.execute(
        "list_windows",
        { maxWindows: 1 },
        undefined,
        "competing-quiet-scroll",
      );
      assert.equal(busy.ok, false, JSON.stringify(busy));
      assert.match(busy.error, /COMPUTER_USE_BUSY/);
      assert.equal(
        await command("scroll-state"),
        held,
        "no subsequent call or settled effect while first provider call is held",
      );
      const settled = observe("scroll:settled");
      await command("scroll-release", "scroll:release-ack");
      await settled;
      const ended = await client.execute(
        "operation_end",
        {},
        undefined,
        operation,
      );
      assert.equal(ended.ok, true, JSON.stringify(ended));
      assert.equal(
        await command("scroll-state"),
        `scroll-state:${initialCalls + 1}:${initialCalls + 1}`,
        "only the already-dispatched call may take effect; later steps never run",
      );
      const recovered = await competitor.execute(
        "list_windows",
        { maxWindows: 1 },
        undefined,
        "competing-quiet-scroll",
      );
      assert.equal(recovered.ok, true, JSON.stringify(recovered));
      await competitor.execute(
        "operation_end",
        {},
        undefined,
        "competing-quiet-scroll",
      );
      console.log(
        JSON.stringify({
          ok: true,
          check: "quiet ScrollPattern cancellation",
          normalCalls: initialCalls,
          quietPresentation: true,
          inFlightEffect: 1,
          subsequentCalls: 0,
          ownershipRetainedUntilSettlement: true,
          physicalInput: false,
        }),
      );
    } finally {
      await competitor.dispose();
    }
  }
  console.log(
    JSON.stringify({
      ok: true,
      check: "nullable UIA metadata",
      inspection: true,
      continuedTraversal: true,
      absenceInconclusive: true,
      visibleDescendantPromotion: true,
      physicalInput: false,
    }),
  );
} finally {
  fixture.stdin.write("scroll-release\n");
  await client.dispose();
  fixture.stdin.end("\n");
  if (fixture.exitCode === null) fixture.kill();
  await fixtureClosed;
  lines.close();
  await rm(folder, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}
