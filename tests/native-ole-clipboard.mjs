// Opt-in foreground paste into a dedicated fixture. Restores the original clipboard.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { WorkerClient } from "../dist/client.js";

assert.equal(process.platform, "win32");
assert.equal(
  process.env.PI_CU_CLIPBOARD_INPUT_TEST,
  "1",
  "Opt in with PI_CU_CLIPBOARD_INPUT_TEST=1; this uses the clipboard and sends keys to its own fixture. Do not interact during the test.",
);
const folder = await mkdtemp(join(tmpdir(), "pi-cu-ole-clipboard-"));
const executable = join(folder, "fixture.exe");
const compile = spawnSync(
  join(
    process.env.WINDIR,
    "Microsoft.NET",
    "Framework64",
    "v4.0.30319",
    "csc.exe",
  ),
  [
    "/nologo",
    `/out:${executable}`,
    "/r:System.Windows.Forms.dll",
    fileURLToPath(new URL("./ole-clipboard-fixture.cs", import.meta.url)),
  ],
  { encoding: "utf8", windowsHide: true },
);
assert.equal(compile.status, 0, compile.stdout + compile.stderr);
const fixture = spawn(executable, [], {
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
  cwd: folder,
});
const closed = once(fixture, "close");
const lines = createInterface({ input: fixture.stdout });
const next = async () => {
  const result = await Promise.race([
    once(lines, "line"),
    closed.then(() => {
      throw Error("fixture exited before reply");
    }),
  ]);
  return result[0];
};
const command = async (text) => {
  const reply = next();
  fixture.stdin.write(`${text}\n`);
  return reply;
};
const target = {
  nativeWindowHandle: Number(await next()),
  processId: fixture.pid,
};
const client = new WorkerClient({
  launch: async () => ({
    executable: process.execPath,
    args: [fileURLToPath(new URL("../dist/worker.js", import.meta.url))],
    cwd: folder,
  }),
});
try {
  let found;
  for (let attempt = 0; attempt < 30; attempt++) {
    found = await client.execute("find", {
      ...target,
      query: "OLE clipboard editor",
      ocrFallback: false,
    });
    assert.equal(found.ok, true, JSON.stringify(found));
    if (found.matches.length) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(found.matches.length, 1, JSON.stringify(found));
  const id = found.matches[0].id;
  assert.equal(
    (await client.execute("activate_window", target)).activated,
    true,
  );
  assert.equal(
    (
      await client.execute("focus", {
        ...target,
        elementId: id,
        activate: true,
      })
    ).ok,
    true,
  );
  assert.equal(await command("seed-ole"), "ole-seeded");
  const text = "Clipboard test 中文 café 😀";
  const typed = await client.execute("type_text", {
    ...target,
    text,
    method: "clipboard",
    restoreClipboard: true,
    activate: true,
  });
  assert.equal(typed.ok, true, JSON.stringify(typed));
  assert.equal(typed.cleanupConfirmed, true);
  assert.equal(typed.clipboardCleanupConfirmed, true);
  assert.equal(typed.clipboardRestoreOutcome, "restored");
  assert.ok(typed.clipboardSnapshot.oleMetadataExcluded >= 1);
  assert.ok(typed.clipboardSnapshot.oleFormatsValidated >= 3);
  const after = await client.execute("element_info", {
    ...target,
    elementId: id,
    detailLevel: "full",
  });
  assert.equal(after.ok, true, JSON.stringify(after));
  assert.equal(after.element.value, text);
  assert.equal(
    await command("check-seed"),
    "seed-preserved",
    "Unicode, HTML and binary clipboard formats must survive",
  );
  assert.equal(await command("seed-indexed"), "indexed-seeded");
  const refused = await client.execute("type_text", {
    ...target,
    text: "MUST NOT APPEAR",
    method: "clipboard",
    restoreClipboard: true,
    activate: true,
  });
  assert.equal(refused.ok, false);
  assert.match(refused.error, /CLIPBOARD_SNAPSHOT_UNSUPPORTED/);
  assert.equal(refused.cleanupConfirmed, true);
  assert.equal(refused.clipboardCleanupConfirmed, true);
  assert.equal(refused.clipboardRestoreOutcome, "unchanged");
  assert.equal(await command("check-indexed"), "indexed-preserved");
  const untouched = await client.execute("element_info", {
    ...target,
    elementId: id,
    detailLevel: "full",
  });
  assert.equal(
    untouched.element.value,
    text,
    "unsupported indexed data must be refused before paste",
  );
  assert.equal(await command("seed-ole"), "ole-seeded");
  assert.equal(await command("copy-on-paste"), "copy-armed");
  const intervened = await client.execute("type_text", {
    ...target,
    text: " + more",
    method: "clipboard",
    restoreClipboard: true,
    activate: true,
  });
  assert.equal(intervened.ok, true, JSON.stringify(intervened));
  assert.equal(intervened.clipboardRestoreOutcome, "newer-copy-preserved");
  assert.equal(intervened.clipboardCleanupConfirmed, true);
  assert.equal(await command("check-newer"), "newer-preserved");
  console.log(
    JSON.stringify({
      ok: true,
      newerCopyPreserved: true,
      oleTextPaste: true,
      unicodeHtmlBinaryPreserved: true,
      indexedDataRefused: true,
      refusalSentNoInput: true,
    }),
  );
} finally {
  try {
    const restoration = await command("restore-close");
    assert.match(
      restoration,
      /original-restored|original-unchanged|newer-copy-preserved/,
    );
    console.log(JSON.stringify({ fixtureCleanup: restoration }));
    await closed;
    lines.close();
  } finally {
    await client.dispose();
  }
  await rm(folder, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}
