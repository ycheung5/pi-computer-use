// Normal helper protocol, no input and both visual channels disabled.
import assert from "node:assert/strict";
import { WorkerClient } from "../dist/client.js";
import { compileNative } from "../dist/native.js";
import { DEFAULT_SETTINGS } from "../dist/settings.js";

const helper = new WorkerClient({
  launch: (signal) =>
    compileNative(
      ["stop.cs", "indicators.cs"],
      ["System.Drawing.dll", "System.Windows.Forms.dll"],
      signal,
    ),
});
const operationId = `indicator-peer-${process.pid}`;
try {
  assert.equal(
    (
      await helper.execute("configure", {
        settings: {
          ...DEFAULT_SETTINGS,
          indicatorEnabled: false,
          cursorIndicatorEnabled: false,
          indicatorIdleMs: 200,
        },
      })
    ).ok,
    true,
  );
  assert.equal(
    (
      await helper.execute("arm", {
        operationId,
        cancelEvent: `Local\\PiIndicatorPeer-${process.pid}`,
      })
    ).ok,
    true,
  );
  const begun = await helper.execute("begin", { operationId });
  assert.equal(begun.presentation.held, true);
  assert.equal(begun.presentation.visible, false);
  const touched = await helper.execute("touch", { operationId });
  assert.equal(
    touched.presentation.held,
    true,
    "quiet activity retains the established operation indicator lease",
  );
  const suspended = await helper.execute("capture", { suspended: true });
  assert.equal(suspended.presentation.held, true);
  assert.equal(
    suspended.armed,
    true,
    "capture suppression never disarms emergency stopping",
  );
  assert.equal(suspended.presentation.suspended, true);
  const resumed = await helper.execute("capture", { suspended: false });
  assert.equal(resumed.presentation.held, true);
  assert.equal(resumed.presentation.suspended, false);
  const ended = await helper.execute("disarm", { operationId });
  assert.equal(ended.presentation.held, false);
  assert.equal(ended.presentation.endDelayMs, 200);
  assert.equal(ended.armed, false);
  console.log(
    JSON.stringify({
      ok: true,
      operationLeaseRetained: true,
      captureKeepsStopArmed: true,
      endDelay: true,
      physicalInput: false,
    }),
  );
} finally {
  await helper.dispose();
}
