// Public MCP transport regression; initializes/lists only, no desktop actions.
import assert from "node:assert/strict";
import { ReferenceClient } from "./reference-client.mjs";
const client = new ReferenceClient(process.argv[2]);
try {
  const initialized = await client.init();
  assert.ok(initialized.serverInfo);
  const listed = await client.request("tools/list", {});
  assert.equal(listed.tools.length, 25);
  const invalid = await client.call("not_a_tool", {});
  assert.equal(invalid.isError, true);
  assert.ok(invalid.content.some((item) => item.type === "text" && item.text));
  console.log(
    JSON.stringify({
      ok: true,
      check: "reference MCP transport",
      tools: 25,
      rawErrorRetained: true,
    }),
  );
} finally {
  await client.close();
}
