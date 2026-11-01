import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { registerComputerUse } from "../src/extension.js";
import { computerUseHost } from "./native-host.mjs";

test("Pi health tool reaches worker and session shutdown rejects subsequent calls", async () => {
  const { registrations: tools, shutdown, api: host } = computerUseHost();
  registerComputerUse(host, {
    launch: async () => ({
      executable: process.execPath,
      args: [
        "--import",
        "tsx",
        fileURLToPath(new URL("../src/worker.ts", import.meta.url)),
      ],
    }),
  });
  const health = tools.find(
    (tool) => tool.name === "windows_computer_use_health",
  );
  assert.ok(health);
  const windows = tools.find(
    (tool) => tool.name === "windows_computer_use_list_windows",
  );
  assert.ok(windows, "Pi exposes the reference window-listing tool");
  const invalid = await windows.execute(
    "invalid-windows",
    { maxWindows: 0 },
    undefined,
    undefined,
    {} as Parameters<typeof windows.execute>[4],
  );
  assert.equal(invalid.isError, true);
  assert.match(JSON.stringify(invalid.details), /INVALID_ARGUMENTS/);
  const context = {} as Parameters<typeof health.execute>[4];
  const result = await health.execute(
    "call-1",
    {},
    undefined,
    undefined,
    context,
  );
  assert.equal(result.isError, false);
  const text = result.content[0];
  assert.equal(text?.type, "text");
  if (text?.type === "text") assert.equal(JSON.parse(text.text).ok, true);
  for (const handler of shutdown) await handler();
  await assert.rejects(
    health.execute("call-2", {}, undefined, undefined, context),
    /disposed/i,
  );
});

test("Pi observation tools expose argument failures through normal execution", async () => {
  const { registrations: tools, shutdown, api: host } = computerUseHost();
  registerComputerUse(host, {
    launch: async () => ({
      executable: process.execPath,
      args: [
        "--import",
        "tsx",
        fileURLToPath(new URL("../src/worker.ts", import.meta.url)),
      ],
    }),
  });
  try {
    for (const action of [
      "snapshot",
      "accessibility_tree",
      "find",
      "element_info",
      "ocr",
      "wait",
      "wait_for",
    ]) {
      const tool = tools.find(
        (item) => item.name === `windows_computer_use_${action}`,
      );
      assert.ok(tool, `${action} is callable from Pi`);
      const result = await tool.execute(
        "bad",
        { viewMode: "unsupported" },
        undefined,
        undefined,
        {} as Parameters<typeof tool.execute>[4],
      );
      assert.equal(result.isError, true);
      assert.match(JSON.stringify(result.details), /INVALID_ARGUMENTS/);
    }
  } finally {
    for (const handler of shutdown) await handler();
  }
});

test("Pi browser navigation is exposed without adding a separate MCP extension", async () => {
  const { registrations: tools, shutdown, api: host } = computerUseHost();
  registerComputerUse(host, {
    launch: async () => ({
      executable: process.execPath,
      args: [
        "--import",
        "tsx",
        fileURLToPath(new URL("../src/worker.ts", import.meta.url)),
      ],
    }),
  });
  try {
    const navigation = tools.find(
      (tool) => tool.name === "windows_computer_use_set_value",
    );
    assert.ok(navigation, "browser navigation uses reference set_value tool");
    const result = await navigation.execute(
      "invalid-browser-url",
      { elementId: "new-tab", value: "javascript:alert(1)" },
      undefined,
      undefined,
      {} as Parameters<typeof navigation.execute>[4],
    );
    assert.equal(result.isError, true);
    assert.match(JSON.stringify(result.details), /INVALID_ARGUMENTS.*URL/);
    const tree = tools.find(
      (tool) => tool.name === "windows_computer_use_accessibility_tree",
    );
    assert.ok(tree);
    assert.ok(
      "browserTab" in
        (tree.parameters as { properties: Record<string, unknown> }).properties,
    );
  } finally {
    for (const handler of shutdown) await handler();
  }
});

