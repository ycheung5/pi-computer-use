import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

test("workspace actor plan starts no Windows fixture or paid model", () => {
  const plan = JSON.parse(
    execFileSync(process.execPath, ["tests/pi-workspace-host.mjs"], {
      encoding: "utf8",
    }),
  );
  assert.equal(plan.run, false);
  assert.equal(plan.runs, 3);
  assert.equal(plan.physicalInput, false);
  const explicitPlan = JSON.parse(
    execFileSync(
      process.execPath,
      ["tests/pi-workspace-host.mjs", "--run", "--plan"],
      { encoding: "utf8" },
    ),
  );
  assert.equal(explicitPlan.run, false);
});

test("workspace scope follows owned observed IDs and refuses unsafe routes", async () => {
  const { workspaceScope } = await import("./pi-workspace-host.mjs");
  const owned = {
    nativeWindowHandle: 100,
    processId: 200,
    title: "Original tab",
  };
  const scope = workspaceScope(owned);
  const event = (name: string, input: Record<string, unknown>) => ({
    toolName: `windows_computer_use_${name}`,
    input,
  });
  assert.equal(
    scope.before(event("launch_app", { target: "browser", resolveOnly: true })),
    undefined,
  );
  assert.equal(
    scope.before(event("launch_app", { target: "browser" }))?.block,
    true,
  );
  assert.equal(
    scope.before(
      event("find", {
        nativeWindowHandle: 100,
        processId: 200,
        windowTitle: "Original tab",
        ocrFallback: false,
      }),
    ),
    undefined,
  );
  assert.equal(
    scope.before(
      event("invoke", { elementId: "u:unknown", fallbackClick: false }),
    )?.block,
    true,
  );
  assert.throws(
    () =>
      scope.after({
        toolName: "windows_computer_use_find",
        details: {
          ok: true,
          windowRef: "w:unproven",
          matches: [{ id: "u:outside" }],
        },
      }),
    /root not proven/,
  );
  scope.after({
    toolName: "windows_computer_use_find",
    details: {
      ok: true,
      ...owned,
      windowRef: "w:owned",
      matches: [{ id: "u:button" }],
    },
  });
  scope.after({
    toolName: "windows_computer_use_accessibility_tree",
    details: {
      ok: true,
      ...owned,
      tree: { controlType: "Window", name: "Observed task tab title" },
    },
  });
  assert.equal(
    scope.before(
      event("accessibility_tree", {
        nativeWindowHandle: 100,
        processId: 200,
        windowTitle: "Observed task tab title",
      }),
    ),
    undefined,
  );
  assert.equal(
    scope.before(
      event("invoke", { elementId: "u:button", fallbackClick: false }),
    ),
    undefined,
  );
  assert.equal(
    scope.before(event("invoke", { elementId: "u:button" }))?.block,
    true,
  );
  assert.equal(
    scope.before(
      event("invoke", {
        elementId: "u:button",
        fallbackClick: false,
        processId: 201,
      }),
    )?.block,
    true,
  );
  assert.equal(
    scope.before(
      event("set_value", {
        elementId: "new-tab",
        value: "https://example.invalid",
      }),
    )?.block,
    true,
  );
  scope.after({
    toolName: "windows_computer_use_list_windows",
    details: { ok: true, windows: [{ ...owned, name: "New tab - Browser" }] },
  });
  assert.equal(
    scope.before(
      event("accessibility_tree", {
        nativeWindowHandle: 100,
        processId: 200,
        windowTitle: "New tab - Browser",
      }),
    ),
    undefined,
  );
  scope.after({
    toolName: "windows_computer_use_invoke",
    details: { ok: false, cleanupConfirmed: false },
  });
  assert.equal(
    scope.before(
      event("invoke", { elementId: "u:button", fallbackClick: false }),
    )?.block,
    true,
  );
});

