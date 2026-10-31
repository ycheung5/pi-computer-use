// Dedicated cookie origin and storage root; no daily profiles or real sign-ins.
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = await mkdtemp(join(tmpdir(), "pi-browser-profiles-"));
const root = join(directory, "profiles");
const settings = join(directory, "settings.json");
await writeFile(
  settings,
  JSON.stringify({
    browserApp: process.argv[2] ?? "edge",
    browserVisible: false,
    browserSignIn: true,
  }),
);
const server = createServer(async (request, response) => {
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  if (request.url === "/set")
    response.setHeader(
      "Set-Cookie",
      "pi_profile_fixture=remembered; Path=/; Max-Age=3600; HttpOnly; SameSite=Lax",
    );
  const remembered = request.headers.cookie?.includes(
    "pi_profile_fixture=remembered",
  );
  if (request.url === "/storage") {
    const entries = await readdir(root).catch(() => []);
    response.end(`<h1>Profile storage</h1><p>${entries.join(" ")}</p>`);
  } else
    response.end(
      `<h1>Profile fixture</h1><p>Cookie: ${remembered ? "remembered" : "missing"}</p>`,
    );
});
server.listen(0, "127.0.0.1", () =>
  console.log(
    JSON.stringify({
      url: `http://127.0.0.1:${server.address().port}`,
      settings,
      root,
    }),
  ),
);
process.stdin.resume();
process.stdin.on("end", () =>
  server.close(async () => {
    await rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  }),
);
