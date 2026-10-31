// Dedicated local browser fixture; no external requests or user profiles.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = await mkdtemp(join(tmpdir(), "pi-browser-read-"));
const settings = join(directory, "settings.json");
await writeFile(
  settings,
  JSON.stringify({
    browserApp: process.argv[2] ?? "edge",
    browserVisible: process.argv[3] === "true",
    browserSignIn: false,
  }),
);

const server = createServer((request, response) => {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(
    request.url === "/second"
      ? "<!doctype html><title>Second fixture</title><h1>Replacement document</h1>"
      : '<!doctype html><title>Pi browser fixture</title><h1>Fixture heading</h1><label>Fixture editor<input value="fixture text"></label><label>Disabled editor<input disabled value="disabled text"></label><label>Read-only editor<input readonly value="read-only text"></label><label>ARIA disabled editor<input aria-disabled="true" value="aria-disabled text"></label><label>ARIA read-only editor<input aria-readonly="true" value="aria-read-only text"></label><label>Checkbox with ignored readonly<input type="checkbox" readonly></label><button>Fixture action</button><p>Fixture visible content</p>',
  );
});
server.listen(0, "127.0.0.1", () =>
  console.log(
    JSON.stringify({
      url: `http://127.0.0.1:${server.address().port}/`,
      settings,
    }),
  ),
);
process.stdin.resume();
process.stdin.on("end", () =>
  server.close(async () => {
    await rm(directory, { recursive: true, force: true });
  }),
);
