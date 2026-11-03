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
      event("find", { windowTitle: "Original tab", ocrFallback: false }),
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
      event("accessibility_tree", { windowTitle: "Observed task tab title" }),
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
      event("accessibility_tree", { windowTitle: "New tab - Browser" }),
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
