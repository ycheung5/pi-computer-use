import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WorkerClient, type WorkerLaunch } from "./client.js";

async function compile(signal?: AbortSignal): Promise<WorkerLaunch> {
  if (process.platform !== "win32")
    throw new Error("UNSUPPORTED_HOST: native desktop access requires Windows");
  const source = fileURLToPath(
    new URL("../assets/windows.cs", import.meta.url),
  );
  const hash = createHash("sha256")
    .update(await readFile(source))
    .digest("hex")
    .slice(0, 20);
  const data = process.env.LOCALAPPDATA;
  const windows = process.env.WINDIR;
  if (!data || !windows)
    throw new Error(
      "NATIVE_SETUP_FAILED: LOCALAPPDATA and WINDIR are required",
    );
  const directory = join(data, "pi-computer-use", "native", hash);
  const executable = join(directory, "windows.exe");
  try {
    await access(executable);
    return { executable, args: [], cwd: directory };
  } catch {
    /* Compile this package's native source once per content version. */
  }
  const compiler = join(
    windows,
    "Microsoft.NET",
    "Framework64",
    "v4.0.30319",
    "csc.exe",
  );
  try {
    await access(compiler);
  } catch {
    throw new Error(
      "NATIVE_COMPILER_MISSING: Windows .NET Framework64 csc.exe is unavailable",
    );
  }
  signal?.throwIfAborted();
  await mkdir(directory, { recursive: true });
  const temporary = join(directory, `windows-${randomUUID()}.exe`);
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        compiler,
        [
          "/nologo",
          "/target:exe",
          `/out:${temporary}`,
          "/r:System.Web.Extensions.dll",
          source,
        ],
        {
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
          cwd: dirname(compiler),
          signal,
        },
      );
      let diagnostic = "";
      for (const stream of [child.stdout, child.stderr])
        stream.on("data", (chunk) => {
          diagnostic = (diagnostic + chunk).slice(-4096);
        });
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error("NATIVE_COMPILE_TIMEOUT"));
      }, 30_000);
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        code === 0
          ? resolve()
          : reject(new Error(`NATIVE_COMPILE_FAILED: ${diagnostic.trim()}`));
      });
    });
    signal?.throwIfAborted();
    try {
      await rename(temporary, executable);
    } catch (error) {
      if (
        !(
          error instanceof Error &&
          "code" in error &&
          (error.code === "EEXIST" || error.code === "EPERM")
        )
      )
        throw error;
      await access(executable);
    }
    return { executable, args: [], cwd: directory };
  } finally {
    await rm(temporary, { force: true });
  }
}

export const nativeDesktop = new WorkerClient({
  launch: compile,
  timeoutMs: 25_000,
});
