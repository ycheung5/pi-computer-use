// Windows-only: dedicated passive text fixture; no physical input or daily profiles.
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
const fixture = spawn(executable, [`Pi CU OCR ${Date.now()}`], {
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
  cwd: folder,
});
const [ready] = await once(fixture.stdout, "data");
const handle = Number(ready.toString().trim());
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
try {
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
} finally {
  fixture.stdin.end("stop\n");
  if (fixture.exitCode === null) await once(fixture, "close");
  for (const shutdown of host.shutdown) await shutdown();
  await rm(folder, { recursive: true, force: true });
}