test("workspace verification never drives UI after stop or uncertain audit", async () => {
  const { workspaceVerification } = await import("./pi-workspace-host.mjs");
  const healthy = {
    settled: true,
    unsafe: false,
    toolStarts: 2,
    auditRows: [{ type: "guard_summary", halted: false }],
  };
  assert.equal(workspaceVerification(healthy), "verify");
  assert.equal(workspaceVerification({ ...healthy, unsafe: true }), "retain");
  assert.equal(workspaceVerification({ ...healthy, auditRows: [] }), "retain");
  assert.equal(
    workspaceVerification({
      ...healthy,
      auditRows: [{ type: "guard_summary", halted: true }],
    }),
    "retain",
  );
  assert.equal(workspaceVerification({ ...healthy, settled: false }), "stop");
  assert.equal(
    workspaceVerification({
      settled: false,
      unsafe: false,
      toolStarts: 0,
      auditRows: [],
    }),
    "stop",
  );
});

test("workspace discovery forwards only the owned window's issued references", async () => {
  const { workspaceScope } = await import("./pi-workspace-host.mjs");
  const owned = {
    nativeWindowHandle: 100,
    processId: 200,
    title: "Original tab",
  };
  const scope = workspaceScope(owned);
  scope.after({
    toolName: "windows_computer_use_list_windows",
    details: {
      ok: true,
      windows: [
        {
          ...owned,
          name: "Original tab - Browser",
          windowRef: "w:listed",
          id: "uia:hwnd:100:pid:200",
        },
        {
          nativeWindowHandle: 101,
          processId: 201,
          name: "Other window",
          windowRef: "w:other",
          id: "u:other",
        },
      ],
    },
  });
  assert.equal(
    scope.before({
      toolName: "windows_computer_use_accessibility_tree",
      input: { windowRef: "w:listed" },
    }),
    undefined,
  );
  assert.equal(
    scope.before({
      toolName: "windows_computer_use_element_info",
      input: { elementId: "uia:hwnd:100:pid:200" },
    }),
    undefined,
  );
  assert.equal(
    scope.before({
      toolName: "windows_computer_use_accessibility_tree",
      input: { windowRef: "w:other" },
    })?.block,
    true,
  );
  assert.equal(
    scope.before({
      toolName: "windows_computer_use_element_info",
      input: { elementId: "u:other" },
    })?.block,
    true,
  );
  assert.equal(
    scope.before({
      toolName: "windows_computer_use_activate_window",
      input: { windowTitle: "Original tab - Browser" },
    })?.block,
    true,
  );
  assert.equal(
    scope.before({
      toolName: "windows_computer_use_activate_window",
      input: { nativeWindowHandle: 100 },
    })?.block,
    true,
  );
});

test("blank workspace proof uses browser chrome and refuses website or unproven values", async () => {
  const { blankWorkspaceEvidence } = await import("./pi-workspace-host.mjs");
  const address = {
    controlType: "Edit",
    automationId: "native-address",
    isPassword: false,
    patterns: ["Value"],
    value: "file:///C:/owned/page.html",
  };
  const tree = (bar: Record<string, unknown>) => ({
    controlType: "Window",
    name: "New Tab - Browser",
    children: [
      { controlType: "ToolBar", children: [bar] },
      { controlType: "Document", children: [{ ...address, value: "" }] },
    ],
  });
  const before = tree(address);
  assert.equal(
    blankWorkspaceEvidence(before, tree({ ...address, value: "" })),
    true,
  );
  assert.equal(
    blankWorkspaceEvidence(
      before,
      tree({ ...address, value: "chrome://newtab/" }),
    ),
    true,
  );
  assert.equal(
    blankWorkspaceEvidence(
      before,
      tree({ ...address, value: "https://example.invalid/" }),
    ),
    false,
  );
  assert.equal(
    blankWorkspaceEvidence(
      before,
      tree({ ...address, automationId: "other", value: "" }),
    ),
    false,
  );
  assert.equal(
    blankWorkspaceEvidence(
      before,
      tree({ ...address, patterns: undefined, value: "" }),
    ),
    false,
  );
  assert.equal(
    blankWorkspaceEvidence(before, {
      controlType: "Window",
      children: [
        { controlType: "Document", children: [{ ...address, value: "" }] },
      ],
    }),
    false,
  );
});

