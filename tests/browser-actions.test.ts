import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { registerComputerUse } from "../src/extension.js";
import { computerUseHost } from "./native-host.mjs";

test("browser form fixture retains submission shape and resets independent delayed-event evidence", async () => {
  const fixture = spawn(process.execPath, [
    fileURLToPath(new URL("./browser-actions-server.mjs", import.meta.url)),
  ]);
  const closed = once(fixture, "close");
  const lines = createInterface({ input: fixture.stdout });
  try {
    const [line] = await once(lines, "line");
    const { url } = JSON.parse(line);
    const state = async () => (await fetch(`${url}form/delayed/state`)).json();
    const post = async (path: string, body = "") => {
      const response = await fetch(`${url}${path}`, { method: "POST", body });
      assert.equal(response.ok, true);
    };
    await fetch(`${url}form`);
    assert.deepEqual(await state(), { starts: 0, ready: 0, submissions: 0 });
    await post("form/delayed/start");
    assert.deepEqual(await state(), { starts: 1, ready: 0, submissions: 0 });
    await post("form/delayed/ready");
    const payload = {
      name: "Pi 中文 café 😀",
      notes: "First line\n第二行 café 😀",
      accepted: true,
      choice: "beta",
    };
    await post("form/submit", JSON.stringify(payload));
    assert.deepEqual(await (await fetch(`${url}form/state`)).json(), payload);
    assert.deepEqual(await state(), { starts: 1, ready: 1, submissions: 1 });
    await fetch(`${url}form`);
    assert.deepEqual(await state(), { starts: 0, ready: 0, submissions: 0 });
  } finally {
    fixture.stdin.end();
    await closed;
    lines.close();
  }
});

test("Pi exposes browser actions through the existing computer-use tools", async () => {
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
    const keypress = tools.find(
      (tool) => tool.name === "windows_computer_use_keypress",
    );
    assert.ok(keypress);
    const result = await keypress.execute(
      "invalid-keys",
      { browserTab: "t123", keys: ["ctrl", "a", "b"] },
      undefined,
      undefined,
      {} as Parameters<typeof keypress.execute>[4],
    );
    assert.equal(result.isError, true);
    assert.match(
      JSON.stringify(result.details),
      /INVALID_ARGUMENTS.*one non-modifier/,
    );
    for (const action of [
      "click",
      "double_click",
      "move",
      "scroll",
      "type_text",
      "keypress",
      "focus",
      "invoke",
      "set_value",
      "activate_window",
      "close_window",
      "wait_for",
    ]) {
      assert.equal(
        tools.filter((tool) => tool.name === `windows_computer_use_${action}`)
          .length,
        1,
        `${action} has one registration shared by desktop and browser`,
      );
    }
  } finally {
    for (const handler of shutdown) await handler();
  }
});
