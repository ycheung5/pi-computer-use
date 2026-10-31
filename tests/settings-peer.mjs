// Windows peer for the disposable cross-host personal-settings fixture.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { WorkerClient } from "../dist/client.js";

const literalData = 'C:\\Fixture & 資料 "quoted"';
const environment = execFileSync(
  "cmd.exe",
  ["/u", "/d", "/c", "set LOCALAPPDATA & set PROCESSOR_ARCHITECTURE"],
  {
    env: {
      ...process.env,
      LOCALAPPDATA: literalData,
      PROCESSOR_ARCHITECTURE: "AMD64",
    },
  },
).toString("utf16le");
const fields = new Map(
  environment.split(/\r?\n/u).map((line) => {
    const equals = line.indexOf("=");
    return [line.slice(0, equals), line.slice(equals + 1)];
  }),
);
assert.equal(
  fields.get("LOCALAPPDATA"),
  literalData,
  "fixed variable query preserves Unicode and shell characters as data",
);
assert.equal(fields.get("PROCESSOR_ARCHITECTURE"), "AMD64");
process.env.PI_CU_SETTINGS_FILE = process.argv[2];
const worker = new WorkerClient({
  launch: async () => ({
    executable: process.execPath,
    args: [fileURLToPath(new URL("../dist/worker.js", import.meta.url))],
    cwd: process.env.TEMP,
  }),
});
try {
  const changes = JSON.parse(process.argv[3] ?? "null");
  const result = await worker.execute(
    changes ? "settings_update" : "settings_get",
    changes ? { changes } : {},
  );
  console.log(JSON.stringify(result));
} finally {
  await worker.dispose();
}
