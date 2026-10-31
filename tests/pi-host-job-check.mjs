import assert from "node:assert/strict";
import { verifyHostJob } from "./pi-host-job-outcome.mjs";

const report = {
  jobEmpty: true,
  members: [
    { pid: 42, name: "node" },
    { pid: 43, name: "node" },
    { pid: 44, name: "windows" },
  ],
  piHostPid: 42,
  workerPid: 43,
  healthOk: true,
  observationAttempted: true,
  waitOk: true,
  settled: true,
  piExit: 0,
};
assert.equal(verifyHostJob(report).ok, true);
for (const v of [
  { jobEmpty: false },
  { workerPid: 99 },
  { piHostPid: 99 },
  { piHostPid: 43 },
  {
    members: [
      { pid: 42, name: "node" },
      { pid: 43, name: "node" },
    ],
  },
  { healthOk: false },
  { observationAttempted: false },
  { waitOk: false },
  { settled: false },
  { piExit: 1 },
])
  assert.equal(verifyHostJob({ ...report, ...v }).ok, false, JSON.stringify(v));
console.log("Pi host job outcome checks passed");
