import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { release } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { WorkerLaunch } from "./client.js";
import { provisionRuntime } from "./runtime.js";

const run = promisify(execFile);

async function wslWorkerLaunch(
  worker: string,
  signal?: AbortSignal,
): Promise<WorkerLaunch> {
  const script = `[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); @{ localData=$env:LOCALAPPDATA; architecture=$env:PROCESSOR_ARCHITECTURE } | ConvertTo-Json -Compress`;
  let environment: { localData: string; architecture: string };
  try {
    const result = await run(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        Buffer.from(script, "utf16le").toString("base64"),
      ],
      { signal, timeout: 15_000, maxBuffer: 1024 * 1024 },
    );
    environment = JSON.parse(result.stdout.trim());
    if (!environment.localData || !environment.architecture)
      throw new Error("Windows environment is incomplete");
  } catch (error) {
    signal?.throwIfAborted();
    throw new Error(
      "WSL_BOOTSTRAP_FAILED: enable Windows executable interop and ensure powershell.exe is on PATH",
      { cause: error },
    );
  }
  const translate = async (mode: "-u" | "-w", path: string) =>
    (
      await run("wslpath", [mode, path], { signal, timeout: 5000 })
    ).stdout.trim();
  const localData = await translate("-u", environment.localData);
  const architecture =
    environment.architecture === "AMD64"
      ? "x64"
      : environment.architecture === "ARM64"
        ? "arm64"
        : environment.architecture;
  const executable = await provisionRuntime({
    directory: join(localData, "pi-computer-use", "runtime"),
    architecture,
    signal,
  });
  const windowsWorker = await translate("-w", worker);
  return { executable, args: [windowsWorker], cwd: localData };
}

export async function nativeWorkerLaunch(
  signal?: AbortSignal,
): Promise<WorkerLaunch> {
  signal?.throwIfAborted();
  const wsl =
    process.platform === "linux" && /microsoft.*wsl2/i.test(release());
  if (process.platform !== "win32" && !wsl) {
    throw new Error(
      "UNSUPPORTED_HOST: computer use requires native Windows or WSL2 with Windows interop",
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
  if (wsl) return wslWorkerLaunch(worker, signal);
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
  return { executable, args: [worker], cwd: localData };
}
