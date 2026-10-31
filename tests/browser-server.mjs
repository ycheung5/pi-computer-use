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
      : `<!doctype html><title>Pi browser fixture</title><h1>Fixture heading</h1><label>Fixture editor<input value="fixture text"></label><label>Disabled editor<input disabled value="disabled text"></label><label>Read-only editor<input readonly value="read-only text"></label><label>ARIA disabled editor<input id="aria-disabled-field" aria-disabled="true" value="aria-disabled text"></label><button id="aria-disabled-focus">Focus disabled top field</button><label>ARIA read-only editor<input aria-readonly="true" value="aria-read-only text"></label><label>ARIA read-only notes<textarea aria-readonly="true">fixed notes</textarea></label><label>ARIA read-only number<input type="number" aria-readonly="true" value="5"></label><label>ARIA read-only range<input type="range" aria-readonly="true" value="40"></label><label>ARIA read-only choice<select aria-readonly="true"><option>Alpha</option><option>Beta</option></select></label><label>ARIA read-only date<input type="date" aria-readonly="true" value="2026-10-31"></label><label>Checkbox with ignored readonly<input type="checkbox" readonly></label><button>Fixture action</button><p>Fixture visible content</p><div id="shadow-fixture"></div><button id="shadow-readonly">Focus shadow readonly</button><button id="shadow-editable">Focus shadow editable</button><button id="shadow-report-button">Report shadow values</button><p id="shadow-report">Shadow result pending</p><iframe id="fixture-frame" title="Fixture frame" srcdoc="&lt;input id='frame-readonly' aria-label='Frame readonly' aria-readonly='true' value='frame locked'&gt;&lt;input id='frame-editable' aria-label='Frame editable' value='frame edit'&gt;"></iframe><button id="frame-readonly-button">Focus frame readonly</button><button id="frame-editable-button">Focus frame editable</button><button id="frame-report-button">Report frame values</button><p id="frame-report">Frame result pending</p><div id="disabled-shadow-fixture" aria-disabled="true"></div><button id="disabled-shadow-focus">Focus disabled shadow</button><iframe id="disabled-frame" title="Disabled frame" aria-disabled="true" srcdoc="&lt;input id='disabled-inner' value='frame disabled'&gt;"></iframe><button id="disabled-frame-focus">Focus disabled frame</button><button id="disabled-report-button">Report disabled values</button><p id="disabled-report">Disabled result pending</p><iframe id="opaque-frame" title="Opaque frame" sandbox="allow-scripts" srcdoc="&lt;input id='opaque-field' value='opaque edit'&gt;&lt;script&gt;const e=document.getElementById('opaque-field');window.onmessage=()=>{e.focus();e.setSelectionRange(e.value.length,e.value.length);parent.postMessage('opaque-ready','*')};e.oninput=()=>parent.postMessage('opaque-value:'+e.value,'*')&lt;/script&gt;"></iframe><button id="opaque-focus">Focus opaque frame field</button><p id="opaque-report">Opaque result pending</p><script>document.getElementById("aria-disabled-focus").onclick=()=>document.getElementById("aria-disabled-field").focus();const root=document.getElementById("shadow-fixture").attachShadow({mode:"open"});root.innerHTML='<input id="shadow-readonly-field" aria-label="Shadow readonly" aria-readonly="true" value="shadow locked"><input id="shadow-editable-field" aria-label="Shadow editable" value="shadow edit">';const focusEnd=(e)=>{e.focus();e.setSelectionRange(e.value.length,e.value.length)};document.getElementById("shadow-readonly").onclick=()=>focusEnd(root.getElementById("shadow-readonly-field"));document.getElementById("shadow-editable").onclick=()=>focusEnd(root.getElementById("shadow-editable-field"));document.getElementById("shadow-report-button").onclick=()=>{document.getElementById("shadow-report").textContent="Shadow values: "+root.getElementById("shadow-readonly-field").value+" | "+root.getElementById("shadow-editable-field").value};const disabledShadow=document.getElementById("disabled-shadow-fixture").attachShadow({mode:"open"});disabledShadow.innerHTML='<input id="disabled-shadow-inner" value="shadow disabled">';const disabledFrame=document.getElementById("disabled-frame");document.getElementById("disabled-shadow-focus").onclick=()=>focusEnd(disabledShadow.getElementById("disabled-shadow-inner"));document.getElementById("disabled-frame-focus").onclick=()=>focusEnd(disabledFrame.contentDocument.getElementById("disabled-inner"));document.getElementById("disabled-report-button").onclick=()=>{document.getElementById("disabled-report").textContent="Disabled values: "+disabledShadow.getElementById("disabled-shadow-inner").value+" | "+disabledFrame.contentDocument.getElementById("disabled-inner").value};const opaque=document.getElementById("opaque-frame");document.getElementById("opaque-focus").onclick=()=>opaque.contentWindow.postMessage("focus","*");window.addEventListener("message",event=>{if(event.source!==opaque.contentWindow)return;if(event.data==="opaque-ready")document.getElementById("opaque-report").textContent="Opaque ready";if(typeof event.data==="string"&&event.data.startsWith("opaque-value:"))document.getElementById("opaque-report").textContent="Opaque value: "+event.data.slice(13)});const frame=document.getElementById("fixture-frame");document.getElementById("frame-readonly-button").onclick=()=>focusEnd(frame.contentDocument.getElementById("frame-readonly"));document.getElementById("frame-editable-button").onclick=()=>focusEnd(frame.contentDocument.getElementById("frame-editable"));document.getElementById("frame-report-button").onclick=()=>{document.getElementById("frame-report").textContent="Frame values: "+frame.contentDocument.getElementById("frame-readonly").value+" | "+frame.contentDocument.getElementById("frame-editable").value};</script>`,
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