test("Pi gives actionable guidance on activation refusal without replaying", async () => {
  const { registrations: tools, shutdown, api: host } = computerUseHost();
  const peer = `const i=require('node:readline').createInterface({input:process.stdin});let count=0;i.on('line',line=>{const r=JSON.parse(line);if(!r.action)return;count++;const error=r.action==='snapshot'?'WINDOWS_ERROR: TARGET_ACTIVATION_REFUSED: Windows did not grant foreground access':r.action==='find'?'WINDOWS_ERROR: OTHER_FAILURE: TARGET_ACTIVATION_REFUSED':'TARGET_ACTIVATION_REFUSED';console.log(JSON.stringify({id:r.id,result:{ok:false,action:r.action,error,cleanupConfirmed:true,activationDiagnostic:{foreground:'unavailable'},dispatchCount:count}}));});`;
  registerComputerUse(host, {
    launch: async () => ({ executable: process.execPath, args: ["-e", peer] }),
  });
  try {
    const tool = tools.find(
      (item) => item.name === "windows_computer_use_type_text",
    );
    assert.ok(tool);
    const result = await tool.execute(
      "refused",
      { text: "test" },
      undefined,
      undefined,
      {} as Parameters<typeof tool.execute>[4],
    );
    assert.equal(result.isError, true);
    const details = result.details as Record<string, unknown>;
    assert.equal(details.error, "TARGET_ACTIVATION_REFUSED");
    assert.equal(details.cleanupConfirmed, true);
    assert.deepEqual(details.activationDiagnostic, {
      foreground: "unavailable",
    });
    assert.equal(details.dispatchCount, 1);
    const content = JSON.stringify(result.content);
    assert.match(content, /Windows refused activation/);
    assert.match(content, /re-observe/i);
    assert.match(content, /ask the user/i);
    assert.match(content, /fresh observation/i);
    const snapshot = tools.find(
      (item) => item.name === "windows_computer_use_snapshot",
    );
    assert.ok(snapshot);
    const wrapped = await snapshot.execute(
      "wrapped",
      {},
      undefined,
      undefined,
      {} as Parameters<typeof snapshot.execute>[4],
    );
    const wrappedDetails = wrapped.details as Record<string, unknown>;
    assert.equal(
      wrappedDetails.error,
      "WINDOWS_ERROR: TARGET_ACTIVATION_REFUSED: Windows did not grant foreground access",
    );
    assert.equal(wrappedDetails.cleanupConfirmed, true);
    assert.deepEqual(wrappedDetails.activationDiagnostic, {
      foreground: "unavailable",
    });
    assert.equal(wrappedDetails.dispatchCount, 2);
    assert.match(JSON.stringify(wrapped.content), /Windows refused activation/);
    const find = tools.find(
      (item) => item.name === "windows_computer_use_find",
    );
    assert.ok(find);
    const unrelated = await find.execute(
      "other",
      {},
      undefined,
      undefined,
      {} as Parameters<typeof find.execute>[4],
    );
    const unrelatedDetails = unrelated.details as Record<string, unknown>;
    assert.equal(
      unrelatedDetails.error,
      "WINDOWS_ERROR: OTHER_FAILURE: TARGET_ACTIVATION_REFUSED",
    );
    assert.equal(unrelatedDetails.dispatchCount, 3);
    assert.equal(unrelatedDetails.guidance, undefined);
  } finally {
    for (const handler of shutdown) await handler();
  }
});

test("Pi native targeting exposes one opaque lifetime reference consistently", async () => {
  const { registrations: tools, api: host } = computerUseHost();
  registerComputerUse(host);
  for (const action of [
    "snapshot",
    "accessibility_tree",
    "find",
    "element_info",
    "focus",
    "invoke",
    "set_value",
    "scroll",
    "click",
    "double_click",
    "move",
    "drag",
    "type_text",
    "keypress",
    "screenshot",
    "ocr",
    "wait_for",
    "activate_window",
    "move_window",
    "close_window",
  ]) {
    const tool = tools.find(
      (item) => item.name === `windows_computer_use_${action}`,
    );
    assert.ok(tool, action);
    const schema = tool.parameters as { properties: Record<string, unknown> };
    assert.deepEqual(
      schema.properties.windowRef,
      { type: "string", minLength: 1 },
      action,
    );
    assert.equal("_windowMarker" in schema.properties, false, action);
  }
});
