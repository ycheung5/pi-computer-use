import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const WINDOWS_NODE_VERSION = "22.23.4";
const checksums = {
  x64: "dccc52de28d8df2ee22d2062424f8c563070d95d8ad70c54c4bf01d590dec14f",
  arm64: "64d9f6e69b4703870e8cd30a3477127df8b683ea04feb03660e439396549042a",
} as const;

export interface RuntimeOptions {
  directory: string;
  architecture: string;
  signal?: AbortSignal;
  download?: typeof fetch;
}

function verify(bytes: Uint8Array, checksum: string): void {
  if (createHash("sha256").update(bytes).digest("hex") !== checksum) {
    throw new Error(
      "RUNTIME_CHECKSUM_MISMATCH: private Windows Node is corrupt; remove the runtime cache and retry on a trusted connection",
    );
  }
}

export async function provisionRuntime(
  options: RuntimeOptions,
): Promise<string> {
  const { architecture, directory, signal } = options;
  if (architecture !== "x64" && architecture !== "arm64") {
    throw new Error(
      `UNSUPPORTED_ARCHITECTURE: Windows ${architecture}; supported: x64, arm64`,
    );
  }
  signal?.throwIfAborted();
  const folder = join(
    directory,
    `node-${WINDOWS_NODE_VERSION}-win-${architecture}`,
  );
  const executable = join(folder, "node.exe");
  const checksum = checksums[architecture];
  try {
    const bytes = await readFile(executable);
    signal?.throwIfAborted();
    verify(bytes, checksum);
    return executable;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
  }
  const timeout = AbortSignal.timeout(120_000);
  const downloadSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const response = await (options.download ?? fetch)(
    `https://nodejs.org/dist/v${WINDOWS_NODE_VERSION}/win-${architecture}/node.exe`,
    { signal: downloadSignal },
  );
  if (!response.ok || !response.body) {
    throw new Error(
      `RUNTIME_DOWNLOAD_FAILED: HTTP ${response.status}; allow HTTPS access to nodejs.org and retry`,
    );
  }
  const parts: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of response.body) {
    downloadSignal.throwIfAborted();
    size += chunk.byteLength;
    if (size > 128 * 1024 * 1024)
      throw new Error("RUNTIME_DOWNLOAD_FAILED: executable exceeds 128 MiB");
    parts.push(chunk);
  }
  const bytes = Buffer.concat(parts);
  verify(bytes, checksum);
  downloadSignal.throwIfAborted();
  await mkdir(folder, { recursive: true });
  const temporary = join(folder, `node-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, bytes, { flag: "wx" });
    signal?.throwIfAborted();
    try {
      await rename(temporary, executable);
    } catch (error) {
      // A concurrent Pi session may have installed the same pinned runtime.
      if (
        !(
          error instanceof Error &&
          "code" in error &&
          (error.code === "EEXIST" || error.code === "EPERM")
        )
      )
        throw error;
      verify(await readFile(executable), checksum);
    }
  } finally {
    await rm(temporary, { force: true });
  }
  return executable;
}
