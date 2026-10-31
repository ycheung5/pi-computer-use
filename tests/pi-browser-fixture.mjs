import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
export const scenarios = ["form", "advanced", "stale"];
export async function formState(base) {
  const { nativeWorkerLaunch } = await import("../dist/launcher.js");
  const native = await nativeWorkerLaunch();
  const js = `Promise.all([fetch(${JSON.stringify(base + "form/state")}).then(r=>r.json()),fetch(${JSON.stringify(base + "form/delayed/state")}).then(r=>r.json())]).then(([payload,events])=>console.log(JSON.stringify({payload,events})))`;
  return JSON.parse(
    execFileSync(native.executable, ["-e", js], {
      encoding: "utf8",
      timeout: 10000,
      stdio: ["ignore", "pipe", "ignore"],
    }),
  );
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
  const audit = (e) =>
    appendFileSync(auditFile, `${JSON.stringify(e)}\n`, { mode: 0o600 });
  const { default: computerUse } = await import("../dist/extension.js");
  if (!/^http:\/\/127\.0\.0\.1:\d+\/$/.test(base ?? ""))
    throw Error("trusted fixture base required");
  if (!scenarios.includes(scenario)) throw Error("unknown fixture scenario");
  const form = base + "form",
    advanced = base + "advanced",
    initial = scenario === "advanced" ? advanced : form,
    urls = new Set(
      scenario === "advanced" ? [advanced, base + "child"] : [form, advanced],
    );
  const tabs = new Set(),
    files = new Set();
  const state = {
    tab: null,
    url: null,
    opening: false,
    haltWrites: false,
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
  const oracle = () => formState(base);
  pi.on("tool_call", (e) => {
    audit({
      type: "guard_tool_call",
      toolCallId: e.toolCallId,
      toolName: e.toolName,
      input: e.input,
    });
    if (JSON.parse(readFileSync(journal, "utf8")).phase === "retained")
      return deny(
        "controller retains uncertain ownership; no further dispatch",
      );
    const n = e.toolName?.replace(/^windows_computer_use_/, ""),
      a = e.input;
    if (state.stopped) return deny("operation was explicitly stopped");
    if (
      !e.toolName?.startsWith("windows_computer_use_") ||
      !a ||
      typeof a !== "object"
    )
      return deny("unsupported tool");
    if (n === "wait") return;
    if (
      !allowed.has(n) ||
      ["nativeWindowHandle", "processId", "windowTitle", "x", "y"].some(
        (k) => a[k] !== undefined,
      ) ||
      a.scope === "desktop"
    )
      return deny(
        "only observed elements in the owned headless browser tab are in scope",
      );
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
  });
  pi.on("tool_result", (e) => {
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
            return definition.execute(...params);
          },
        });
      };
    },
  });
  computerUse(wrapped);
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
  if (scenario === "form")
    return `At ${form}, submit name “${formExpected.name}”, notes “${formExpected.notes}”, accept terms and choose Beta. Start the delayed result and verify “Delayed result ready”, preserving disabled/read-only fields.${safety}`;
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
    f.lifecycle.aborted === false &&
    f.lifecycle.exitCode === 0 &&
    f.lifecycle.parseError !== true;
  const cleanup =
    f.cleanup?.profileEmpty === true &&
    f.cleanup.processCount === 0 &&
    f.cleanup.fixtureExited === true;
  let outcome = false;
  if (scenario === "form") {
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
      if (d.ok !== true || d.tab?.url !== `${f.base}advanced`) continue;
      if (d.dialog?.type === "alert" && typeof d.tab.id === "string") {
        alertTab = d.tab.id;
        alertHandled = false;
      }
      if (
        alertTab &&
        d.action === "keypress" &&
        d.tab.id === alertTab &&
        ["accepted", "dismissed"].includes(d.handledDialog)
      )
        alertHandled = true;
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
    provenance: Boolean(provenance),
    settled,
    cleanup,
    outcome: Boolean(outcome),
    pass: Boolean(provenance && settled && cleanup && outcome),
  };
}
