import { WorkerClient } from "./client.js";
import { compileNative } from "./native.js";
import type { WorkerResult } from "./protocol.js";

const control = new WorkerClient({
  launch: (signal) => compileNative(["ownership.cs"], [], signal),
});
let held: string | undefined;

export async function acquireDesktop(
  operationId: string,
  signal?: AbortSignal,
): Promise<WorkerResult> {
  const result = await control.execute("acquire", { operationId }, signal);
  if (result.ok) held = operationId;
  return result;
}

export async function releaseDesktop(
  operationId: string,
): Promise<WorkerResult> {
  if (held !== operationId)
    return { ok: true, action: "operation_end", released: false };
  const result = await control.execute("release", { operationId });
  if (result.ok) held = undefined;
  return { ...result, action: "operation_end" };
}

export async function disposeOwnership(): Promise<void> {
  await control.dispose();
  held = undefined;
}
