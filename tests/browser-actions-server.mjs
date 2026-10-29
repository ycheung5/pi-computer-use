// Disposable local pages/files only; no external network or daily profiles.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

const folder = await mkdtemp(join(tmpdir(), "pi-browser-actions-"));
const upload = join(folder, "fixture-upload.txt");
await writeFile(upload, "upload fixture only");
const settings = join(folder, "settings.json");
await writeFile(
  settings,
  JSON.stringify({
    browserApp: process.argv[2] ?? "edge",
    browserVisible: process.argv[3] === "true",
    browserSignIn: false,
  }),
);
const html = `<!doctype html><title>Browser action fixture</title>
<h1>Browser action fixture</h1><p id="count">Count: 0</p><button id="increment" onclick="count.textContent='Count: '+(++window.counter)">Increment</button>
<button onclick="document.elementFromPoint=()=>increment;cover.hidden=false">Cover target</button><button id="cover" hidden style="position:fixed;inset:0;z-index:100;background:white" onclick="cover.hidden=true">Remove cover</button>
<label>Multiline<textarea></textarea></label><input type="file" aria-label="Direct upload"><label>Editor<input id="editor" value="initial"></label><label>Read only<input readonly value="locked"></label><button disabled>Disabled action</button>
<label>Color<select id="colors"><option value="red">Red</option><option value="green">Green</option><option disabled>Unavailable</option></select></label><label>Accept checkbox<input id="check" type="checkbox"></label>
<label>Date field<input type="date" value="2026-01-01"></label>
<button onclick="answer.textContent='Prompt: '+prompt('Fixture prompt','default')">Prompt action</button><p id="answer">No prompt yet</p>
<button onclick="answer.textContent='Confirm: '+confirm('Fixture confirm')">Confirm action</button>
<button onclick="alert('Fixture alert')">Alert action</button>
<input id="file" type="file" hidden onchange="uploaded.textContent='Uploaded: '+this.files[0].name"><button onclick="file.click()">Upload fixture</button><p id="uploaded">No file</p>
<a href="/download" download>Download fixture</a><a href="/child" target="_blank">Open child</a>
<button onclick="setTimeout(()=>delayed.textContent='Delayed result',200)">Start delayed</button><p id="delayed">Waiting</p>
<div style="height:1800px"></div><p>Bottom fixture</p><script>window.counter=0</script>`;
const server = createServer((request, response) => {
  if (request.url === "/download") {
    response.writeHead(200, {
      "content-type": "text/plain",
      "content-disposition": "attachment; filename=fixture-download.txt",
    });
    response.end("download fixture only");
  } else {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(
      request.url === "/child"
        ? "<!doctype html><title>Child fixture</title><h1>Child fixture</h1>"
        : html,
    );
  }
});
server.listen(0, "127.0.0.1", () =>
  console.log(
    JSON.stringify({
      url: `http://127.0.0.1:${server.address().port}/`,
      upload,
      settings,
    }),
  ),
);
process.stdin.resume();
process.stdin.on("end", () =>
  server.close(async () => {
    await rm(folder, { recursive: true, force: true });
  }),
);
