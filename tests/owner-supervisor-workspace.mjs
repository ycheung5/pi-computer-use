// A supervisor may deliberately remain alive when cleanup is unconfirmed.
// Never impose an outer timeout or delete its owned files in that state.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function ownerWorkspace(prefix) {
  const folder = mkdtempSync(join(tmpdir(), prefix));
  let settled = true;
  return {
    folder,
    run(exe, args) {
      settled = false;
      const run = spawnSync(exe, args, { encoding: "utf8", windowsHide: true });
      assert.equal(
        run.status,
        0,
        run.stdout + run.stderr + String(run.error ?? ""),
      );
      const report = JSON.parse(run.stdout.trim());
      assert.ok(["timeout", "root-exited"].includes(report.reason));
      assert.equal(report.activeProcesses, 0);
      assert.ok(
        Number.isInteger(report.totalProcesses) && report.totalProcesses >= 1,
      );
      settled = true;
      return report;
    },
    cleanup() {
      if (!settled) {
        console.error(
          `Owner cleanup unconfirmed; workspace retained: ${folder}`,
        );
        return false;
      }
      rmSync(folder, { recursive: true, force: true });
      return true;
    },
  };
}
