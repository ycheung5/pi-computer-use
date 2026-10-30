// Test-only adapter; callers must gate physical input before constructing a client.
import { fileURLToPath } from "node:url";

export async function createComparisonClient({
  engine = "pi",
  referencePath,
  cwd,
}) {
  if (engine === "reference") {
    const { ReferenceClient, referenceResult } = await import(
      "./reference-client.mjs"
    );
    const client = new ReferenceClient(referencePath, { cwd });
    try {
      await client.init();
    } catch (error) {
      await client.close();
      throw error;
    }
    return {
      async execute(action, args, signal) {
        const raw = await client.call(action, args, signal);
        const result = referenceResult(raw);
        // Retain the entire MCP response, including isError and non-JSON blocks.
        return {
          ...result,
          ...(action === "find" &&
          result.matches === undefined &&
          Array.isArray(result.results)
            ? { matches: result.results }
            : {}),
          ...(raw.isError ? { ok: false } : {}),
          mcpResult: raw,
        };
      },
      dispose: () => client.close(),
    };
  }
  if (engine !== "pi") throw new Error(`Unknown comparison engine: ${engine}`);
  const { WorkerClient } = await import("../dist/client.js");
  return new WorkerClient({
    launch: async () => ({
      executable: process.execPath,
      args: [fileURLToPath(new URL("../dist/worker.js", import.meta.url))],
      cwd,
    }),
  });
}
