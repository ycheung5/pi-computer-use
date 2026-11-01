import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
export const scenarios = [
  "form",
  "advanced",
  "stale",
  "mixed",
  "partial",
  "cancel",
];
// Both local fixture consumers run their HTTP reads in Windows, including from a WSL Pi host.
async function fixtureState(base, paths) {
  const { nativeWorkerLaunch } = await import("../dist/launcher.js");
  const native = await nativeWorkerLaunch();
  const js = `Promise.all(${JSON.stringify(paths)}.map(path=>fetch(${JSON.stringify(base)}+path,{signal:AbortSignal.timeout(2000)}).then(r=>{if(!r.ok)throw Error('FIXTURE_HTTP_'+r.status);return r.json()}))).then(rows=>console.log(JSON.stringify(rows)))`;
  return JSON.parse(
    execFileSync(native.executable, ["-e", js], {
      encoding: "utf8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
    }),
  );
}
export async function formState(base) {
  const [payload, events] = await fixtureState(base, [
    "form/state",
    "form/delayed/state",
  ]);
  return { payload, events };
}
export async function heldState(base) {
  const [held] = await fixtureState(base, ["held/state"]);
  return held;
}
const allowed = new Set([
  "snapshot",
  "accessibility_tree",
  "find",
  "element_info",
  "wait_for",
  "set_value",
  "invoke",
  "focus",
  "click",
  "scroll",
  "type_text",
  "keypress",
  "screenshot",
  "close_window",
]);
const reads = new Set([
  "snapshot",
  "accessibility_tree",
  "find",
  "element_info",
  "wait_for",
  "screenshot",
]);
const safeRefusals =
  /^(?:INVALID_ARGUMENTS|STALE_BROWSER_REFERENCE|BROWSER_NOT_EDITABLE|BROWSER_NOT_FOCUSABLE|BROWSER_NO_FOCUSED_FIELD|BROWSER_ACTION_UNAVAILABLE|BROWSER_DIALOG_OPEN)(?::|$)/;
