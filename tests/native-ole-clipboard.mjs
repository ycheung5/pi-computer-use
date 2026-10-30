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
  if (
    [
      "--plan",
      "--list-cases",
      "--probe-indexed",
      "--probe-virtual-file",
      "--probe-locked",
    ].includes(flag)
  )
    continue;
  assert.ok(
    ["--engine", "--reference", "--case"].includes(flag),
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
const allCases = [
  {
    id: "ole-preservation",
    oracle: "Exact editor text and fixture Unicode/HTML/binary preservation",
  },
  {
    id: "indexed-refusal",
    oracle:
      "Refusal or exact paste, with indexed clipboard independently preserved",
  },
  {
    id: "virtual-file",
    oracle:
      "Exact paste or safe refusal, with virtual file descriptor and indexed data preserved",
  },
  {
    id: "newer-copy",
    oracle: "Exact appended text and fixture newer copy preserved",
  },
];
const selected = option("--case");
assert.ok(
  !selected || allCases.some((item) => item.id === selected),
  "Unknown clipboard case",
);
const cases = selected
  ? allCases.filter((item) => item.id === selected)
  : allCases;
const indexedProbe = args.includes("--probe-indexed");
const virtualProbe = args.includes("--probe-virtual-file");
const lockedProbe = args.includes("--probe-locked");
assert.ok(
  [indexedProbe, virtualProbe, lockedProbe].filter(Boolean).length <= 1,
  "Choose only one fixture probe",
);
const probe = indexedProbe || virtualProbe || lockedProbe;
assert.ok(!probe || !selected, "Fixture probes cannot be combined with --case");
if (args.includes("--plan") || args.includes("--list-cases")) {
  console.log(
    JSON.stringify({
      engine,
      execution: "not-run",
      optIn: "PI_CU_CLIPBOARD_INPUT_TEST=1",
      cases: probe ? [] : cases,
      probe: indexedProbe
        ? "indexed-fixture"
        : virtualProbe
          ? "virtual-file-fixture"
          : lockedProbe
            ? "locked-clipboard-fixture"
            : undefined,
      observations: virtualProbe
        ? [
            "directContentQuery",
            "directContentGet",
            "clipboardContentQuery",
            "clipboardContentGet",
          ]
        : undefined,
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
        ...(lockedProbe ? [] : ["safely preservable original clipboard"]),
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
if (engine === "reference" && !probe)
  assert.ok(referencePath, "--reference requires the pinned DSH checkout path");
// No backend import, directory, compiler, client or fixture precedes the opt-in.
const { detachFixture, waitForFixtureClose } = await import(
  "./clipboard-fixture-close.mjs"
);
const {
  compareEditorObservation,
  isSafeClipboardRefusal,
  inputCleanupConfirmed,
} = await import("./clipboard-editor-observation.mjs");
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
const fixture = spawn(executable, lockedProbe ? ["--lock-probe"] : [], {
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
  cwd: folder,
});
let fixtureStderr = "";
fixture.stderr.on("data", (chunk) => {
  // Fixture emits fixed diagnostic categories, never original clipboard content.
  fixtureStderr = (fixtureStderr + chunk.toString()).slice(-2048);
});
let fixtureExit;
const closed = once(fixture, "close").then(([code, signal]) => {
  fixtureExit = { code, signal };
  return fixtureExit;
});
const lines = createInterface({ input: fixture.stdout });
const startupDiagnostic = () => {
  const match = fixtureStderr.match(
    /fixture-startup:([a-z-]+);hresult=([0-9A-F]{8});clipboard-unchanged/,
  );
  return match
    ? {
        phase: "startup",
        reason: match[1],
        hresult: match[2],
        clipboardChanged: false,
      }
    : undefined;
};
const next = async () => {
  if (fixtureExit)
    throw Error(
      `fixture exited before reply: ${JSON.stringify({ ...fixtureExit, startup: startupDiagnostic() })}`,
    );
  let timer;
  try {
    const result = await Promise.race([
      once(lines, "line"),
      closed.then((exit) => {
        throw Error(
          `fixture exited before reply: ${JSON.stringify({ ...exit, startup: startupDiagnostic() })}`,
        );
      }),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(Error("fixture reply timed out after 10000ms")),
          10000,
        );
      }),
    ]);
    return result[0];
  } finally {
    clearTimeout(timer);
  }
};
const command = async (text) => {
  if (fixtureExit) throw Error("fixture already exited; no command dispatched");
  const reply = next();
  fixture.stdin.write(`${text}\n`);
  return reply;
};
let fixtureReady = false;
let fixtureCloseUnconfirmed = false;
let failure;

let client;
let inputCleanupUnconfirmed = false;
const observations = [];
const execute = async (action, args) => {
  try {
    if (action === "type_text") inputCleanupUnconfirmed = true;
    const result = await client.execute(action, args);
    observations.push({ action, result });
    if (action === "type_text") {
      inputCleanupUnconfirmed = !inputCleanupConfirmed(result);
      if (inputCleanupUnconfirmed)
        throw Error("Clipboard input cleanup is unconfirmed; owner retained");
    }
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
  const observed = compareEditorObservation(result.element, fixtureValue);
  console.log(
    JSON.stringify({
      editorObservation: { uiaAvailability: observed.uiaAvailability },
    }),
  );
  return observed.fixtureValue;
};
try {
  const handle = Number(await next());
  assert.ok(
    Number.isSafeInteger(handle) && handle > 0,
    "fixture must return a valid HWND before any seed or backend call",
  );
  fixtureReady = true;
  const target = { nativeWindowHandle: handle, processId: fixture.pid };
  if (lockedProbe) {
    // Another process independently observes whether the global clipboard lock
    // blocks acquisition. It never reads or replaces clipboard content.
    const contender = () => {
      const result = spawnSync(executable, ["--lock-contender"], {
        encoding: "utf8",
        windowsHide: true,
        cwd: folder,
        timeout: 2500,
      });
      assert.equal(result.status, 0, result.stderr || String(result.error));
      return result.stdout.trim().replace(/^\uFEFF/, "");
    };
    const before = contender();
    assert.equal(
      before,
      "available",
      "clipboard must be available before lock",
    );
    const locked = JSON.parse(await command("probe-lock"));
    assert.equal(
      locked.locked,
      true,
      "fixture must acquire the clipboard lock",
    );
    let unlocked;
    let whileLocked;
    try {
      assert.equal(
        locked.ownerMatches,
        true,
        "OS must identify the fixture as lock holder",
      );
      whileLocked = contender();
      assert.equal(
        whileLocked,
        "busy",
        "a separate process must be unable to acquire the lock",
      );
    } finally {
      unlocked = JSON.parse(await command("probe-unlock"));
      console.log(
        JSON.stringify({
          probe: "locked-clipboard-fixture",
          before,
          locked,
          whileLocked,
          unlocked,
          clipboardRead: false,
          clipboardReplaced: false,
          physicalInput: false,
        }),
      );
      assert.equal(
        unlocked.released,
        true,
        "fixture must release its clipboard lock",
      );
      assert.equal(
        unlocked.sequenceUnchanged,
        true,
        "fixture must not replace clipboard content",
      );
    }
    const after = contender();
    console.log(JSON.stringify({ probe: "locked-clipboard-fixture", after }));
    assert.equal(
      after,
      "available",
      "clipboard must be available after release",
    );
  } else if (probe) {
    assert.equal(
      await command(virtualProbe ? "seed-virtual-file" : "seed-indexed"),
      virtualProbe ? "virtual-file-seeded" : "indexed-seeded",
    );
    const result = JSON.parse(
      await command(virtualProbe ? "probe-virtual-file" : "probe-indexed"),
    );
    console.log(
      JSON.stringify({
        probe: virtualProbe ? "virtual-file-fixture" : "indexed-fixture",
        result,
        physicalInput: false,
      }),
    );
    assert.equal(
      result.direct,
      virtualProbe ? "virtual-file-preserved" : "indexed-preserved",
      "direct indexed fixture payload must be readable",
    );
    assert.equal(
      result.clipboard,
      virtualProbe ? "virtual-file-preserved" : "indexed-preserved",
      "indexed payload must cross OleGetClipboard before tool dispatch",
    );
  } else {
    client = await createComparisonClient({
      engine,
      referencePath,
      cwd: folder,
    });
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
    const outcomes = [];
    const text = "Clipboard test 中文 café 😀";
    for (const item of cases) {
      assert.equal(await command("reset-editor"), "editor-reset");
      assert.equal(
        await readEditor(id, target),
        "",
        "case starts from a fresh known blank editor",
      );
      if (item.id === "indexed-refusal" || item.id === "virtual-file") {
        const virtualFile = item.id === "virtual-file";
        const check = virtualFile ? "check-virtual-file" : "check-indexed";
        const expected = virtualFile
          ? "virtual-file-preserved"
          : "indexed-preserved";
        assert.equal(
          await command(virtualFile ? "seed-virtual-file" : "seed-indexed"),
          virtualFile ? "virtual-file-seeded" : "indexed-seeded",
        );
        assert.equal(
          await command(check),
          expected,
          "indexed fixture payload must be readable before dispatch",
        );
        const result = await execute("type_text", {
          ...target,
          text,
          method: "clipboard",
          restoreClipboard: true,
          activate: true,
        });
        assert.notEqual(
          result.cleanupConfirmed,
          false,
          "Explicitly unconfirmed cleanup blocks later cases",
        );
        assert.notEqual(result.clipboardCleanupConfirmed, false);
        if (virtualFile && result.ok !== true) {
          assert.equal(result.ok, false, "refusal must be explicit");
          assert.ok(
            isSafeClipboardRefusal(result),
            "refusal must be a recognized pre-input clipboard snapshot limitation",
          );
        }
        assert.equal(
          await command(check),
          expected,
          "indexed clipboard survives either refusal or supported paste",
        );
        assert.equal(
          await readEditor(id, target),
          result.ok ? text : "",
          "success is exact paste; refusal must send no input",
        );
        outcomes.push({
          id: item.id,
          ok: true,
          outcome: result.ok
            ? "exact-paste-and-preserved"
            : "refused-and-preserved",
        });
      } else {
        assert.equal(await command("seed-ole"), "ole-seeded");
        assert.equal(
          await command("check-seed"),
          "seed-preserved",
          "supported seed is independently readable before dispatch",
        );
        if (item.id === "newer-copy")
          assert.equal(await command("copy-on-paste"), "copy-armed");
        const result = await execute("type_text", {
          ...target,
          text,
          method: "clipboard",
          restoreClipboard: true,
          activate: true,
        });
        assert.equal(result.ok, true, JSON.stringify(result));
        assert.notEqual(
          result.cleanupConfirmed,
          false,
          "Explicitly unconfirmed cleanup blocks later cases",
        );
        assert.notEqual(result.clipboardCleanupConfirmed, false);
        assert.equal(await readEditor(id, target), text);
        assert.equal(
          await command(
            item.id === "newer-copy" ? "check-newer" : "check-seed",
          ),
          item.id === "newer-copy" ? "newer-preserved" : "seed-preserved",
        );
        outcomes.push({ id: item.id, ok: true });
      }
    }
    console.log(JSON.stringify({ ok: true, engine, cases: outcomes }));
  }
} catch (error) {
  failure = error;
  console.error(
    JSON.stringify({
      ok: false,
      engine,
      error: error.message,
      fixtureExit,
      fixtureStartup: startupDiagnostic(),
    }),
  );
} finally {
  // Do not close the fixture, restore clipboard, dispose the client or remove files
  // while a rejected call or missing acknowledgment could leave input active.
  console.log(JSON.stringify({ engine, observations }));
  if (inputCleanupUnconfirmed) {
    console.error(
      JSON.stringify({
        fixtureCleanup: "retained: input cleanup unconfirmed",
        folder,
      }),
    );
    await new Promise(() => {});
  }
  try {
    if (fixtureReady && !fixtureExit) {
      const restoration = await command("restore-close");
      assert.match(
        restoration,
        /original-restored|original-unchanged|newer-copy-preserved/,
      );
      console.log(JSON.stringify({ fixtureClipboardOutcome: restoration }));
      await waitForFixtureClose(fixture, closed);
      console.log(JSON.stringify({ fixtureCleanup: "confirmed" }));
    } else {
      console.log(
        JSON.stringify({
          fixtureCleanup: fixtureReady
            ? "unconfirmed: fixture exited"
            : "not-started: no seed dispatched",
          fixtureExit,
          fixtureStartup: startupDiagnostic(),
        }),
      );
    }
  } catch (cleanupError) {
    if (fixtureReady && !fixtureExit) {
      fixtureCloseUnconfirmed = true;
      detachFixture(fixture);
    }
    console.error(
      JSON.stringify({
        fixtureCleanup: "unconfirmed",
        error: cleanupError.message,
      }),
    );
    failure ??= cleanupError;
  } finally {
    lines.close();
    if (!fixtureReady && !fixtureExit) {
      // No seed command was sent: retiring a stuck startup cannot discard fixture clipboard data.
      fixture.kill();
      let timer;
      try {
        await Promise.race([
          closed,
          new Promise((_, reject) => {
            timer = setTimeout(
              () =>
                reject(Error("fixture startup process cleanup unconfirmed")),
              3000,
            );
          }),
        ]);
      } catch (cleanupError) {
        console.error(
          JSON.stringify({
            fixtureCleanup: "unconfirmed",
            error: cleanupError.message,
          }),
        );
        failure ??= cleanupError;
      } finally {
        clearTimeout(timer);
      }
    }
    try {
      await client?.dispose();
    } catch (cleanupError) {
      failure ??= cleanupError;
      console.error(
        JSON.stringify({
          backendCleanup: "unconfirmed",
          error: cleanupError.message,
        }),
      );
    }
  }
  try {
    if (fixtureCloseUnconfirmed) {
      console.error(
        JSON.stringify({
          fixtureFilesCleanup: "retained: owner exit unconfirmed",
          folder,
        }),
      );
    } else
      await rm(folder, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
  } catch (cleanupError) {
    console.error(
      JSON.stringify({
        fixtureFilesCleanup: "unconfirmed",
        error: cleanupError.message,
      }),
    );
    failure ??= cleanupError;
  }
}

if (failure) throw failure;
