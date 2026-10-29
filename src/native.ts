import { AsyncLocalStorage } from "node:async_hooks";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WorkerClient, type WorkerLaunch } from "./client.js";
import type { WorkerResult } from "./protocol.js";

export async function compileNative(
  sourceNames: string[],
  references: string[] = [],
  signal?: AbortSignal,
): Promise<WorkerLaunch> {
  if (process.platform !== "win32")
    throw new Error("UNSUPPORTED_HOST: native desktop access requires Windows");
  const sources = sourceNames.map((name) =>
    fileURLToPath(new URL(`../assets/${name}`, import.meta.url)),
  );
  const digest = createHash("sha256");
  for (const source of sources) {
    digest.update(source);
    digest.update(await readFile(source));
  }
  digest.update(references.join("\n"));
  const hash = digest.digest("hex").slice(0, 20);
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
          ...references.map((reference) => `/r:${reference}`),
          ...sources,
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

let inputPending = false;
export function retainInput(): void {
  inputPending = true;
}
export function confirmInputCleanup(): void {
  inputPending = false;
}

const operationContext = new AsyncLocalStorage<string>();
export function runNativeOperation<T>(operationId: string, action: () => T): T {
  return operationContext.run(operationId, action);
}
class NativeDesktopClient extends WorkerClient {
  override execute(
    action: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
    operationId = operationContext.getStore(),
  ): Promise<WorkerResult> {
    return super.execute(action, args, signal, operationId);
  }
}
export const nativeDesktop = new NativeDesktopClient({
  launch: async (signal) => {
    const names = ["windows.cs"];
    for (const name of [
      "accessibility.cs",
      "capture.cs",
      "controls.cs",
      "window-management.cs",
      "pointer.cs",
      "text.cs",
    ]) {
      try {
        await access(
          fileURLToPath(new URL(`../assets/${name}`, import.meta.url)),
        );
        names.push(name);
      } catch {
        /* Optional capability source is absent in an earlier package slice. */
      }
    }
    const framework = join(
      process.env.WINDIR ?? "",
      "Microsoft.NET",
      "Framework64",
      "v4.0.30319",
    );
    return compileNative(
      names,
      [
        "System.Drawing.dll",
        "Microsoft.CSharp.dll",
        "System.Windows.Forms.dll",
        ...[
          "WindowsBase.dll",
          "UIAutomationClient.dll",
          "UIAutomationTypes.dll",
        ].map((name) => join(framework, "WPF", name)),
      ],
      signal,
    );
  },
  timeoutMs: 40_000,
  canTerminate: () => !inputPending,
});