export default async function (pi) {
  const config = JSON.parse(process.env.PI_CU_TEST_SPEC ?? "null");
  const { base, scenario, upload, auditFile, journal } = config ?? {};
  const nativeRoutes = new Set();
  let nativeGuard, nativeBefore, nativeTrace;
  const audit = (e) =>
    appendFileSync(
      auditFile,
      `${JSON.stringify(nativeTrace ? nativeTrace(e) : e)}\n`,
      { mode: 0o600 },
    );
  if (config.native) {
    const { createVisualGuard, visualBeforeHook, traceWithoutImages } =
      await import("./pi-visual-fixture.mjs");
    nativeTrace = traceWithoutImages;
    nativeGuard = createVisualGuard(config.native.owned, () => {
      const o = JSON.parse(
        execFileSync(
          config.native.owned.windowsNode,
          [
            "-e",
            config.native.clientCode,
            config.native.owned.pipeName,
            "oracle",
          ],
          {
            encoding: "utf8",
            timeout: 15000,
            stdio: ["ignore", "pipe", "ignore"],
          },
        ),
      );
      const expected = config.native.owned.identity;
      if (
        !o.ok ||
        ["pid", "creation", "executable"].some(
          (k) => o.identity?.[k] !== expected[k],
        )
      )
        throw Error("owned native fixture unavailable");
      return { ok: true, ...o.target };
    });
    nativeBefore = visualBeforeHook(
      nativeGuard,
      () =>
        [journal, config.native.fixtureJournal].map((path) =>
          JSON.parse(readFileSync(path, "utf8")),
        ),
      () => {},
    );
  }
  const { default: computerUse, registerComputerUse } = await import(
    "../dist/extension.js"
  );
  if (!/^http:\/\/127\.0\.0\.1:\d+\/$/.test(base ?? ""))
    throw Error("trusted fixture base required");
  if (!scenarios.includes(scenario)) throw Error("unknown fixture scenario");
  const form = base + "form",
    advanced = base + "advanced",
    initial =
      scenario === "cancel"
        ? config.cancel.heldUrl
        : scenario === "advanced"
          ? advanced
          : form,
    urls = new Set(
      scenario === "cancel"
        ? [initial]
        : scenario === "advanced"
          ? [advanced, base + "child"]
          : [form, advanced],
    );
  const tabs = new Set(),
    files = new Set();
  const state = {
    tab: null,
    url: null,
    opening: false,
    haltWrites: false,
    guardFault: false,
    stopped: false,
    advanced: false,
    second: false,
    injected: false,
    secondFields: new Set(),
  };
  const observed = new Map(),
    tools = new Map();
  const observe = (n) => {
    if (!n || typeof n !== "object") return;
    if (typeof n.id === "string") observed.set(n.id, n);
    for (const c of n.children ?? []) observe(c);
  };
  const deny = (why) => ({
    block: true,
    reason: "SCOPED_FIXTURE_DENIED: " + why,
  });
  // Both synchronous hook boundaries retain faults instead of losing state through SDK errors.
  const guarded =
    (handler, before = false) =>
    (event) => {
      try {
        return handler(event);
      } catch {
        state.guardFault = true;
        return before ? deny("fixture audit or state unavailable") : undefined;
      }
    };
  let cancelSupport;
  if (scenario === "cancel") {
    if (
      !initial.startsWith(base + "held-") ||
      !/^[a-f0-9]{64}$/.test(config.cancel.hash)
    )
      throw Error("owned held fixture required");
    cancelSupport = await import("./pi-host-command.mjs");
  }
  function watchHeld(ctx) {
    let busy = false,
      closed = false,
      pin;
    const tick = async () => {
      if (busy || closed || state.stopped || state.guardFault) return;
      busy = true;
      try {
        let rows;
        try {
          rows = cancelSupport.commandRows(config.cancel.trace);
        } catch (error) {
          if (error.code === "ENOENT") return;
          throw error;
        }
        const ready = rows.find((row) => row.kind === "ready");
        if (ready && !pin) {
          pin = cancelSupport.commandWorkerIdentity(
            config.cancel.windowsNode,
            ready.pid,
          );
          if (
            !pin ||
            pin.executable.toLowerCase() !== ready.executable.toLowerCase()
          )
            throw Error("worker identity unknown");
          audit({ type: "cancel_worker_pin", pin });
        }
        const held = await heldState(base);
        if (closed) return;
        if (held.entries > 1 || held.completed > 0)
          throw Error("held navigation entry ambiguous or completed");
        const pending = cancelSupport.heldNavigationEntry(
          cancelSupport.commandRows(config.cancel.trace),
          held,
          config.cancel.hash,
        );
        if (!pending || !pin) return;
        if (pending.pid !== pin.pid || typeof ctx?.abort !== "function")
          throw Error("real SDK abort context unavailable");
        audit({
          type: "controlled_cancel",
          pending,
          witness: held,
          workerPin: pin,
        });
        state.stopped = true; // Fence dispatch before the actual SDK abort.
        ctx.abort();
      } catch (error) {
        state.guardFault = true;
        try {
          const owner = JSON.parse(readFileSync(journal, "utf8"));
          writeFileSync(
            journal,
            JSON.stringify({
              ...owner,
              phase: "retained",
              reason: "cancel-observation-unknown",
              error: String(error),
            }),
          );
        } catch {
          /* Local fault fence remains authoritative even if audit storage failed. */
        }
      } finally {
        busy = false;
      }
    };
    const timer = setInterval(() => void tick(), 50);
    return () => {
      closed = true;
      clearInterval(timer);
    };
  }
  const oracle = () => formState(base);
  const before = (e) => {
    if (state.guardFault)
      return deny("fixture guard fault; no further dispatch");
    audit({
      type: "guard_tool_call",
      toolCallId: e.toolCallId,
      toolName: e.toolName,
      input: e.input,
    });
    if (JSON.parse(readFileSync(journal, "utf8"))?.phase !== "running")
      return deny(
        "controller ownership is not proven running; no further dispatch",
      );
    const n = e.toolName?.replace(/^windows_computer_use_/, ""),
      a = e.input;
    if (
      nativeGuard &&
      a &&
      (a.nativeWindowHandle !== undefined ||
        a.processId !== undefined ||
        a.windowRef !== undefined ||
        a.windowTitle !== undefined ||
        (typeof a.elementId === "string" &&
          a.elementId !== "new-tab" &&
          !observed.has(a.elementId) &&
          ![...tabs].some((tab) => a.elementId === tab + ":address")))
    ) {
      if (state.stopped || state.haltWrites)
        return deny("prior operation or effect uncertain");
      if (a.browserTab !== undefined || observed.has(a.elementId))
        return deny("conflicting native and browser references");
      nativeRoutes.add(e.toolCallId);
      return nativeBefore(e);
    }

    if (state.stopped) return deny("operation was explicitly stopped");
    if (
      !e.toolName?.startsWith("windows_computer_use_") ||
      !a ||
      typeof a !== "object"
    )
      return deny("unsupported tool");
    if (
      (!allowed.has(n) && n !== "wait") ||
      [
        "windowRef",
        "nativeWindowHandle",
        "processId",
        "windowTitle",
        "x",
        "y",
      ].some((k) => a[k] !== undefined) ||
      a.scope === "desktop"
    )
      return deny(
        "only observed elements in the owned headless browser tab are in scope",
      );
    if (n === "wait") return;
    if (state.haltWrites && !reads.has(n))
      return deny("previous mutation or cleanup was uncertain");
    if (n === "set_value" && a.elementId === "new-tab") {
      if (
        state.tab ||
        state.opening ||
        a.value !== initial ||
        a.browserTab !== undefined
      )
        return deny("only the initial trusted form may be opened");
      state.opening = true;
      return;
    }
    if (!state.tab) return deny("observe the owned tab first");
    const ref = typeof a.elementId === "string" ? a.elementId : null;
    if (a.browserTab !== undefined && !tabs.has(a.browserTab))
      return deny("another tab is outside scope");
    const refTab = ref?.split(":")[0];
    if (ref && tabs.has(refTab) && ref === refTab + ":address") {
      if (n !== "set_value" || !urls.has(a.value))
        return deny("only the two trusted fixture documents may be navigated");
    } else if (ref !== null && (!tabs.has(refTab) || !observed.has(ref)))
      return deny("element must come from the owned tab observation");
    if (!tabs.has(a.browserTab) && ref === null)
      return deny("supply the owned tab or observed element");
    if (
      scenario !== "advanced" &&
      ref &&
      [
        "Direct upload",
        "Upload fixture",
        "Download fixture",
        "Open child",
      ].includes(observed.get(ref)?.name)
    )
      return deny("transfers and additional tabs are outside this task");
    if (n === "set_value" && files.has(ref) && a.value !== upload)
      return deny("only the exact owned sample may be uploaded");
    if (n === "set_value" && a.value === upload && !files.has(ref))
      return deny("sample path requires the observed file input");
    if (
      n === "keypress" &&
      (!Array.isArray(a.keys) ||
        a.keys.some(
          (k) => !["enter", "escape", "tab"].includes(String(k).toLowerCase()),
        ))
    )
      return deny("browser/window shortcuts are outside scope");
  };
  pi.on("tool_call", guarded(before, true));
  const after = (e) => {
    audit({
      type: "guard_tool_result",
      toolCallId: e.toolCallId,
      toolName: e.toolName,
      details: e.details,
      content: e.content,
      isError: e.isError,
    });
    const d = e.details,
      n = e.toolName?.replace(/^windows_computer_use_/, ""),
      code = String(d?.error ?? "");
    if (
      (e.content ?? []).some(
        (c) =>
          c.type === "text" &&
          String(c.text).includes("SCOPED_FIXTURE_DENIED:"),
      )
    )
      return;
    if (/COMPUTER_USE_STOPPED|COMPUTER_USE_CANCELLED/.test(code)) {
      state.stopped = true;
      state.haltWrites = true;
    }
    if (d?.cleanupConfirmed === false) state.haltWrites = true;
    if (e.isError || !d || d.ok !== true) {
      if (!reads.has(n) && !safeRefusals.test(code)) state.haltWrites = true;
      return;
    }
    if (state.opening) {
      state.opening = false;
      if (
        typeof d.tab?.id !== "string" ||
        !/^t[0-9a-f]+$/.test(d.tab.id) ||
        d.tab.url !== initial
      ) {
        state.haltWrites = true;
        return;
      }
      state.tab = d.tab.id;
      tabs.add(state.tab);
    }
    for (const child of d.openedTabs ?? []) {
      if (
        scenario !== "advanced" ||
        typeof child.id !== "string" ||
        !/^t[0-9a-f]+$/.test(child.id) ||
        child.url !== base + "child"
      ) {
        state.haltWrites = true;
        return;
      }
      tabs.add(child.id);
    }
    if (d.tab) {
      if (!tabs.has(d.tab.id) || !urls.has(d.tab.url)) {
        state.haltWrites = true;
        return;
      }
      state.url = d.tab.url;
      if (state.url === advanced) state.advanced = true;
      if (state.url === form && state.advanced) state.second = true;
    }
    if (state.second && d.tab?.url === form && Array.isArray(d.nodes)) {
      const fields = d.nodes.filter(
        (n) =>
          ["Name", "Notes"].includes(n.name) &&
          n.role?.toLowerCase() === "textbox" &&
          n.id,
      );
      if (fields.length === 2)
        state.secondFields = new Set(fields.map((n) => n.id));
    }
    if (
      typeof d.fileChooser?.input === "string" &&
      tabs.has(d.fileChooser.input.split(":")[0])
    ) {
      files.add(d.fileChooser.input);
      observed.set(d.fileChooser.input, { name: "file input" });
    }
    if (!reads.has(n) && d.verification === "unconfirmed")
      state.haltWrites = true;
    for (const ns of [d.nodes, d.results, d.matches])
      for (const n of ns ?? []) observe(n);
    observe(d.tree);
    observe(d.element);
    for (const node of observed.values())
      if (node.name === "Direct upload" && node.id) files.add(node.id);
  };
  pi.on("tool_result", (e) => {
    if (!nativeRoutes.has(e.toolCallId)) return guarded(after)(e);
    const safe = nativeGuard.after(e) ?? {
      content: [
        {
          type: "text",
          text: "SCOPED_FIXTURE_DENIED: native observation was not forwarded",
        },
      ],
      details: {
        ok: false,
        error: "SCOPED_FIXTURE_DENIED: native observation was not forwarded",
      },
      isError: true,
    };
    try {
      audit(
        nativeTrace({
          type: "guard_tool_result",
          toolCallId: e.toolCallId,
          toolName: e.toolName,
          details: safe.details,
          content: safe.content,
          isError: safe.isError,
        }),
      );
    } catch {
      state.guardFault = true;
    }
    if (
      safe.isError &&
      /CANCEL|STOP|CLEANUP|CAPTURE_UNAVAILABLE/.test(
        String(safe.details?.error),
      )
    )
      state.haltWrites = true;
    return safe;
  });
  const wrapped = new Proxy(pi, {
    get(target, key) {
      if (key !== "registerTool") {
        const v = Reflect.get(target, key);
        return typeof v === "function" ? v.bind(target) : v;
      }
      return (definition) => {
        tools.set(definition.name, definition);
        target.registerTool({
          ...definition,
          execute: async (...params) => {
            const [id, args, signal, onUpdate, ctx] = params,
              n = definition.name.replace(/^windows_computer_use_/, "");
            if (
              scenario === "stale" &&
              n === "set_value" &&
              args.elementId === state.tab + ":address" &&
              state.url === form &&
              args.value === advanced &&
              !state.advanced
            )
              audit({ type: "first_form_oracle", oracle: await oracle() });
            if (
              scenario === "stale" &&
              n === "set_value" &&
              state.second &&
              !state.injected &&
              state.secondFields.has(args.elementId)
            ) {
              state.injected = true;
              const navigation = await definition.execute(
                id + "-controlled-reload",
                { elementId: state.tab + ":address", value: form },
                signal,
                onUpdate,
                ctx,
              );
              audit({
                type: "controlled_reload",
                oldElementId: args.elementId,
                navigation,
              });
              if (
                navigation.details?.ok !== true ||
                navigation.details?.tab?.id !== state.tab ||
                navigation.details?.tab?.url !== form
              ) {
                state.haltWrites = true;
                throw Error(
                  "FIXTURE_CONTROL_FAILED: reload was not confirmed; requested mutation not dispatched",
                );
              }
              const result = await definition.execute(...params);
              const stale =
                result.details?.ok === false &&
                /^STALE_BROWSER_REFERENCE(?::|$)/.test(
                  String(result.details?.error),
                );
              audit({
                type: "controlled_stale_result",
                oldElementId: args.elementId,
                result,
              });
              const tree = await tools
                .get("windows_computer_use_accessibility_tree")
                .execute(
                  id + "-after-stale",
                  { browserTab: state.tab },
                  signal,
                  onUpdate,
                  ctx,
                );
              const fieldName = observed.get(args.elementId)?.name;
              const fresh = (tree.details?.nodes ?? []).find(
                (n) =>
                  n.name === fieldName &&
                  n.role?.toLowerCase() === "textbox" &&
                  n.id,
              );
              const info = fresh
                ? await tools
                    .get("windows_computer_use_element_info")
                    .execute(
                      id + "-after-stale-field",
                      { elementId: fresh.id },
                      signal,
                      onUpdate,
                      ctx,
                    )
                : null;
              audit({
                type: "after_stale_oracle",
                oracle: await oracle(),
                tree,
                fieldName,
                info,
              });
              if (!stale || tree.details?.ok !== true) state.haltWrites = true;
              return result;
            }
            if (
              scenario === "cancel" &&
              n === "set_value" &&
              args.value === initial
            ) {
              const result = definition.execute(...params),
                stopWatch = watchHeld(ctx);
              try {
                const value = await result;
                if (state.guardFault)
                  await new Promise(() => setInterval(() => {}, 60000));
                return value;
              } catch (error) {
                if (state.guardFault)
                  await new Promise(() => setInterval(() => {}, 60000));
                throw error;
              } finally {
                stopWatch();
              }
            }
            return definition.execute(...params);
          },
        });
      };
    },
  });
  if (scenario === "cancel") {
    const { nativeWorkerLaunch } = await import("../dist/launcher.js");
    registerComputerUse(wrapped, {
      launch: async (signal) => {
        const launch = await nativeWorkerLaunch(signal);
        return {
          ...launch,
          args: [
            "--import",
            cancelSupport.commandObserver(
              config.cancel.windowsTrace,
              config.cancel.hash,
            ),
            ...launch.args,
          ],
        };
      },
    });
  } else computerUse(wrapped);
}