test("workspace scope permits both owned roots without mixing their identities", async () => {
  const { workspaceScope } = await import("./pi-workspace-host.mjs");
  const first = { nativeWindowHandle: 100, processId: 200, title: "First" };
  const second = { nativeWindowHandle: 101, processId: 201, title: "Second" };
  const scope = workspaceScope({ ...first, targets: [first, second] });
  scope.after({
    toolName: "windows_computer_use_list_windows",
    details: {
      ok: true,
      windows: [
        { ...first, windowRef: "w:first" },
        { ...second, windowRef: "w:second" },
        { nativeWindowHandle: 102, processId: 202, windowRef: "w:foreign" },
      ],
    },
  });
  assert.equal(
    scope.before({
      toolName: "windows_computer_use_accessibility_tree",
      input: { windowRef: "w:second" },
    }),
    undefined,
  );
  assert.equal(
    scope.before({
      toolName: "windows_computer_use_accessibility_tree",
      input: { ...second },
    }),
    undefined,
  );
  assert.equal(
    scope.before({
      toolName: "windows_computer_use_accessibility_tree",
      input: { nativeWindowHandle: 100, processId: 201 },
    })?.block,
    true,
  );
  assert.equal(
    scope.before({
      toolName: "windows_computer_use_accessibility_tree",
      input: { windowRef: "w:foreign" },
    })?.block,
    true,
  );
  assert.doesNotThrow(() =>
    scope.after({
      toolName: "windows_computer_use_accessibility_tree",
      details: { ok: true, ...second, tree: { controlType: "Window" } },
    }),
  );
  assert.throws(
    () =>
      scope.after({
        toolName: "windows_computer_use_accessibility_tree",
        details: {
          ok: true,
          ...second,
          inputTargetHandle: 100,
          inputTargetProcessId: 200,
        },
      }),
    /root differs/,
  );
});

test("workspace refusal screen requires preserved originals and relevant observations", async () => {
  const { refusalWorkspaceEvidence } = await import("./pi-workspace-host.mjs");
  const listing = (windows: unknown[]) => ({
    type: "tool_result",
    toolName: "windows_computer_use_list_windows",
    details: { ok: true, windows },
  });
  const preserved = { refusalOriginalsPreserved: true };
  assert.equal(
    refusalWorkspaceEvidence(
      "ambiguous",
      "Which window should I use?",
      preserved,
      [
        listing([
          { nativeWindowHandle: 1, processId: 2 },
          { nativeWindowHandle: 3, processId: 4 },
        ]),
      ],
    ),
    true,
  );
  assert.equal(
    refusalWorkspaceEvidence("ambiguous", "Done.", preserved, [
      listing([
        { nativeWindowHandle: 1, processId: 2 },
        { nativeWindowHandle: 3, processId: 4 },
      ]),
    ]),
    false,
  );
  assert.equal(
    refusalWorkspaceEvidence("ambiguous", "Which window?", preserved, [
      listing([{ nativeWindowHandle: 1, processId: 2 }]),
    ]),
    false,
  );
  assert.equal(
    refusalWorkspaceEvidence(
      "ambiguous",
      "Which window?",
      { refusalOriginalsPreserved: false },
      [
        listing([
          { nativeWindowHandle: 1, processId: 2 },
          { nativeWindowHandle: 3, processId: 4 },
        ]),
      ],
    ),
    false,
  );
  const complete = {
    type: "tool_result",
    toolName: "windows_computer_use_accessibility_tree",
    details: { ok: true, truncated: false },
  };
  assert.equal(
    refusalWorkspaceEvidence(
      "unsafe-workspace",
      "This app cannot create a safe separate task tab.",
      preserved,
      [listing([{ nativeWindowHandle: 1, processId: 2 }]), complete],
    ),
    true,
  );
  assert.equal(
    refusalWorkspaceEvidence(
      "unsafe-workspace",
      "This app cannot create a safe separate task tab.",
      preserved,
      [
        listing([{ nativeWindowHandle: 1, processId: 2 }]),
        { ...complete, details: { ok: true, truncated: true } },
      ],
    ),
    false,
  );
  assert.equal(
    refusalWorkspaceEvidence("unsafe-workspace", "Opened it.", preserved, [
      listing([{ nativeWindowHandle: 1, processId: 2 }]),
      complete,
    ]),
    false,
  );
});
