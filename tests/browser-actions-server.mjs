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
<label>Password<input type="password" value="fixture-secret-value"></label><label>Multiline<textarea></textarea></label><input type="file" aria-label="Direct upload"><label>Editor<input id="editor" value="initial"></label><label>Read only<input readonly value="locked"></label><button disabled>Disabled action</button>
<label>Alias keys<textarea onkeydown="keyevents.textContent='Key:'+event.key;event.preventDefault()"></textarea></label><p id="keyevents">Key:none</p>
<label>Color<select id="colors"><option value="red">Red</option><option value="green">Green</option><option disabled>Unavailable</option></select></label><label>Accept checkbox<input id="check" type="checkbox"></label>
<label>Date field<input type="date" value="2026-01-01"></label>
<button onclick="answer.textContent='Prompt: '+prompt('Fixture prompt','default')">Prompt action</button><p id="answer">No prompt yet</p>
<button onclick="answer.textContent='Confirm: '+confirm('Fixture confirm')">Confirm action</button>
<button onclick="alert('Fixture alert')">Alert action</button>
<input id="file" type="file" hidden onchange="uploaded.textContent='Uploaded: '+this.files[0].name"><button onclick="file.click()">Upload fixture</button><p id="uploaded">No file</p>
<a href="/download" download>Download fixture</a><a href="/child" target="_blank">Open child</a>
<button onclick="setTimeout(()=>delayed.textContent='Delayed result',200)">Start delayed</button><p id="delayed">Waiting</p>
<div style="height:1800px"></div><p>Bottom fixture</p><script>window.counter=0</script>`;
let formSubmission = null;
const formHtml = `<!doctype html><meta charset="utf-8"><title>Paired browser form fixture</title>
<h1>Paired browser form fixture</h1>
<form id="form"><label>Name<input id="name"></label>
<label>Notes<textarea id="notes"></textarea></label>
<label>Accept terms<input id="accepted" type="checkbox"></label>
<label>Choice<select id="choice"><option value="alpha">Alpha</option><option value="beta">Beta</option></select></label>
<label>Disabled field<input disabled value="Disabled value"></label>
<label>Read-only field<input readonly value="Read-only value"></label>
<button>Submit form</button></form><pre id="result">Not submitted</pre>
<button id="delayedButton" onclick="delayed.textContent='Pending';setTimeout(()=>delayed.textContent='Delayed result ready',300)">Start delayed result</button>
<p id="delayed">Not started</p><div style="height:1600px"></div><p>Form bottom marker</p>
<script>form.addEventListener('submit',async event=>{event.preventDefault();
const payload={name:document.getElementById('name').value,notes:notes.value,accepted:accepted.checked,choice:choice.value};
const response=await fetch('/form/submit',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
result.textContent=JSON.stringify(await response.json());});</script>`;
const server = createServer((request, response) => {
  if (request.url === "/form/state") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(formSubmission));
  } else if (request.url === "/form/submit" && request.method === "POST") {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      formSubmission = JSON.parse(body);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(formSubmission));
    });
  } else if (request.url === "/form") {
    formSubmission = null;
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(formHtml);
  } else if (request.url === "/download") {
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