const first = {
  name: "First form 中文",
  notes: "Seed café 😀",
  accepted: true,
  choice: "alpha",
};
const second = {
  name: "Second form 中文 café 😀",
  notes: "Recovered second line\n第二行",
  accepted: true,
  choice: "beta",
};
export const mixedExpected = {
  name: "Mixed task 中文 café 😀",
  notes: "Browser to native",
  accepted: true,
  choice: "beta",
};
const formExpected = {
  name: "Pi 中文 café 😀",
  notes: "First line\n第二行 café 😀",
  accepted: true,
  choice: "beta",
};
export function brief(scenario, source) {
  const form = `${source.url}form`,
    advanced = `${source.url}advanced`;
  const safety =
    " Reobserve and use supported recovery after conclusive no-effect refusals. Do not replay uncertain effects. Stop on actual cancellation or uncertain cleanup. Use only the owned local fixture browser pages, without native input or clipboard.";
  if (scenario === "mixed")
    return `At ${form}, submit name “${mixedExpected.name}”, notes “${mixedExpected.notes}”, accept terms and choose Beta. The submitted form returns a confirmation code. In our owned native window HWND ${source.native.nativeWindowHandle}, PID ${source.native.processId}, title ${JSON.stringify(source.native.title)}, invoke the one neutral CODE button bearing that returned code exactly once and preserve the other button. Confirm the browser's native-completion acknowledgement and report the code. Use only this local browser tab and owned native window with public observed references. Native controls require semantic Invoke with fallbackClick:false and activate:false; snapshots must use captureWindow:true for owned-window images. No keyboard, pointer, clipboard, launch, other windows or desktop images. Reobserve after conclusive no-effect refusal; do not replay uncertain effects; stop on actual cancellation or unknown cleanup.`;
  if (scenario === "form")
    return `At ${form}, submit name “${formExpected.name}”, notes “${formExpected.notes}”, accept terms and choose Beta. Start the delayed result and verify “Delayed result ready”, preserving disabled/read-only fields.${safety}`;
  if (scenario === "cancel")
    return `Open ${source.heldUrl}, verify its confirmation, and report the result.${safety}`;
  if (scenario === "partial")
    return `At ${form}, submit name “${formExpected.name}”, notes “${formExpected.notes}”, accept terms and choose Beta. Verify the submission and preserve disabled/read-only fields.${safety}`;
  if (scenario === "advanced")
    return `At ${advanced}, visit ${source.url}child, verify its identity and return to the advanced document. Answer its prompt “fixture answer 中文”, reject confirmation and dismiss the alert. Upload only ${source.upload} through Upload fixture; download the fixture once and report its completed owned file path. Verify the outcomes.${safety}`;
  return `At ${form}, submit a first form: name “${first.name}”, notes “${first.notes}”, terms accepted, Alpha. In the same tab visit ${advanced} and answer its prompt “continue 中文”. Return to a fresh ${form} and submit name “${second.name}”, notes “${second.notes}”, terms accepted, Beta. Verify both submissions and prompt response; preserve disabled/read-only fields. A controlled document refresh may occur.${safety}`;
}
export function actualText(d) {
  const values = [];
  const visit = (n) => {
    if (!n || typeof n !== "object") return;
    for (const k of ["name", "value", "text"])
      if (typeof n[k] === "string") values.push(n[k]);
    for (const c of n.children ?? []) visit(c);
  };
  for (const ns of [d?.nodes, d?.results, d?.matches])
    for (const n of ns ?? []) visit(n);
  visit(d?.tree);
  visit(d?.element);
  if (d?.ok === true && typeof d.text === "string") values.push(d.text);
  return values.join("\n");
}
const exact = (a, b) => a && Object.keys(b).every((k) => a[k] === b[k]);
// Status names come from owned server output, never editable values or unscoped page text.
function mixedStatusEvidence(d, request, known) {
  if (
    d.action === "wait_for" ||
    request?.toolName === "windows_computer_use_wait_for"
  ) {
    const args = request?.input;
    return d.condition === "element" &&
      d.verification === "observed" &&
      d.found !== false &&
      d.conclusive !== false &&
      d.timedOut !== true &&
      d.appear !== false &&
      args?.appear !== false &&
      (args?.condition ?? "element") === "element" &&
      args?.controlType?.toLowerCase() === "status" &&
      args.query === d.query
      ? [d.query]
      : [];
  }
  const names = [];
  const editable = (n) =>
    ["textbox", "searchbox", "combobox"].includes(
      String(n.role).toLowerCase(),
    ) ||
    ["input", "textarea", "select"].includes(n.tag) ||
    n.value !== undefined ||
    n.editable === true ||
    n.contenteditable === true;
  const visit = (node, blocked) => {
    if (!node) return;
    blocked = blocked || editable(node);
    if (
      !blocked &&
      node.role?.toLowerCase() === "status" &&
      typeof node.name === "string"
    ) {
      names.push(node.name);
      if (
        typeof node.id === "string" &&
        /^(?:Form confirmation|Native confirmation)/.test(node.name)
      )
        known.set(
          node.id,
          node.name.startsWith("Form confirmation") ? "pre" : "p",
        );
    }
    for (const child of node.children ?? []) visit(child, blocked);
  };
  for (const nodes of [d.nodes, d.results, d.matches]) {
    const ancestors = [];
    for (const node of nodes ?? []) {
      if (!Number.isFinite(node.depth)) ancestors.length = 0;
      else
        while (ancestors.length && ancestors.at(-1).depth >= node.depth)
          ancestors.pop();
      visit(
        node,
        ancestors.some((parent) => parent.editable),
      );
      if (Number.isFinite(node.depth))
        ancestors.push({ depth: node.depth, editable: editable(node) });
    }
  }
  visit(d.tree, false);
  const element = d.element;
  if (
    element &&
    known.get(element.id) === element.tag &&
    request?.input?.elementId === element.id &&
    !editable(element) &&
    typeof element.text === "string"
  )
    names.push(
      element.tag === "pre"
        ? "Form confirmation: " + element.text
        : element.text,
    );
  else visit(element, false);
  return names;
}

