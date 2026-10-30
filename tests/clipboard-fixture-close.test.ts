import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const helper = pathToFileURL(resolve("tests/clipboard-fixture-close.mjs")).href;

test("clipboard owner that stalls after cleanup acknowledgement is reported without being killed or hanging the runner", () => {
  const script = `
    import {spawn} from 'node:child_process';
    import {once} from 'node:events';
    import {waitForFixtureClose} from ${JSON.stringify(helper)};
    const child=spawn(process.execPath,['-e','setTimeout(()=>process.exit(0),1500)'],{stdio:['pipe','pipe','pipe']});
    const closed=once(child,'close');
    try { await waitForFixtureClose(child,closed,80); console.log('unexpected-success'); process.exitCode=2; }
    catch(e) { let alive=true; try {process.kill(child.pid,0)} catch {alive=false} console.log(JSON.stringify({error:e.message,alive})); }
  `;
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", script],
    { encoding: "utf8", timeout: 1000 },
  );
  assert.equal(result.status, 0, result.stderr || String(result.error));
  const observation = JSON.parse(result.stdout);
  assert.match(observation.error, /cleanup unconfirmed/i);
  assert.equal(observation.alive, true);
});

test("normal fixture exit completes without a cleanup warning", () => {
  const script = `
    import {spawn} from 'node:child_process';
    import {once} from 'node:events';
    import {waitForFixtureClose} from ${JSON.stringify(helper)};
    const child=spawn(process.execPath,['-e','setTimeout(()=>process.exit(0),30)'],{stdio:['pipe','pipe','pipe']});
    await waitForFixtureClose(child,once(child,'close'),1000); console.log('confirmed');
  `;
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", script],
    { encoding: "utf8", timeout: 2000 },
  );
  assert.equal(result.status, 0, result.stderr || String(result.error));
  assert.equal(result.stdout.trim(), "confirmed");
});
