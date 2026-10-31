// Windows-only: dedicated passive text fixture; no physical input or daily profiles.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import computerUse from "../dist/extension.js";
import { computerUseHost } from "./native-host.mjs";

assert.equal(process.platform, "win32");
const visualAssociation = process.env.PI_CU_OCR_VISUAL_ASSOCIATION === "1";
const folder = await mkdtemp(join(tmpdir(), "pi-cu-ocr-fixture-"));
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
    fileURLToPath(new URL("./ocr-fixture.cs", import.meta.url)),
  ],
  { encoding: "utf8", windowsHide: true, cwd: folder },
);
assert.equal(built.status, 0, built.stdout + built.stderr);
const fixture = spawn(
  executable,
  [
    `Pi CU OCR ${Date.now()}`,
    ...(visualAssociation ? ["visual-association"] : []),
  ],
  {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    cwd: folder,
  },
);
const [ready] = await once(fixture.stdout, "data");
const handle = Number(ready.toString().trim());
const fixtureLines = createInterface({ input: fixture.stdout });
const host = computerUseHost();
computerUse(host.api);
const tool = host.tools.get("windows_computer_use_ocr");
assert.ok(tool);
const call = async (extra) => {
  const result = await tool.execute(
    `ocr-${Date.now()}`,
    {
      nativeWindowHandle: handle,
      processId: fixture.pid,
      maxWidth: 480,
      ...extra,
    },
    undefined,
    undefined,
    {},
  );
  return { result, details: result.details };
};
async function verifyVisualAssociation() {
  const target = {
    nativeWindowHandle: handle,
    processId: fixture.pid,
    activate: false,
  };
  const tree = await host.tools
    .get("windows_computer_use_accessibility_tree")
    .execute("visual-tree", { ...target, detailLevel: "full" });
  const flatten = (node) =>
    node ? [node, ...(node.children ?? []).flatMap(flatten)] : [];
  const buttons = flatten(tree.details.tree).filter(
    (node) =>
      node.controlType === "Button" &&
      /^(Button|WindowsForms10\.BUTTON)/.test(node.className ?? ""),
  );
  assert.equal(
    buttons.length,
    2,
    "visual fixture exposes two ordinary native buttons",
  );
  assert.ok(
    buttons.every(
      (node) => node.name === "" && node.patterns.includes("Invoke"),
    ),
    "painted buttons have no accessible labels but remain invokable",
  );
  const receipt = once(fixtureLines, "line");
  fixture.stdin.write("oracle\n");
  const [line] = await receipt;
  const oracle = JSON.parse(line);
  assert.equal(oracle.visualAssociation, true);
  const semanticText = flatten(tree.details.tree)
    .flatMap((node) =>
      [
        node.name,
        node.value,
        node.automationId,
        node.helpText,
        node.description,
      ].filter((value) => typeof value === "string"),
    )
    .join("\n");
  const semanticTokens = new Set(
    (semanticText.match(/\b[A-Z0-9]+\b/gi) ?? []).map((word) =>
      word.toUpperCase(),
    ),
  );
  for (const text of [
    "APPROVE",
    "IGNORE",
    oracle.approve.code,
    oracle.ignore.code,
  ])
    assert.equal(
      semanticTokens.has(text),
      false,
      "painted labels/codes are not exposed by UIA",
    );
  if (typeof tree.details.windowRef === "string")
    target.windowRef = tree.details.windowRef;
  const pictured = await host.tools
    .get("windows_computer_use_snapshot")
    .execute("visual-window-image", {
      ...target,
      includeScreenshot: true,
      captureWindow: true,
      maxWidth: 0,
    });
  const image = pictured.details.screenshot;
  assert.equal(pictured.details.ok, true);
  assert.equal(image.windowCaptureFailed, false);
  assert.equal(image.occludedPossible, false);
  assert.ok(["printwindow", "wgc", "screen-region"].includes(image.method));
  assert.ok(pictured.content.some((item) => item.type === "image"));
  const contains = (outer, inner) =>
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height;
  assert.ok(
    contains(oracle.target.windowBounds, image.bounds),
    "window image never extends beyond the independently owned window",
  );
  assert.ok(
    contains(image.bounds, oracle.target.clientBounds),
    "owned client pixels are captured",
  );
  assert.equal(
    "base64" in image,
    false,
    "image bytes are separate from receipt metadata",
  );
  const recognized = await call({ ...target, maxWidth: 0 });
  assert.equal(recognized.details.ok, true, JSON.stringify(recognized.details));
  assert.equal(recognized.details.occludedPossible, false);
  assert.match(
    recognized.details.text,
    new RegExp(`APPROVE\\s*${oracle.approve.code}`),
  );
  assert.match(
    recognized.details.text,
    new RegExp(`IGNORE\\s*${oracle.ignore.code}`),
  );
  assert.equal(oracle.approve.count, 0);
  assert.equal(oracle.ignore.count, 0);
  const query = await call({
    ...target,
    query: `APPROVE ${oracle.approve.code}`,
    maxWidth: 0,
  });
  assert.equal(query.details.matched.length, 1);
  const point = query.details.matched[0].word;
  const inside = (box) =>
    point.x > box.x &&
    point.x < box.x + box.width &&
    point.y > box.y &&
    point.y < box.y + box.height;
  assert.ok(
    inside(oracle.approve.bounds),
    "recognized label lies inside independently reported APPROVE rectangle",
  );
  const associated = buttons.filter((button) => inside(button.boundingBox));
  assert.equal(
    associated.length,
    1,
    "public bounds identify exactly one observed control",
  );
  const invoked = await host.tools
    .get("windows_computer_use_invoke")
    .execute("visual-invoke", {
      ...target,
      elementId: associated[0].id,
      fallbackClick: false,
    });
  assert.equal(invoked.details.ok, true, JSON.stringify(invoked.details));
  assert.ok(["uia_invoke", "native_button"].includes(invoked.details.method));
  const afterReceipt = once(fixtureLines, "line");
  fixture.stdin.write("oracle\n");
  const [afterLine] = await afterReceipt;
  const after = JSON.parse(afterLine);
  assert.equal(after.approve.count, 1);
  assert.equal(after.ignore.count, 0);
  console.log(
    JSON.stringify({
      ok: true,
      check: "visual OCR association",
      uiaLabelsAbsent: true,
      observedIdOnly: true,
      physicalInput: false,
      receipt: {
        before: oracle,
        observedButtons: buttons.map(({ id, name, boundingBox, patterns }) => ({
          id,
          name,
          boundingBox,
          patterns,
        })),
        windowImage: image,
        recognized: {
          text: recognized.details.text,
          language: recognized.details.language,
          captureMethod: recognized.details.captureMethod,
          imageBounds: recognized.details.imageBounds,
          imageScale: recognized.details.imageScale,
          imageScaleY: recognized.details.imageScaleY,
        },
        match: query.details.matched[0],
        invoked: {
          ok: invoked.details.ok,
          method: invoked.details.method,
          verification: invoked.details.verification,
        },
        after,
      },
    }),
  );
}
async function verifyDefault() {
  const { result, details } = await call({ query: "h e L L o  123" });
  assert.equal(result.isError, false, JSON.stringify(details));
  assert.match(details.text, /HELLO\s*123/i);
  assert.equal(details.coordinateSpace, "screen");
  assert.equal(details.matched.length, 3, "at most three word-run results");
  assert.ok(details.language);
  assert.ok(details.availableLanguages.length);
  assert.equal(
    result.content.some((item) => item.type === "image"),
    false,
  );
  assert.equal(JSON.stringify(details).includes('"base64"'), false);
  for (const hit of details.matched) {
    assert.equal(hit.source, "ocr");
    assert.equal(hit.control, null);
    assert.equal("id" in hit, false);
    assert.ok(hit.boundingBox.x > details.imageBounds.x + 10);
    assert.ok(hit.boundingBox.y > details.imageBounds.y + 20);
    assert.ok(
      hit.word.x >= hit.boundingBox.x &&
        hit.word.x <= hit.boundingBox.x + hit.boundingBox.width,
    );
  }
  const original = await call({ query: "HELLO 123", maxWidth: 0 });
  assert.equal(
    original.result.isError,
    false,
    JSON.stringify(original.details),
  );
  const nativeBox = original.details.matched[0].boundingBox;
  assert.ok(
    Math.abs(nativeBox.x - details.matched[0].boundingBox.x) < 6,
    "scaled OCR maps back to the original screen x",
  );
  assert.ok(
    Math.abs(nativeBox.y - details.matched[0].boundingBox.y) < 6,
    "scaled OCR maps back to the original screen y",
  );
  const literal = await call({ query: "HELLO.*123" });
  assert.equal(
    literal.details.matched.length,
    0,
    "query metacharacters are literal, never a regex",
  );
  const resolved = await call({ query: "HELLO", resolveControl: true });
  assert.equal(resolved.result.isError, false);
  for (const hit of resolved.details.matched)
    if (hit.control)
      assert.equal(
        "id" in hit.control,
        false,
        "explicit hit-test describes a real control without inventing an OCR ID",
      );
  const lines = details.lines;
  assert.ok(lines.length >= 4);
  const screenshot = await call({ query: "HELLO", includeScreenshot: true });
  assert.ok(screenshot.result.content.some((item) => item.type === "image"));
  const missing = await call({ query: "does-not-exist-957" });
  assert.equal(missing.details.matched.length, 0);
  assert.equal(missing.details.conclusive, false);
  assert.match(missing.details.note, /not proof/);
  const find = host.tools.get("windows_computer_use_find");
  const found = await find.execute(
    "sparse-find",
    { nativeWindowHandle: handle, processId: fixture.pid, query: "HELLO 123" },
    undefined,
    undefined,
    {},
  );
  assert.equal(found.isError, false, JSON.stringify(found.details));
  assert.ok(
    found.details.ocrCandidates.length > 0,
    "custom drawn text is located by sparse-tree OCR fallback",
  );
  assert.equal("ocrFallbackPending" in found.details, false);
  const noFallback = await find.execute(
    "no-fallback",
    {
      nativeWindowHandle: handle,
      processId: fixture.pid,
      query: "HELLO 123",
      ocrFallback: false,
    },
    undefined,
    undefined,
    {},
  );
  assert.equal("ocr" in noFallback.details, false);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    tool.execute(
      "cancelled",
      { nativeWindowHandle: handle },
      controller.signal,
      undefined,
      {},
    ),
  );
  await host.emit("before_agent_start", { messageType: "user" });
  fixture.stdin.write("minimize\n");
  await once(fixture.stdout, "data");
  const minimized = await call({ query: "HELLO" });
  assert.equal(minimized.result.isError, true);
  assert.match(String(minimized.details.error), /OCR_CAPTURE_FAILED/);
  assert.equal(minimized.details.conclusive, false);
  console.log(
    JSON.stringify({
      ok: true,
      check: "native OCR fixture",
      recognizedText: true,
      literalQuery: true,
      screenBounds: true,
      threeHitLimit: true,
      sparseFind: true,
      inconclusiveAbsence: true,
      minimizedRefused: true,
      physicalInput: false,
    }),
  );
}
try {
  if (visualAssociation) await verifyVisualAssociation();
  else await verifyDefault();
} finally {
  fixture.stdin.end("stop\n");
  if (fixture.exitCode === null) await once(fixture, "close");
  for (const shutdown of host.shutdown) await shutdown();
  fixtureLines.close();
  await rm(folder, { recursive: true, force: true });
}