function partialRecovery(f) {
  const requests = new Map(),
    known = new Map(),
    statuses = new Map(),
    effects = new Set(),
    limitations = new Set();
  const reads = new Set([
    "find",
    "snapshot",
    "accessibility_tree",
    "element_info",
  ]);
  let tab,
    partial = false,
    edited = false,
    submitted = false,
    confirmed = false,
    bad = false,
    focused;
  const preserved = new Set();
  for (const e of f.audit ?? []) {
    if (e.type === "guard_tool_call") {
      requests.set(e.toolCallId, e);
      continue;
    }
    const request = requests.get(e.toolCallId),
      d = e.details;
    if (e.type !== "guard_tool_result" || !request || d?.ok !== true) continue;
    const action = request.toolName?.replace(/^windows_computer_use_/, ""),
      args = request.input ?? {};
    const nodes = [
      ...(d.nodes ?? []),
      ...(d.matches ?? []),
      ...(d.results ?? []),
      ...(d.element ? [d.element] : []),
    ];
    if (action === "set_value" && args.elementId === "new-tab") {
      if (
        partial ||
        edited ||
        submitted ||
        args.value !== f.base + "form" ||
        d.tab?.url !== args.value
      )
        return { pass: false, limitations: [] };
      tab = d.tab.id;
      partial =
        d.source === "browser-accessibility" &&
        d.nodeCount === 500 &&
        d.nodes?.length === 500 &&
        d.truncated === true &&
        d.truncationReason === "budget" &&
        !nodes.some(
          (n) => n.id && ["Name", "Notes", "Submit form"].includes(n.name),
        );
      if (!partial) return { pass: false, limitations: [] };
      continue;
    }
    if (!partial || d.tab?.id !== tab || d.tab?.url !== f.base + "form")
      continue;
    if (reads.has(action)) {
      for (const node of nodes) {
        // AX may return a button and its StaticText with the same opaque ID.
        if (
          typeof node.id === "string" &&
          ["textbox", "checkbox", "combobox", "option", "button"].includes(
            node.role,
          )
        ) {
          const previous = known.get(node.id);
          if (
            previous &&
            (previous.name !== node.name || previous.role !== node.role)
          )
            return {
              pass: false,
              limitations: ["contradictory observed actionable identity"],
            };
          known.set(node.id, node);
        }
        if (
          submitted &&
          node.name === "Disabled field" &&
          node.disabled === true &&
          node.value === "Disabled value"
        )
          preserved.add("disabled");
        if (
          submitted &&
          node.name === "Read-only field" &&
          node.readonly === true &&
          node.value === "Read-only value"
        )
          preserved.add("readonly");
      }
    }
    const node = known.get(args.elementId);
    if (action === "focus" || (action === "click" && node?.role === "textbox"))
      focused = node;
    if (reads.has(action))
      for (const candidate of nodes)
        if (candidate.focused === true && known.has(candidate.id))
          focused = candidate;
    if (
      ["set_value", "type_text", "click", "invoke", "keypress"].includes(action)
    ) {
      if (!known.size || (args.elementId && !node)) {
        bad = true;
        continue;
      }
      // Browser type_text uses actual focus, not its optional elementId hint.
      const target = action === "type_text" ? focused : node;
      if (
        ["set_value", "type_text"].includes(action) &&
        target?.role === "textbox" &&
        ["Name", "Notes"].includes(target.name)
      ) {
        const expected =
          target.name === "Name" ? formExpected.name : formExpected.notes;
        const text = action === "set_value" ? args.value : args.text;
        if (
          typeof text === "string" &&
          text.length &&
          (action === "set_value" ? text === expected : expected.includes(text))
        )
          effects.add(target.name);
      }
      if (action === "type_text" && !target)
        limitations.add("typing target lacks observed focus proof");
      if (
        target?.name === "Accept terms" &&
        target.role === "checkbox" &&
        (["click", "invoke"].includes(action) ||
          (action === "set_value" &&
            /^(true|1|yes|on|checked)$/i.test(String(args.value).trim())))
      )
        effects.add("terms");
      if (
        (target?.name === "Choice" &&
          target.role === "combobox" &&
          action === "set_value" &&
          String(args.value).toLowerCase() === "beta") ||
        (target?.name === "Beta" &&
          target.role === "option" &&
          ["click", "invoke"].includes(action))
      )
        effects.add("choice");
      edited = effects.size === 4;
      const enter =
        action === "keypress" &&
        args.keys?.some((key) => String(key).toLowerCase() === "enter");
      if (
        edited &&
        [...known.values()].some(
          (n) => n.name === "Submit form" && n.role === "button",
        ) &&
        ((["click", "invoke"].includes(action) &&
          node?.name === "Submit form" &&
          node.role === "button") ||
          enter)
      )
        submitted = true;
      if (
        action === "keypress" &&
        !submitted &&
        ["checkbox", "combobox", "option"].includes(focused?.role)
      )
        limitations.add(
          "keyboard field selection not covered by this verifier",
        );
      if (action === "keypress") focused = undefined;
    }
    if (submitted && (reads.has(action) || action === "wait_for"))
      for (const name of mixedStatusEvidence(d, request, statuses)) {
        if (!name.startsWith("Form confirmation: ")) continue;
        try {
          if (
            exact(
              JSON.parse(name.slice("Form confirmation: ".length)),
              formExpected,
            )
          )
            confirmed = true;
        } catch {}
      }
  }
  return {
    pass:
      partial &&
      edited &&
      submitted &&
      confirmed &&
      !bad &&
      preserved.size === 2 &&
      exact(f.oracle?.payload, formExpected) &&
      exact(f.oracle?.events, { submissions: 1, starts: 0, ready: 0 }),
    limitations: [...limitations],
  };
}

