// Advanced workflow through the same public tool/backend seam as the paired form.
import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";

export async function advancedWorkflow({
  call,
  rawCall,
  row,
  tab,
  source,
  app,
  engine,
  run,
  desktop,
  before,
}) {
  const check = async (phase, operation) => {
    try {
      await operation();
      row.steps.push({ phase, status: "pass" });
    } catch (error) {
      row.steps.push({
        phase,
        status: "fail",
        error: String(error),
        toolResult: error.toolResult,
      });
      throw error;
    }
  };
  const find = async (name, role) => {
    const { result } = await call("find", { browserTab: tab, query: name });
    const matches = result.results.filter(
      (x) =>
        x.id && x.name === name && (!role || x.role.toLowerCase() === role),
    );
    assert.equal(matches.length, 1, JSON.stringify(result));
    return matches[0].id;
  };
  const rejected = async (action, args) => {
    const result = await rawCall(action, args);
    assert.equal(result.ok, false, JSON.stringify(result));
    return result;
  };
  const tree = async (id = tab) =>
    (await call("accessibility_tree", { browserTab: id })).result.text;
  await check("navigation and stale element identity", async () => {
    assert.match(await tree(), /Advanced browser fixture/);
    const marker = await find("Document marker", "textbox");
    await call("set_value", {
      elementId: `${tab}:address`,
      value: `${source.url}child`,
    });
    assert.match(await tree(), /Child fixture/);
    row.navigationStaleResult = await rejected("element_info", {
      elementId: marker,
    });
    assert.match(
      String(row.navigationStaleResult.error),
      /STALE|document|node|observed/i,
    );
    row.navigationStaleRejected = true;
    await call("set_value", {
      elementId: `${tab}:address`,
      value: `${source.url}advanced`,
    });
    assert.match(await tree(), /Advanced browser fixture/);
  });
  await check("new child tab and closed identity", async () => {
    const { result: beforePopup } = await call("list_windows", {
      maxWindows: 1,
    });
    const beforeIds = new Set(
      beforePopup.browserLane.browsers.flatMap((x) => x.tabs).map((x) => x.id),
    );
    const { result: opened } = await call("click", {
      elementId: await find("Open child", "link"),
    });
    let child = opened.openedTabs?.[0]?.id;
    row.popupAction = opened;
    const discoveryDeadline = Date.now() + 3000;
    while (!child && Date.now() < discoveryDeadline) {
      const { result: listing } = await call("list_windows", { maxWindows: 1 });
      const candidates = listing.browserLane.browsers
        .flatMap((x) => x.tabs)
        .filter((x) => !beforeIds.has(x.id) && x.url === `${source.url}child`);
      assert.ok(candidates.length <= 1, JSON.stringify(candidates));
      child = candidates[0]?.id;
      if (!child) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(child, JSON.stringify(opened));
    assert.notEqual(child, tab);
    assert.match(await tree(child), /Child fixture/);
    assert.match(await tree(), /Advanced browser fixture/);
    const { result: closed } = await call("close_window", {
      browserTab: child,
    });
    assert.equal(closed.closed, true, JSON.stringify(closed));
    row.closedTabResult = await rejected("accessibility_tree", {
      browserTab: child,
    });
    row.closedTabRejected = true;
    const { result: listed } = await call("list_windows", { maxWindows: 1 });
    assert.ok(
      !listed.browserLane.browsers
        .flatMap((x) => x.tabs)
        .some((x) => x.id === child),
    );
    row.child = { id: child, parent: tab, closed: true };
  });
  await check("JavaScript prompt confirm and alert", async () => {
    const { result: prompt } = await call("click", {
      elementId: await find("Prompt action", "button"),
    });
    assert.equal(prompt.dialog?.type, "prompt", JSON.stringify(prompt));
    await call("type_text", { browserTab: tab, text: "fixture answer 中文" });
    await call("keypress", { browserTab: tab, keys: ["enter"] });
    assert.match(await tree(), /Prompt: fixture answer 中文/);
    const { result: confirm } = await call("click", {
      elementId: await find("Confirm action", "button"),
    });
    assert.equal(confirm.dialog?.type, "confirm", JSON.stringify(confirm));
    await call("keypress", { browserTab: tab, keys: ["escape"] });
    assert.match(await tree(), /Confirm: false/);
    const { result: alert } = await call("click", {
      elementId: await find("Alert action", "button"),
    });
    assert.equal(alert.dialog?.type, "alert", JSON.stringify(alert));
    await call("keypress", { browserTab: tab, keys: ["enter"] });
    assert.match(await tree(), /Advanced browser fixture/);
    row.dialog = {
      prompt: "fixture answer 中文",
      confirm: false,
      alertDismissed: true,
      nativeDialog: false,
    };
  });
  if (app === "firefox") {
    await check("experimental Firefox transfer refusal", async () => {
      row.upload = {
        supported: false,
        result: await rejected("set_value", {
          elementId: await find("Direct upload", "textbox"),
          value: source.upload,
        }),
      };
      assert.match(
        row.upload.result.error,
        /BROWSER_(?:UNSUPPORTED|NOT_EDITABLE)/,
      );
      if (engine === "reference") {
        row.download = {
          supported: false,
          tested: false,
          reason:
            "Reference experimental BiDi does not provide download tracking or a dedicated download path; no download action dispatched",
        };
      } else {
        row.download = {
          supported: false,
          tested: true,
          result: await rejected("click", {
            elementId: await find("Download fixture", "link"),
          }),
        };
        assert.match(row.download.result.error, /BROWSER_UNSUPPORTED/);
      }
      const state = await (await fetch(`${source.url}advanced/state`)).json();
      assert.equal(state.upload, null);
      assert.equal(state.downloads, 0);
    });
  } else {
    await check("intercepted chooser and exact uploaded file", async () => {
      const { result: chooser } = await call("click", {
        elementId: await find("Upload fixture", "button"),
      });
      assert.ok(chooser.fileChooser?.input, JSON.stringify(chooser));
      await call("set_value", {
        elementId: chooser.fileChooser.input,
        value: source.upload,
      });
      await call("wait_for", {
        browserTab: tab,
        condition: "text",
        query: "Uploaded: fixture-upload.txt",
        timeoutMs: 3000,
      });
      const state = await (await fetch(`${source.url}advanced/state`)).json();
      row.upload = state.upload;
      row.uploadRequests = state.uploadRequests;
      assert.equal(state.uploadRequests, 1);
      assert.deepEqual(row.upload, {
        name: "fixture-upload.txt",
        content: "upload fixture only",
      });
    });
    await check("download exact file and one request", async () => {
      const { result: download } = await call("click", {
        elementId: await find("Download fixture", "link"),
      });
      row.downloadResult = download.downloads;
      const file = download.downloads?.[0];
      assert.equal(file?.state, "completed", JSON.stringify(download));
      assert.equal(file.name, source.downloadName);
      assert.ok(file.file);
      row.download = {
        name: file.name,
        content: await readFile(file.file, "utf8"),
      };
      // Remove only the exact uniquely named fixture file returned by this action.
      await rm(file.file);
      assert.equal(row.download.content, "download fixture only");
      assert.equal(
        (await (await fetch(`${source.url}advanced/state`)).json()).downloads,
        1,
      );
    });
  }
  await check("owned browser disconnect and explicit reconnect", async () => {
    const { result: listed } = await call("list_windows", { maxWindows: 1 });
    const owned = listed.browserLane.browsers.find((x) =>
      x.tabs.some((t) => t.id === tab),
    );
    assert.ok(owned?.processId);
    // Owned headless fixture process only; never terminate by executable name.
    try {
      await run("taskkill.exe", ["/PID", String(owned.processId), "/T", "/F"]);
    } catch (error) {
      row.disconnectKillWarning = error.stderr ?? String(error);
    }
    let remaining;
    const deadline = Date.now() + 5000;
    do {
      const { result: discovered } = await call("list_windows", {
        maxWindows: 1,
      });
      row.disconnectDiscovery = discovered.browserLane;
      remaining = discovered.browserLane?.browsers;
      if (!Array.isArray(remaining)) {
        assert.match(
          JSON.stringify(discovered.browserLane),
          /DISCONNECT|closed|connect/i,
        );
        row.disconnectDiscoveryInconclusive = true;
        remaining = [];
      }
      if (!remaining.some((x) => x.tabs.some((t) => t.id === tab))) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    } while (Date.now() < deadline);
    assert.ok(!remaining.some((x) => x.tabs.some((t) => t.id === tab)));
    const stale = await rejected("accessibility_tree", { browserTab: tab });
    assert.match(String(stale.error), /STALE|TAB_NOT_FOUND|DISCONNECT|closed/i);
    row.reconnect = {
      oldId: tab,
      oldTabRejected: true,
      stale,
      discoveryInconclusive: row.disconnectDiscoveryInconclusive ?? false,
    };
    const { result: reopened } = await call("set_value", {
      elementId: "new-tab",
      value: `${source.url}child`,
    });
    const fresh = (reopened.tab ?? reopened.opened).id;
    assert.notEqual(fresh, tab);
    assert.match(await tree(fresh), /Child fixture/);
    const { result: reconnectedListing } = await call("list_windows", {
      maxWindows: 1,
    });
    row.ownedProcessIds.push(
      reconnectedListing.browserLane.browsers.find((x) =>
        x.tabs.some((t) => t.id === fresh),
      ).processId,
    );
    row.reconnect.newId = fresh;
  });
  await check("cancel a passive browser wait without replay", async () => {
    const controller = new AbortController();
    const started = performance.now();
    const pending = rawCall(
      "wait_for",
      {
        browserTab: row.reconnect.newId,
        condition: "text",
        query: "absent cancellation marker",
        timeoutMs: 10000,
      },
      controller.signal,
    );
    const timer = setTimeout(() => controller.abort(), 200);
    try {
      row.cancellation = { result: await pending };
    } catch (error) {
      row.cancellation = { error: String(error) };
    } finally {
      clearTimeout(timer);
    }
    row.cancellation.durationMs = Math.round(performance.now() - started);
    assert.match(JSON.stringify(row.cancellation), /CANCEL|STOP|abort/i);
    assert.ok(row.cancellation.durationMs < 8000);
  });
  row.desktop = { before, after: await desktop() };
  row.desktop.preservation =
    JSON.stringify(row.desktop.after) === JSON.stringify(before)
      ? "preserved"
      : "inconclusive";
  if (row.desktop.preservation === "inconclusive")
    row.desktop.note =
      "Desktop changed during passive run; tool versus user/environment attribution is unproven";
}
