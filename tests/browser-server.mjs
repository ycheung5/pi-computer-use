// Dedicated local browser fixture; no external requests or user profiles.
import { createServer } from "node:http";

const server = createServer((request, response) => {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(
    request.url === "/second"
      ? "<!doctype html><title>Second fixture</title><h1>Replacement document</h1>"
      : '<!doctype html><title>Pi browser fixture</title><h1>Fixture heading</h1><label>Fixture editor<input value="fixture text"></label><button>Fixture action</button><p>Fixture visible content</p>',
  );
});
server.listen(0, "127.0.0.1", () =>
  console.log(`http://127.0.0.1:${server.address().port}/`),
);
process.stdin.resume();
process.stdin.on("end", () => server.close());