export function verifyOutcome(scenario, f) {
  const provenance =
    f.effective?.length > 0 &&
    f.effective.every(
      (m) =>
        m.provider === f.requested.provider &&
        m.model === f.requested.model &&
        m.thinkingLevel === f.requested.thinking,
    );
  const settled =
    f.lifecycle?.settled === true &&
    f.lifecycle.aborted === (scenario === "cancel") &&
    f.lifecycle.exitCode === 0 &&
    f.lifecycle.parseError !== true;
  const cleanup =
    f.cleanup?.profileEmpty === true &&
    f.cleanup.processCount === 0 &&
    f.cleanup.fixtureExited === true;
  let outcome = false,
    partialResult;
  if (scenario === "cancel") {
    const c = f.cancel;
    outcome =
      c?.assessment?.status === "observed" &&
      c.assessment.response?.id === c.pending?.id &&
      c.assessment.response?.pid === c.pending?.pid &&
      ["COMPUTER_USE_STOPPED", "COMPUTER_USE_CANCELLED"].includes(
        c.assessment.response?.result?.error,
      ) &&
      c.assessment.acknowledgment?.result?.released === true &&
      c.http?.urlHash === c.pending?.navigationHash &&
      c.workerRetired === true &&
      c.http?.entries === 1 &&
      c.http.completed === 0 &&
      c.http.closed === 1 &&
      c.noPostStopBusiness === true &&
      c.noCompletionClaim === true &&
      c.triggerCount === 1;
  } else if (scenario === "partial") {
    partialResult = partialRecovery(f);
    outcome = partialResult.pass;
  } else if (scenario === "mixed") {
    const native = f.native,
      code = native?.initial?.approve?.code,
      ids = new Set(),
      pending = new Map(),
      requests = new Map(),
      statuses = new Map();
    let codeObserved = false,
      acknowledged = false,
      invoked = 0,
      causal = false;
    const visit = (node) => {
      if (!node) return;
      if (
        node.controlType === "Button" &&
        node.name === "" &&
        typeof node.id === "string"
      )
        ids.add(node.id);
      for (const child of node.children ?? []) visit(child);
    };
    for (const e of f.audit ?? []) {
      const d = e.details;
      if (e.type === "guard_tool_call") requests.set(e.toolCallId, e);
      if (
        e.type === "guard_tool_call" &&
        e.toolName === "windows_computer_use_invoke" &&
        ids.has(e.input?.elementId)
      )
        pending.set(e.toolCallId, codeObserved);
      if (e.type !== "guard_tool_result" || d?.ok !== true) continue;
      if (
        d.nativeWindowHandle === native?.owned?.nativeWindowHandle &&
        d.processId === native?.owned?.processId
      ) {
        visit(d.tree);
        visit(d.element);
        for (const node of d.matches ?? []) visit(node);
      }
      if (
        e.toolName === "windows_computer_use_invoke" &&
        pending.has(e.toolCallId)
      ) {
        invoked++;
        causal = pending.get(e.toolCallId) === true;
      }
      if (d.tab?.url === f.base + "form") {
        const names = mixedStatusEvidence(
          d,
          requests.get(e.toolCallId),
          statuses,
        );
        if (
          names.some((name) => {
            if (!name.startsWith("Form confirmation: ")) return false;
            try {
              return (
                JSON.parse(name.slice("Form confirmation: ".length))
                  .confirmationCode === code
              );
            } catch {
              return false;
            }
          })
        )
          codeObserved = true;
        if (
          invoked === 1 &&
          names.includes("Native confirmation complete: " + code)
        )
          acknowledged = true;
      }
    }
    outcome =
      typeof code === "string" &&
      /^\d{4}$/.test(code) &&
      native.initial.approve.count === 0 &&
      native.initial.ignore.count === 0 &&
      native.final?.approve?.code === code &&
      native.final.approve.count === 1 &&
      native.final.ignore.count === 0 &&
      native.receipt?.issuedCode === code &&
      native.receipt.confirmations === 1 &&
      native.workerRetired === true &&
      native.cleanup?.fixtureRetired === true &&
      native.cleanup.folderRemoved === true &&
      exact(f.oracle?.payload, mixedExpected) &&
      f.oracle.events?.submissions === 1 &&
      invoked === 1 &&
      causal &&
      acknowledged &&
      new RegExp("\\b" + code + "\\b").test(f.finalReport ?? "");
  } else if (scenario === "form") {
    const delayed = f.observations?.some((d) => {
      if (d.ok !== true) return false;
      if (d.action !== "wait_for")
        return actualText(d).includes("Delayed result ready");
      return (
        d.verification === "observed" &&
        d.query === "Delayed result ready" &&
        d.appear !== false &&
        d.found !== false &&
        d.conclusive !== false &&
        d.timedOut !== true
      );
    });
    outcome =
      exact(f.oracle?.payload, formExpected) &&
      exact(f.oracle?.events, { submissions: 1, starts: 1, ready: 1 }) &&
      delayed;
  } else if (scenario === "advanced") {
    let alertTab = null,
      alertHandled = false;
    for (const d of f.observations ?? []) {
      if (d.ok !== true || typeof d.tab?.id !== "string") continue;
      if (alertTab && d.tab.id === alertTab) {
        if (
          d.tab.url === `${f.base}advanced` &&
          d.action === "keypress" &&
          ["accepted", "dismissed"].includes(d.handledDialog)
        ) {
          alertHandled = true;
          alertTab = null;
        } else if (
          d.dialog?.type !== "alert" ||
          d.tab.url !== `${f.base}advanced`
        ) {
          alertTab = null;
        }
      }
      if (d.tab.url === `${f.base}advanced` && d.dialog?.type === "alert") {
        alertTab = d.tab.id;
        alertHandled = false;
      }
    }
    const completed = new Map(
      (f.downloads ?? [])
        .filter(
          (x) =>
            x.name === f.downloadName &&
            x.state === "completed" &&
            typeof x.file === "string",
        )
        .map((x) => [x.file, x]),
    );
    const path = completed.size === 1 ? [...completed.keys()][0] : null;
    const reported =
      path &&
      typeof f.finalReport === "string" &&
      (f.finalReport.includes(path) ||
        f.finalReport.includes(path.replaceAll("\\", "/")));
    outcome =
      alertHandled &&
      f.downloadExact === true &&
      reported &&
      exact(f.oracle?.upload, {
        name: "fixture-upload.txt",
        content: "upload fixture only",
      }) &&
      f.oracle?.uploadRequests === 1 &&
      f.oracle?.downloads === 1 &&
      ["child", "returned", "prompt", "confirm", "upload"].every(
        (k) => f.advancedObserved?.[k] === true,
      );
  } else if (scenario === "stale") {
    const audit = f.audit ?? [],
      firsts = audit.filter((e) => e.type === "first_form_oracle"),
      reloads = audit.filter((e) => e.type === "controlled_reload"),
      refusals = audit.filter((e) => e.type === "controlled_stale_result"),
      afters = audit.filter((e) => e.type === "after_stale_oracle");
    const refusal = refusals[0]?.result?.details,
      after = afters[0],
      old = reloads[0]?.oldElementId;
    const fresh = new Set(),
      pending = new Set();
    let staleSeen = false,
      freshAction = false;
    for (const e of audit) {
      if (
        e.type === "guard_tool_result" &&
        e.details?.ok === false &&
        /^STALE_BROWSER_REFERENCE(?::|$)/.test(String(e.details.error))
      )
        staleSeen = true;
      if (
        staleSeen &&
        e.type === "guard_tool_result" &&
        e.details?.ok === true &&
        ["snapshot", "accessibility_tree", "find", "element_info"].some(
          (n) => e.toolName === `windows_computer_use_${n}`,
        )
      )
        for (const n of [
          ...(e.details.nodes ?? []),
          ...(e.details.results ?? []),
          e.details.element,
        ].filter(Boolean))
          if (
            ["Name", "Notes"].includes(n.name) &&
            typeof n.id === "string" &&
            n.id !== old
          )
            fresh.add(n.id);
      if (
        staleSeen &&
        e.type === "guard_tool_call" &&
        e.toolName === "windows_computer_use_set_value" &&
        fresh.has(e.input?.elementId)
      )
        pending.add(e.toolCallId);
      if (
        e.type === "guard_tool_result" &&
        typeof e.toolCallId === "string" &&
        pending.has(e.toolCallId) &&
        e.details?.ok === true
      )
        freshAction = true;
    }
    outcome =
      firsts.length === 1 &&
      exact(firsts[0].oracle?.payload, first) &&
      firsts[0].oracle?.events?.submissions === 1 &&
      exact(f.oracle?.payload, second) &&
      f.oracle?.events?.submissions === 1 &&
      f.promptObserved === true &&
      reloads.length === 1 &&
      refusals.length === 1 &&
      refusal?.ok === false &&
      /^STALE_BROWSER_REFERENCE(?::|$)/.test(String(refusal?.error)) &&
      afters.length === 1 &&
      after.oracle?.payload === null &&
      after.oracle?.events?.submissions === 0 &&
      after.info?.details?.ok === true &&
      after.info.details.element?.value === "" &&
      freshAction;
  }
  return {
    ...(partialResult
      ? { verifierLimitations: partialResult.limitations }
      : {}),
    provenance: Boolean(provenance),
    settled,
    cleanup,
    outcome: Boolean(outcome),
    pass: Boolean(provenance && settled && cleanup && outcome),
  };
}
