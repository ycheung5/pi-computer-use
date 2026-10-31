import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import {
  createVisualGuard,
  traceWithoutImages,
  visualBeforeHook,
} from "./pi-visual-fixture.mjs";
import {
  effectiveMetadataMatches,
  keepVisualOwnership,
  requested,
} from "./pi-visual-host.mjs";

const owned = { nativeWindowHandle: 11, processId: 22, title: "owned" };
const box = { x: 0, y: 0, width: 600, height: 400 },
  client = { x: 10, y: 30, width: 580, height: 350 };
const input = { nativeWindowHandle: 11, processId: 22, activate: false };
const button = {
  id: "opaque-button",
  name: "",
  controlType: "Button",
  boundingBox: { x: 40, y: 50, width: 200, height: 80 },
};
const tree = {
  ok: true,
  ...owned,
  windowRef: "issued-ref",
  tree: { children: [button] },
};
const image = {
  windowCaptureFailed: false,
  occludedPossible: false,
  method: "printwindow",
  bounds: box,
  origin: { x: 0, y: 0 },
  width: 600,
  height: 400,
  imageScale: 1,
  imageScaleY: 1,
};
const guard = () =>
  createVisualGuard(owned, () => ({
    ok: true,
    ...owned,
    windowBounds: box,
    clientBounds: client,
  }));
const event = (name, args = input, details = {}) => ({
  toolName: "windows_computer_use_" + name,
  input: args,
  details,
  content: [],
});
const observe = (g) => g.after(event("accessibility_tree", input, tree));
const invoke = { elementId: button.id, fallbackClick: false };
let g = guard();
assert.equal(g.before(event("invoke", invoke)).block, true);
observe(g);
assert.equal(g.before(event("invoke", invoke)), undefined);
assert.equal(
  g.before(event("element_info", { elementId: button.id })),
  undefined,
);
for (const args of [
  { ...invoke, fallbackClick: true },
  { ...invoke, activate: true },
  { ...invoke, elementId: "unknown" },
  { ...invoke, processId: 999 },
  { ...invoke, nativeWindowHandle: 999 },
])
  assert.equal(g.before(event("invoke", args)).block, true);
for (const name of [
  "snapshot",
  "accessibility_tree",
  "find",
  "ocr",
  "screenshot",
])
  assert.equal(
    g.before(event(name, { elementId: button.id, captureWindow: true })).block,
    true,
  );
assert.equal(g.before(event("ocr", { windowRef: "issued-ref" })), undefined);
for (const args of [{ windowRef: "invented" }, { ...input, scope: "desktop" }])
  assert.equal(g.before(event("ocr", args)).block, true);
assert.equal(g.before(event("snapshot", input)).block, true);
assert.equal(
  g.before(event("snapshot", { ...input, captureWindow: true })),
  undefined,
);
assert.equal(
  g.before(event("element_info", { ...input, x: 9999, y: 9999 })).block,
  true,
);
const info = { ok: true, action: "element_info", element: button };
assert.equal(
  g.after(event("element_info", { elementId: button.id }, info)).details.element
    .id,
  button.id,
  "genuine element_info lacks top-level root identity",
);

