import { access } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { WorkerLaunch } from "./client.js";
import { provisionRuntime } from "./runtime.js";

export async function nativeWorkerLaunch(
  signal?: AbortSignal,
): Promise<WorkerLaunch> {
  signal?.throwIfAborted();
  if (process.platform !== "win32") {
    throw new Error(
      "UNSUPPORTED_HOST: this launcher requires Windows; WSL2 launch support is a separate implementation ticket",
    );
  }
  const worker = fileURLToPath(new URL("./worker.js", import.meta.url));
  try {
    await access(worker);
  } catch {
    throw new Error(
      "WORKER_ASSET_MISSING: install the built package, or run npm run build in a checkout",
    );
  }
  const localData = process.env.LOCALAPPDATA;
  if (!localData)
    throw new Error(
      "WINDOWS_DATA_DIRECTORY_MISSING: LOCALAPPDATA is required for the private runtime cache",
    );
  const executable = await provisionRuntime({
    directory: join(localData, "pi-computer-use", "runtime"),
    architecture: process.arch,
    signal,
  });
  return { executable, args: [worker] };
}
