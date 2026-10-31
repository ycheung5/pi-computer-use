export function verifyHostJob(report) {
  const {
    jobEmpty,
    members,
    piHostPid,
    workerPid,
    healthOk,
    observationAttempted,
    waitOk,
    settled,
    piExit,
  } = report;
  return {
    ok:
      jobEmpty === true &&
      Number.isSafeInteger(piHostPid) &&
      piHostPid !== workerPid &&
      Array.isArray(members) &&
      members.some(
        (x) => x.pid === piHostPid && x.name.toLowerCase() === "node",
      ) &&
      members.some(
        (x) => x.pid === workerPid && x.name.toLowerCase() === "node",
      ) &&
      members.some((x) => x.name.toLowerCase() === "windows") &&
      healthOk === true &&
      observationAttempted === true &&
      waitOk === true &&
      settled === true &&
      piExit === 0,
  };
}
