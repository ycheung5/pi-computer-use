// Opt-in foreground paste into an owned fixture. Cleanup respects clipboard ownership.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
for (let at = 0; at < args.length; at++) {
  const flag = args[at];
  if (["--plan", "--list-cases"].includes(flag)) continue;
  assert.ok(
    ["--engine", "--reference"].includes(flag),
    `Unknown argument: ${flag}`,
  );
  assert.ok(
    args[at + 1] && !args[at + 1].startsWith("--"),
    `${flag} requires a value`,
  );
  at++;
}
const option = (name, fallback) => {
  const at = args.indexOf(name);
  if (at < 0) return fallback;
  assert.ok(
    args[at + 1] && !args[at + 1].startsWith("--"),
    `${name} requires a value`,
  );
  return args[at + 1];
};
const engine = option("--engine", "pi");
assert.ok(
  ["pi", "reference"].includes(engine),
  "--engine must be pi or reference",
);
const referencePath = option("--reference");
const cases = [
  {
    id: "ole-preservation",
    oracle: "Exact editor text and fixture Unicode/HTML/binary preservation",
  },
  {
    id: "indexed-refusal",
    oracle: "Refused paste leaves editor and indexed clipboard unchanged",
  },
  {
    id: "newer-copy",
    oracle: "Exact appended text and fixture newer copy preserved",
  },
];
if (args.includes("--plan") || args.includes("--list-cases")) {
  console.log(
    JSON.stringify({
      engine,
      execution: "not-run",
      optIn: "PI_CU_CLIPBOARD_INPUT_TEST=1",
      cases,
      deferred: [
        "plain-only clipboard",
        "locked clipboard",
        "history/cloud exclusion",
        "delayed rendering",
        "additional rich formats",
      ],
      prerequisites: [
        "dedicated interactive Windows desktop",
        "Windows Node",
        "built Pi worker or pinned DSH checkout",
        "safely preservable original clipboard",
      ],
    }),
  );
  process.exit(0);
}
assert.equal(
  process.env.PI_CU_CLIPBOARD_INPUT_TEST,
  "1",
  "Opt in with PI_CU_CLIPBOARD_INPUT_TEST=1; this uses the clipboard and sends keys to its own fixture. Do not interact during the test.",
);
assert.equal(
  process.platform,
  "win32",
  "Clipboard comparison requires Windows Node",
);
if (engine === "reference")
  assert.ok(referencePath, "--reference requires the pinned DSH checkout path");
// No backend import, directory, compiler, client or fixture precedes the opt-in.
const { createComparisonClient } = await import("./comparison-client.mjs");
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
let client;
const observations = [];
const execute = async (action, args) => {
  try {
    const result = await client.execute(action, args);
    observations.push({ action, result });
    return result;
  } catch (error) {
    observations.push({
      action,
      error: {
        name: error.name,
        message: error.message,
        rpcError: error.rpcError,
      },
    });
    throw error;
  }
};
const readEditor = async (id, target) => {
  const result = await execute("element_info", {
    ...target,
    elementId: id,
    detailLevel: "full",
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  const fixtureValue = Buffer.from(
    await command("editor-base64"),
    "base64",
  ).toString("utf8");
  assert.equal(
    result.element.value,
    fixtureValue,
    "UIA and fixture editor text must agree",
  );
  return fixtureValue;
};
try {
  const target = {
    nativeWindowHandle: Number(await next()),
    processId: fixture.pid,
  };
  client = await createComparisonClient({ engine, referencePath, cwd: folder });
  let found;
  for (let attempt = 0; attempt < 30; attempt++) {
    found = await execute("find", {
      ...target,
      query: "OLE clipboard editor",
      ocrFallback: false,
    });
    assert.equal(found.ok, true, JSON.stringify(found));
    if ((found.matches ?? found.results)?.length) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const matches = found.matches ?? found.results;
  assert.equal(matches.length, 1, JSON.stringify(found));
  const id = matches[0].id;
  assert.equal((await execute("activate_window", target)).activated, true);
  assert.equal(
    (
      await execute("focus", {
        ...target,
        elementId: id,
        activate: true,
      })
    ).ok,
    true,
  );
  assert.equal(await command("seed-ole"), "ole-seeded");
  const text = "Clipboard test 中文 café 😀";
  const typed = await execute("type_text", {
    ...target,
    text,
    method: "clipboard",
    restoreClipboard: true,
    activate: true,
  });
  assert.equal(typed.ok, true, JSON.stringify(typed));
  assert.notEqual(
    typed.cleanupConfirmed,
    false,
    "Explicitly unconfirmed cleanup blocks later cases",
  );
  assert.notEqual(typed.clipboardCleanupConfirmed, false);
  assert.equal(await readEditor(id, target), text);
  assert.equal(
    await command("check-seed"),
    "seed-preserved",
    "Unicode, HTML and binary clipboard formats must survive",
  );
  assert.equal(await command("seed-indexed"), "indexed-seeded");
  const refused = await execute("type_text", {
    ...target,
    text: "MUST NOT APPEAR",
    method: "clipboard",
    restoreClipboard: true,
    activate: true,
  });
  assert.equal(refused.ok, false);
  assert.notEqual(
    refused.cleanupConfirmed,
    false,
    "Explicitly unconfirmed cleanup blocks later cases",
  );
  assert.notEqual(refused.clipboardCleanupConfirmed, false);
  assert.equal(await command("check-indexed"), "indexed-preserved");
  assert.equal(
    await readEditor(id, target),
    text,
    "unsupported indexed data must be refused before paste",
  );
  assert.equal(await command("seed-ole"), "ole-seeded");
  assert.equal(await command("copy-on-paste"), "copy-armed");
  const intervened = await execute("type_text", {
    ...target,
    text: " + more",
    method: "clipboard",
    restoreClipboard: true,
    activate: true,
  });
  assert.equal(intervened.ok, true, JSON.stringify(intervened));
  assert.notEqual(intervened.cleanupConfirmed, false);
  assert.notEqual(intervened.clipboardCleanupConfirmed, false);
  assert.equal(await readEditor(id, target), `${text} + more`);
  assert.equal(await command("check-newer"), "newer-preserved");
  console.log(
    JSON.stringify({
      ok: true,
      engine,
      newerCopyPreserved: true,
      oleTextPaste: true,
      unicodeHtmlBinaryPreserved: true,
      indexedDataRefused: true,
      refusalSentNoInput: true,
    }),
  );
} catch (error) {
  console.error(JSON.stringify({ ok: false, engine, error: error.message }));
  throw error;
} finally {
  // Retain raw tool errors/optional engine diagnostics; fixture oracles decide preservation.
  console.log(JSON.stringify({ engine, observations }));
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
    await client?.dispose();
  }
  await rm(folder, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}