for (const identity of [
  { nativeWindowHandle: 999, processId: 22 },
  { nativeWindowHandle: 11, processId: 999 },
  { nativeWindowHandle: 11 },
  { processId: 22 },
]) {
  g = guard();
  const e = event("accessibility_tree", input, {
    ...tree,
    nativeWindowHandle: undefined,
    processId: undefined,
    ...identity,
  });
  e.content = [{ type: "text", text: "FOREIGN_ROOT_TEXT" }];
  const r = g.after(e);
  assert.equal(r.isError, true);
  assert.equal(JSON.stringify(r).includes("FOREIGN_ROOT_TEXT"), false);
  assert.equal(g.before(event("invoke", invoke)).block, true);
}
for (const change of [
  (d) => (d.screenshot.windowCaptureFailed = true),
  (d) => (d.screenshot.occludedPossible = true),
  (d) => (d.source = "desktop"),
  (d) => delete d.screenshot,
  (d) => (d.screenshot.bounds.width = 1920),
]) {
  g = guard();
  const d = {
    ok: true,
    screenshot: structuredClone(image),
    text: "UNSAFE_TEXT",
  };
  change(d);
  const e = event("screenshot", input, d);
  e.content = [
    { type: "image", data: "UNSAFE_BYTES" },
    { type: "text", text: "UNSAFE_TEXT" },
  ];
  const r = g.after(e);
  assert.equal(r.isError, true);
  assert.equal(JSON.stringify(r).includes("UNSAFE_"), false);
}
g = guard();
const safe = event("screenshot", input, { ok: true, screenshot: image });
safe.content = [{ type: "image", data: "OWNED_BYTES" }];
assert.equal(g.after(safe).content[0].data, "OWNED_BYTES");
assert.equal(
  JSON.stringify(traceWithoutImages(safe)).includes("OWNED_BYTES"),
  false,
);
g = createVisualGuard(owned, () => {
  throw Error("verification failed");
});
assert.equal(g.before(event("ocr")).block, true);
assert.equal(g.after(event("ocr")).isError, true);
const running = { phase: "running", expiresAt: Date.now() + 10000 };
for (const owner of [
  { phase: "retained" },
  { phase: "running", expiresAt: 0 },
  null,
])
  assert.equal(
    visualBeforeHook(
      { before: () => undefined },
      () => [running, owner],
      () => {},
    )({}).block,
    true,
  );
assert.equal(
  visualBeforeHook(
    { before: () => undefined },
    () => [running, running],
    () => {},
  )({}),
  undefined,
);
assert.equal(
  visualBeforeHook(
    { before: () => undefined },
    () => {
      throw Error("unreadable");
    },
    () => {},
  )({}).block,
  true,
);
const denial = { block: true, reason: "required denial" };
assert.deepEqual(
  visualBeforeHook(
    { before: () => denial },
    () => [running, running],
    () => {
      throw Error("audit IO");
    },
  )({}),
  denial,
);
assert.equal(
  visualBeforeHook(
    { before: () => undefined },
    () => [running, running],
    () => {
      throw Error("audit IO");
    },
  )({}).block,
  true,
);
assert.equal(effectiveMetadataMatches([requested]), true);
for (const rows of [
  [],
  [{ ...requested, provider: "other" }],
  [{ ...requested, model: "other" }],
  [{ ...requested, thinkingLevel: "high" }],
  [{ ...requested, thinkingLevel: null }],
  [requested, { ...requested, model: "other" }],
])
  assert.equal(effectiveMetadataMatches(rows), false);

if (process.argv[2] === "keeper") {
  const failure = process.argv[3],
    fake = spawn(
      process.execPath,
      [
        "-e",
        "console.log(JSON.stringify({type:'tool_execution_end'}));setInterval(()=>{},1000)",
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
  process.send({ type: "child", pid: fake.pid });
  await keepVisualOwnership(
    fake,
    async () => {
      for await (const line of createInterface({ input: fake.stdout })) {
        JSON.parse(line);
        if (["query", "io", "json"].includes(failure))
          throw Error("simulated collector " + failure);
      }
    },
    {
      deadlineMs: failure === "deadline" ? 30 : 2000,
      writeOwner: (state) => process.send({ type: "retained", ...state }),
    },
  );
} else {
  for (const failure of ["query", "io", "json", "deadline"]) {
    const keeper = spawn(
        process.execPath,
        [import.meta.filename, "keeper", failure],
        { stdio: ["ignore", "pipe", "pipe", "ipc"] },
      ),
      closed = once(keeper, "close");
    keeper.stdout.resume();
    keeper.stderr.resume();
    let childPid;
    try {
      const receipt = await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(Error("retention test deadline")),
          5000,
        );
        keeper.on("message", (message) => {
          if (message.type === "child") childPid = message.pid;
          if (message.type === "retained") {
            clearTimeout(timer);
            resolve(message);
          }
        });
      });
      assert.equal(receipt.cleanupAuthorized, false);
      assert.equal(receipt.phase, "retained");
      assert.equal(receipt.childPid, childPid);
      assert.equal(process.kill(childPid, 0), true);
      assert.equal(process.kill(keeper.pid, 0), true);
    } finally {
      if (childPid) process.kill(childPid, "SIGTERM");
      keeper.kill("SIGTERM");
      await closed;
    }
  }
  console.log(
    "Visual scope, metadata, journal and actual process retention checks passed",
  );
}
