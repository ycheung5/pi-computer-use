// Default: background only. Opt-in --chords uses owned controls, never the clipboard.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { computerUseHost } from "./native-host.mjs";

const timing = process.argv.includes("--timing");
const physical = timing || process.argv.includes("--chords");
const timingCases = [
  "modifier-aliases",
  "immediate-release",
  "focus-changing-immediate-release",
  "focus-changing-hold",
  "timed-key-and-chord",
  "foreground-error-release",
  "short-deadline-release",
  "cancel-disabled-deadline",
];
for (const arg of process.argv.slice(2))
  assert.ok(
    ["--chords", "--timing", "--plan"].includes(arg),
    "unknown native text option",
  );
if (process.argv.includes("--plan")) {
  console.log(
    JSON.stringify({
      executed: false,
      physicalInput: physical,
      clipboard: false,
      case: timing
        ? "keyboard-timing"
        : physical
          ? "chords-and-editor-focus"
          : "background-text",
      ...(timing ? { cases: timingCases } : {}),
    }),
  );
  process.exit(0);
}
if (physical)
  assert.equal(
    process.env.PI_CU_DEDICATED_INPUT_DESKTOP,
    "1",
    "PI_CU_DEDICATED_INPUT_DESKTOP=1 required for owned chord tests",
  );
assert.equal(process.platform, "win32");
const [{ default: computerUse }, { nativeDesktop }] = await Promise.all([
  import("../dist/extension.js"),
  import("../dist/native.js"),
]);
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
const fixture = spawn(
  executable,
  [
    `Pi CU Controls ${Date.now()}`,
    ...(physical ? ["--no-expiry", "--text-chords"] : []),
    ...(timing ? ["--timing"] : []),
  ],
  {
    stdio: ["pipe", "pipe", "pipe"],
    cwd: folder,
    windowsHide: true,
  },
);
let spawnFailure;
const closed = once(fixture, "close").catch((error) => {
  spawnFailure = error;
  return [-1];
});
fixture.stderr.resume();
fixture.stdin.on("error", () => {});
const lines = createInterface({ input: fixture.stdout });
const pending = [],
  received = [];
const keyEvents = [];
lines.on("line", (line) => {
  if (line.startsWith("key-event:")) {
    const [, key, direction, time] = line.split(":");
    keyEvents.push({ key: Number(key), direction, time: Number(time) });
  }
  const index = pending.findIndex((w) => line.startsWith(w.prefix));
  if (index < 0) received.push(line);
  else {
    const waiter = pending.splice(index, 1)[0];
    clearTimeout(waiter.timer);
    waiter.resolve(line);
  }
});
const reply = (prefix) =>
  new Promise((resolve, reject) => {
    if (spawnFailure || fixture.exitCode !== null) {
      reject(spawnFailure ?? Error("fixture exited before reply"));
      return;
    }
    const index = received.findIndex((line) => line.startsWith(prefix));
    if (index >= 0) {
      resolve(received.splice(index, 1)[0]);
      return;
    }
    const waiter = { prefix, resolve, reject, timer: undefined };
    waiter.timer = setTimeout(() => {
      pending.splice(pending.indexOf(waiter), 1);
      reject(Error("fixture response timed out"));
    }, 5000);
    pending.push(waiter);
  });
