import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { provisionRuntime } from "../src/runtime.js";

test("untrusted runtime downloads are rejected and never installed", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-cu-runtime-"));
  try {
    await assert.rejects(
      provisionRuntime({
        directory,
        architecture: "x64",
        download: async () => new Response("not a node executable"),
      }),
      /RUNTIME_CHECKSUM_MISMATCH/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
