// Disposable local pages/files only; no external network or daily profiles.

import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { connect } from "node:net";
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
const mixedConfig = process.argv[4] ?? process.env.PI_CU_MIXED_FIXTURE;
const mixed = mixedConfig ? JSON.parse(mixedConfig) : null;
let issuedCode = null,
  confirmations = 0;
const mixedPayload = {
  name: "Mixed task 中文 café 😀",
  notes: "Browser to native",
  accepted: true,
  choice: "beta",
};
async function mixedOracle() {
  return new Promise((resolve, reject) => {
    const socket = connect(mixed.pipe);
    let data = "";
    const timer = setTimeout(
      () => socket.destroy(Error("owned fixture unavailable")),
      10000,
    );
    socket.on("connect", () =>
      socket.write(JSON.stringify({ action: "oracle" }) + "\n"),
    );
    socket.on("data", (bytes) => (data += bytes));
    socket.on("error", reject);
    socket.on("close", () => clearTimeout(timer));
    socket.on("end", () => {
      try {
        const o = JSON.parse(data);
        if (
          o.ok !== true ||
          ["pid", "creation", "executable"].some(
            (k) => o.identity?.[k] !== mixed.identity[k],
          )
        )
          throw Error("owned fixture changed");
        resolve(o);
      } catch (error) {
        reject(error);
      }
    });
  });
}
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
let formEvents = { starts: 0, ready: 0, submissions: 0 };
const formHtml = `<!doctype html><meta charset="utf-8"><title>Paired browser form fixture</title>
<h1>Paired browser form fixture</h1>
<form id="form"><label>Name<input id="name"></label>
<label>Notes<textarea id="notes"></textarea></label>
<label>Accept terms<input id="accepted" type="checkbox"></label>
<label>Choice<select id="choice"><option value="alpha">Alpha</option><option value="beta">Beta</option></select></label>
<label>Disabled field<input disabled value="Disabled value"></label>
<label>Read-only field<input readonly value="Read-only value"></label>
<button>Submit form</button></form><pre id="result"${mixed ? ' role="status" aria-label="Form confirmation pending"' : ""}>Not submitted</pre>
<button id="delayedButton" onclick="delayed.textContent='Pending';fetch('/form/delayed/start',{method:'POST'}).then(()=>setTimeout(()=>fetch('/form/delayed/ready',{method:'POST'}).then(()=>delayed.textContent='Delayed result ready'),300))">Start delayed result</button>
<p id="delayed">Not started</p><div style="height:1600px"></div><p>Form bottom marker</p>
<script>form.addEventListener('submit',async event=>{event.preventDefault();
const payload={name:document.getElementById('name').value,notes:notes.value,accepted:accepted.checked,choice:choice.value};
const response=await fetch('/form/submit',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
result.textContent=JSON.stringify(await response.json());${mixed ? 'result.setAttribute("aria-label","Form confirmation: "+result.textContent);' : ""}});</script>${mixed ? `<p id="nativeAcknowledgement" role="status" aria-label="Native confirmation pending">Native confirmation pending</p><script>async function pollNative(){try{const s=await(await fetch('/mixed/state')).json();nativeAcknowledgement.textContent=s.acknowledgement;nativeAcknowledgement.setAttribute("aria-label",s.acknowledgement);}finally{setTimeout(pollNative,300)}}pollNative()</script>` : ""}`;
const downloadName = `pi-advanced-${randomUUID()}.txt`;
let advancedState = { upload: null, uploadRequests: 0, downloads: 0 };
const advancedHtml = `<!doctype html><meta charset="utf-8"><title>Advanced browser fixture</title>
<h1>Advanced browser fixture</h1><label>Document marker<input value="original document"></label>
<a href="/child" target="_blank">Open child</a>
<button onclick="answer.textContent='Prompt: '+prompt('Fixture prompt','default')">Prompt action</button>
<button onclick="answer.textContent='Confirm: '+confirm('Fixture confirm')">Confirm action</button>
<button onclick="alert('Fixture alert')">Alert action</button><p id="answer">No dialog yet</p>
<input type="file" aria-label="Direct upload"><input id="file" type="file" hidden onchange="receive(this.files[0])"><button onclick="file.click()">Upload fixture</button><p id="uploaded">No file</p>
<a href="/advanced/download" download="${downloadName}">Download fixture</a>
<script>async function receive(file){await fetch('/advanced/upload',{method:'POST',body:JSON.stringify({name:file.name,content:await file.text()})});uploaded.textContent='Uploaded: '+file.name;}</script>`;
const server = createServer(async (request, response) => {
  if (request.url === "/profile/set" || request.url === "/profile/read") {
    if (request.url === "/profile/set")
      response.setHeader(
        "Set-Cookie",
        "pi_advanced_profile=remembered; Path=/; Max-Age=3600; HttpOnly; SameSite=Lax",
      );
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(
      `<title>Owned synthetic profile fixture</title><h1>Profile fixture</h1><p>Cookie: ${request.headers.cookie?.includes("pi_advanced_profile=remembered") ? "remembered" : "missing"}</p>`,
    );
  } else if (request.url === "/advanced/state") {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(advancedState));
  } else if (request.url === "/advanced/upload" && request.method === "POST") {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      advancedState.upload = JSON.parse(body);
      advancedState.uploadRequests++;
      response.end("ok");
    });
  } else if (request.url === "/advanced/download") {
    advancedState.downloads++;
    response.writeHead(200, {
      "content-type": "text/plain",
      "content-disposition": `attachment; filename=${downloadName}`,
    });
    response.end("download fixture only");
  } else if (request.url === "/advanced") {
    advancedState = { upload: null, uploadRequests: 0, downloads: 0 };
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end(advancedHtml);
  } else if (mixed && request.url === "/mixed/state") {
    let acknowledgement = "Native confirmation pending";
    try {
      if (issuedCode) {
        const o = await mixedOracle();
        if (
          o.approve.code === issuedCode &&
          o.approve.count === 1 &&
          o.ignore.count === 0
        )
          acknowledgement = "Native confirmation complete: " + issuedCode;
      }
    } catch {
      response.statusCode = 503;
      acknowledgement = "Native confirmation unavailable";
    }
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ acknowledgement }));
  } else if (mixed && request.url === "/mixed/receipt") {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ issuedCode, confirmations }));
  } else if (request.url === "/form/delayed/state") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(formEvents));
  } else if (
    request.method === "POST" &&
    ["/form/delayed/start", "/form/delayed/ready"].includes(request.url)
  ) {
    formEvents[request.url.endsWith("start") ? "starts" : "ready"]++;
    response.end("ok");
  } else if (request.url === "/form/state") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(formSubmission));
  } else if (request.url === "/form/submit" && request.method === "POST") {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", async () => {
      const payload = JSON.parse(body);
      if (
        mixed &&
        (Object.keys(payload).length !== 4 ||
          Object.entries(mixedPayload).some(
            ([key, value]) => payload[key] !== value,
          ))
      ) {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(
          JSON.stringify({ error: "Exact mixed form payload required" }),
        );
        return;
      }
      if (mixed) {
        try {
          const o = await mixedOracle();
          issuedCode = o.approve.code;
          if (!/^\d{4}$/.test(issuedCode)) throw Error("invalid fixture code");
          confirmations++;
        } catch {
          response.writeHead(503, { "content-type": "application/json" });
          response.end(JSON.stringify({ error: "Owned fixture unavailable" }));
          return;
        }
      }
      formSubmission = payload;
      formEvents.submissions++;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify(
          mixed
            ? { ...formSubmission, confirmationCode: issuedCode }
            : formSubmission,
        ),
      );
    });
  } else if (request.url === "/form") {
    if (mixed) issuedCode = null;
    formSubmission = null;
    formEvents = { starts: 0, ready: 0, submissions: 0 };
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
      downloadName,
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