fixture.on("exit", () => {
  for (const waiter of pending.splice(0)) {
    clearTimeout(waiter.timer);
    waiter.reject(Error("fixture exited before reply"));
  }
});
fixture.on("error", (error) => {
  spawnFailure = error;
  for (const waiter of pending.splice(0)) {
    clearTimeout(waiter.timer);
    waiter.reject(error);
  }
});
let target;
const host = computerUseHost();
let inputUnconfirmed = false;
const call = async (action, args = {}) => {
  const tool = host.tools.get(`windows_computer_use_${action}`);
  assert.ok(tool, `Pi registers ${action}`);
  const input = physical && ["type_text", "keypress"].includes(action);
  if (input) inputUnconfirmed = true;
  const result = (
    await tool.execute(action, { ...target, ...args }, undefined, undefined, {})
  ).details;
  if (physical) console.log(JSON.stringify({ action, result }));
  if (input) {
    assert.ok(
      result.action === action &&
        typeof result.ok === "boolean" &&
        result.cleanupConfirmed === true &&
        result.keyboardCleanupConfirmed !== false &&
        result.inputCleanupConfirmed !== false &&
        result.buttonCleanupConfirmed !== false &&
        !["unconfirmed", "held", "failed"].includes(result.cleanupVerification),
      "input cleanup acknowledgment required",
    );
    if (
      result.ok === false &&
      [
        "USER_INPUT_ACTIVE: release physical input before control begins",
        "USER_INPUT_ACTIVE: release held input before control begins",
      ].includes(result.error)
    ) {
      inputUnconfirmed = false;
      return result;
    }
    const state = await untilText((s) => s.held === 0);
    inputUnconfirmed = false;
    console.log(JSON.stringify({ check: "input-observation", action, state }));
  }
  return result;
};
const find = async (query, controlType) => {
  const result = await call("find", { query, controlType, ocrFallback: false });
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.matches;
};
async function verifyBackground() {
  const edit = (await find("Background editor", "Edit"))[0];
  const initial = await call("set_value", {
    elementId: edit.id,
    value: "seed",
  });
  assert.equal(initial.ok, true, JSON.stringify(initial));
  // Exercise the native worker's ordinary quiet-attempt contract. A missing
  // focused edit can ONLY return WCU_NEEDS_INPUT, never physically escalate.
  const nativeCall = (action, args) =>
    nativeDesktop.execute(
      action,
      { ...target, ...args, _cancelEvent: "" },
      undefined,
      "passive-native-text",
    );
  const nativeFound = await nativeCall("find", {
    query: "Background editor",
    controlType: "Edit",
  });
  assert.equal(nativeFound.ok, true, JSON.stringify(nativeFound));
  const nativeEdit = nativeFound.matches[0];
  const focused = await nativeCall("focus", { elementId: nativeEdit.id });
  assert.equal(focused.ok, true, JSON.stringify(focused));
  const typed = await nativeCall("type_text", { text: " Unicode 測試 🙂" });
  assert.equal(typed.ok, true, JSON.stringify(typed));
  assert.equal(typed.method, "background:EM_REPLACESEL");
  assert.match(typed.verifyValue, /Unicode 測試 🙂/);
  const implicit = await host.tools
    .get("windows_computer_use_type_text")
    .execute(
      "implicit-type",
      { text: " remembered", method: "background" },
      undefined,
      undefined,
      {},
    );
  assert.equal(implicit.details.ok, true, JSON.stringify(implicit.details));
  assert.equal(implicit.details.method, "postmessage-wmchar");
  const posted = await call("type_text", { text: "!", method: "background" });
  assert.equal(posted.ok, true, JSON.stringify(posted));
  assert.equal(posted.verification, "unconfirmed");
  const character = await call("keypress", {
    keys: ["?"],
    dispatch: "background",
  });
  assert.equal(character.ok, true, JSON.stringify(character));
  const observed = await call("element_info", {
    elementId: edit.id,
    detailLevel: "full",
  });
  assert.match(observed.element.value, /remembered.*[!?]/);
  const nativeReadOnly = (
    await nativeCall("find", { query: "Read only editor", controlType: "Edit" })
  ).matches[0];
  await nativeCall("focus", { elementId: nativeReadOnly.id });
  const refused = await nativeCall("type_text", { text: "must not modify" });
  assert.equal(refused.ok, false);
  assert.match(refused.error, /READ_ONLY/);
  for (const [action, args] of [
    ["type_text", { text: "never typed", method: "sendinput" }],
    ["type_text", { text: "never clipboard", method: "clipboard" }],
    ["keypress", { keys: ["Ctrl", "A"] }],
  ]) {
    const invalid = await call(action, {
      ...args,
      nativeWindowHandle: 1,
      processId: 1,
    });
    assert.equal(invalid.ok, false, JSON.stringify(invalid));
    assert.match(invalid.error, /TARGET_IDENTITY_CHANGED/);
  }
  console.log(
    JSON.stringify({
      ok: true,
      backgroundUnicode: true,
      rememberedTarget: true,
      backgroundCharacter: true,
      readOnlyRefusal: true,
      physicalTargetRefusal: true,
      physicalInput: false,
      clipboardRead: false,
      clipboardMutation: false,
    }),
  );
}
async function observeText() {
  const response = reply("text-state:");
  fixture.stdin.write("observe-text\n");
  const fields = (await response).slice(11).split(":");
  assert.equal(fields.length, 11);
  const decode = (value) => Buffer.from(value, "base64").toString("utf8");
  const state = {
    primary: decode(fields[0]),
    secondary: decode(fields[1]),
    readOnly: decode(fields[2]),
    disabled: decode(fields[3]),
    start: Number(fields[4]),
    length: Number(fields[5]),
    foreground: Number(fields[6]),
    focus: Number(fields[7]),
    held: Number(fields[8]),
    keyboardLayout: fields[9],
    foregroundProcessId: Number(fields[10]),
  };
  assert.ok(
    [
      state.start,
      state.length,
      state.foreground,
      state.focus,
      state.held,
    ].every(Number.isFinite),
  );
  return state;
}
async function untilText(predicate) {
  const deadline = Date.now() + 2000;
  let last;
  do {
    const state = await observeText();
    last = state;
    if (predicate(state)) return state;
    await new Promise((resolve) => setTimeout(resolve, 25));
  } while (Date.now() < deadline);
  throw Error(
    `expected editor/focus effect not observed: ${JSON.stringify(last)}`,
  );
}
async function verifyTiming() {
  const primary = (await find("Background editor", "Document"))[0];
  const secondary = (await find("Secondary editor", "Edit"))[0];
  assert.ok(primary && secondary);
  const focus = async () => {
    const result = await call("focus", {
      elementId: primary.id,
      activate: true,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    await untilText(
      (s) =>
        s.focus === primary.nativeWindowHandle &&
        s.foreground === target.nativeWindowHandle,
    );
  };
  const resetEvents = () => {
    keyEvents.length = 0;
    for (let i = received.length - 1; i >= 0; i--)
      if (received[i].startsWith("key-event:")) received.splice(i, 1);
  };
  const released = async (key, minimum = 0) => {
    await reply(`key-event:${key}:up:`);
    const down = keyEvents.find((e) => e.key === key && e.direction === "down");
    const up = keyEvents.find((e) => e.key === key && e.direction === "up");
    assert.ok(down && up, "independent fixture must receive down and up");
    // Message timestamps can wrap and have platform timer quantization.
    const duration = (up.time - down.time + 4294967296) % 4294967296;
    assert.ok(
      duration >= Math.max(0, minimum - 25),
      JSON.stringify({ key, minimum, down, up, duration }),
    );
    const state = await untilText((s) => s.held === 0);
    console.log(
      JSON.stringify({
        check: "keyboard-timing-events",
        events: keyEvents,
        state,
      }),
    );
    return duration;
  };
  for (const timing of [{}, { holdMs: 0 }, { holdMs: 200 }]) {
    await focus();
    resetEvents();
    const before = await observeText();
    const result = await call("keypress", {
      keys: ["Tab"],
      activate: true,
      ...timing,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.cleanupConfirmed, true);
    assert.equal(result.inputDispatched, true);
    assert.equal(result.interrupted, false);
    await released(9, timing.holdMs ?? 0);
    const after = await untilText(
      (s) => s.focus === secondary.nativeWindowHandle && s.held === 0,
    );
    assert.equal(after.primary, before.primary);
    assert.equal(after.secondary, before.secondary);
    console.log(
      JSON.stringify({
        check:
          timing.holdMs > 0
            ? "focus-changing-hold"
            : "focus-changing-immediate-release",
        timing,
        before,
        after,
        result,
      }),
    );
  }
  for (const [alias, key] of [
    ["Ctrl", 17],
    ["Control", 17],
    ["Alt", 18],
    ["Option", 18],
    ["Shift", 16],
  ]) {
    await focus();
    resetEvents();
    const result = await call("keypress", { keys: [alias], activate: true });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.inputDispatched, true);
    assert.equal(result.timing.holdMs, 0);
    await released(key);
  }
  for (const [keys, key, holdMs] of [
    [["F23"], 134, 0],
    [["F23"], 134, 200],
    [["Ctrl", "F24"], 135, 200],
  ]) {
    await focus();
    resetEvents();
    const result = await call("keypress", {
      keys,
      holdMs,
      timeoutMs: 0,
      activate: true,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.timing.timeoutMs, 0);
    await released(key, holdMs);
    if (keys.length > 1) await released(17, holdMs);
  }
  await focus();
  resetEvents();
  const foregroundError = call("keypress", {
    keys: ["F24"],
    holdMs: 3000,
    timeoutMs: 0,
    activate: true,
  });
  const foregroundOutcome = foregroundError.then(
    (result) => ({ result }),
    (error) => ({ error: String(error) }),
  );
  await reply("key-event:135:down:");
  const ready = reply("timing-foreground-loss:");
  fixture.stdin.write("timing-foreground-loss\n");
  const loss = await ready;
  assert.match(loss, /^timing-foreground-loss:True:[1-9]\d*$/);
  const siblingHandle = Number(loss.split(":")[2]);
  await untilText((s) => s.foreground === siblingHandle);
  const failed = await foregroundOutcome;
  assert.ok(failed.result && !failed.result.ok, JSON.stringify(failed));
  assert.match(failed.result.error, /TARGET_FOREGROUND_CHANGED/);
  await released(135);
  await focus();
  resetEvents();
  const short = await call("keypress", {
    keys: ["F24"],
    holdMs: 3000,
    timeoutMs: 1000,
    activate: true,
  });
  assert.equal(short.ok, false);
  assert.match(short.error, /WORKER_TIMEOUT/);
  const shortDuration = await released(135);
  assert.ok(
    shortDuration < 3000,
    "short deadline must interrupt requested hold",
  );
  // A deadline may stop the operation. Start the separately authorized next case.
  await host.emit("agent_settled", { aborted: false });
  await host.emit("before_agent_start", {
    messageType: "user",
    systemPrompt: "",
    prompt: "Continue owned fixture timing",
  });
  await focus();
  resetEvents();
  inputUnconfirmed = true;
  const controller = new AbortController();
  const pending = host.tools.get("windows_computer_use_keypress").execute(
    "cancel-timing",
    {
      ...target,
      keys: ["Ctrl"],
      holdMs: Number.MAX_SAFE_INTEGER,
      timeoutMs: 0,
      activate: true,
    },
    controller.signal,
    undefined,
    {},
  );
  const cancelled = pending.then(
    (result) => ({ result }),
    (error) => ({ error: String(error) }),
  );
  await reply("key-event:17:down:");
  controller.abort();
  const outcome = await cancelled;
  assert.ok(outcome.error || outcome.result?.isError, JSON.stringify(outcome));
  await host.emit("agent_settled", { aborted: true });
  await released(17);
  inputUnconfirmed = false;
  const health = (
    await host.tools
      .get("windows_computer_use_health")
      .execute("health", {}, undefined, undefined, {})
  ).details;
  assert.equal(health.control.exclusiveControl, false);
  assert.equal(health.control.physicalKeysHeld, 0);
  console.log(
    JSON.stringify({
      ok: true,
      check: "keyboard-timing",
      cases: timingCases,
      cancelled: outcome,
      clipboard: false,
    }),
  );
}
async function verifyChords() {
  const primary = (await find("Background editor", "Document"))[0],
    secondary = (await find("Secondary editor", "Edit"))[0];
  assert.ok(primary && secondary);
  const initial = await observeText();
  assert.equal(initial.primary, "original");
  assert.equal(initial.secondary, "secondary");
  assert.equal(initial.held, 0);
  const activated = await call("activate_window", { activate: true });
  assert.equal(activated.activated, true, JSON.stringify(activated));
  const focus = async (element) => {
    const result = await call("focus", {
      elementId: element.id,
      activate: true,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    await untilText(
      (s) =>
        s.focus === element.nativeWindowHandle &&
        s.foreground === target.nativeWindowHandle,
    );
  };
  const chord = async (keys) => {
    const result = await call("keypress", { keys, activate: true });
    assert.equal(result.ok, true, JSON.stringify(result));
  };
  const type = async (text, focusMode = "preserve") => {
    const result = await call("type_text", {
      text,
      method: "sendinput",
      focusMode,
      activate: true,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.method, "sendinput-unicode");
    if (focusMode === "main") {
      assert.equal(result.focusConfirmed, true);
      assert.equal(result.inputFocusHandle, primary.nativeWindowHandle);
    }
  };
  await focus(primary);
  await chord(["Home"]);
  await untilText((s) => s.start === 0 && s.length === 0);
  await chord(["Ctrl", "A"]);
  await untilText((s) => s.start === 0 && s.length === 8);
  await type("ABCDE");
  await untilText((s) => s.primary === "ABCDE");
  await chord(["Home"]);
  await chord(["Shift", "Right"]);
  await untilText((s) => s.start === 0 && s.length === 1);
  await chord(["Backspace"]);
  await untilText((s) => s.primary === "BCDE");
  await chord(["End"]);
  await type("!");
  await untilText((s) => s.primary === "BCDE!");
  await chord(["Ctrl", "Shift", "Home"]);
  await untilText((s) => s.start === 0 && s.length === 5);
  await chord(["Home"]);
  await untilText((s) => s.start === 0 && s.length === 0);
  await chord(["Right"]);
  await untilText((s) => s.start === 1 && s.length === 0);
  await focus(secondary);
  await chord(["End"]);
  await type(" P");
  await untilText(
    (s) =>
      s.primary === "BCDE!" &&
      s.secondary === "secondary P" &&
      s.focus === secondary.nativeWindowHandle,
  );
  await type(" M", "main");
  await untilText(
    (s) =>
      s.primary === "B MCDE!" &&
      s.secondary === "secondary P" &&
      s.focus === primary.nativeWindowHandle,
  );
  const readonly = (await find("Read only editor", "Edit"))[0];
  await focus(readonly);
  const refused = await call("type_text", {
    text: "never",
    method: "sendinput",
    focusMode: "preserve",
    activate: true,
  });
  assert.equal(refused.ok, false);
  assert.match(refused.error, /READ_ONLY/);
  const disabled = (await find("Disabled editor", "Edit"))[0];
  assert.ok(disabled);
  const noFocus = await call("focus", {
    elementId: disabled.id,
    activate: true,
  });
  assert.equal(noFocus.ok, false);
  assert.match(noFocus.error, /DISABLED/);
  const wrong = await call("type_text", {
    processId: target.processId + 1,
    text: "never",
    method: "sendinput",
    activate: true,
  });
  assert.equal(wrong.ok, false);
  assert.match(wrong.error, /IDENTITY/);
  const final = await observeText();
  assert.equal(final.primary, "B MCDE!");
  assert.equal(final.secondary, "secondary P");
  assert.equal(final.readOnly, "fixed");
  assert.equal(final.disabled, "disabled fixed");
  assert.equal(final.held, 0);
  await host.emit("agent_settled", { aborted: false });
  const health = (
    await host.tools
      .get("windows_computer_use_health")
      .execute("health", {}, undefined, undefined, {})
  ).details;
  assert.equal(health.control.exclusiveControl, false);
  assert.equal(health.control.physicalKeysHeld, 0);
  const handedBack = await observeText();
  assert.equal(handedBack.primary, final.primary);
  assert.equal(handedBack.secondary, final.secondary);
  assert.equal(handedBack.held, 0);
  console.log(
    JSON.stringify({
      ok: true,
      check: "physical-chords-editor-focus",
      initial,
      final,
      handedBack,
      controlReleased: true,
      clipboard: false,
      imeState: "unknown",
    }),
  );
}
try {
  computerUse(host.api);
  target = {
    nativeWindowHandle: Number(await reply("")),
    processId: fixture.pid,
  };
  assert.ok(
    Number.isSafeInteger(target.nativeWindowHandle) &&
      target.nativeWindowHandle > 0,
  );
  if (timing) await verifyTiming();
  else if (physical) await verifyChords();
  else await verifyBackground();
} catch (error) {
  console.error(
    JSON.stringify({ failure: String(error), target, inputUnconfirmed }),
  );
  throw error;
} finally {
  if (inputUnconfirmed) {
    console.error("Text cleanup unconfirmed; retaining owner and fixture");
    const { retainPointerOwner } = await import("./pointer-input-safety.mjs");
    await retainPointerOwner();
  }
  await nativeDesktop.dispose();
  for (const handler of host.shutdown) await handler();
  if (fixture.pid && fixture.exitCode === null) {
    fixture.stdin.end("stop\n");
    const timeout = setTimeout(() => fixture.kill(), 2000);
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
