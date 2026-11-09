// Public package artifact check: run via npm run test:package after a build.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
const folder = await mkdtemp(join(tmpdir(), "pi-cu-package-"));
assert.ok(
  process.env.npm_execpath,
  "Run this check through npm run test:package",
);
try {
  const packed = await run(
    process.execPath,
    [process.env.npm_execpath, "pack", "--json", "--pack-destination", folder],
    { cwd: root, maxBuffer: 1024 * 1024 },
  );
  const [{ filename, files }] = JSON.parse(
    packed.stdout.slice(packed.stdout.indexOf("[")),
  );
  const paths = new Set(files.map((file) => file.path));
  assert.ok(paths.has("dist/extension.js") && paths.has("dist/worker.js"));
  assert.ok(
    paths.has("assets/windows.cs") && paths.has("assets/node-LICENSE.txt"),
  );
  await run("tar", ["-xf", join(folder, filename), "-C", folder]);
  const packageRoot = join(folder, "package");
  assert.ok(
    paths.has("LICENSE"),
    "The published package must include its declared project license",
  );
  assert.ok(
    paths.has("assets/puppeteer-LICENSE.txt"),
    "The Puppeteer notice must remain packaged",
  );
  const manifest = JSON.parse(
    await readFile(join(packageRoot, "package.json"), "utf8"),
  );
  const source = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const lock = JSON.parse(
    await readFile(join(root, "package-lock.json"), "utf8"),
  );
  assert.equal(manifest.name, source.name);
  assert.equal(manifest.name, lock.name);
  assert.equal(manifest.name, lock.packages[""].name);
  assert.deepEqual(manifest.author, source.author);
  assert.equal(manifest.publishConfig.access, "public");
  assert.equal(manifest.version, source.version);
  assert.equal(manifest.version, lock.packages[""].version);
  assert.equal(manifest.license, "MIT");
  assert.match(
    await readFile(join(packageRoot, "LICENSE"), "utf8"),
    /Permission is hereby granted, free of charge/,
  );
  assert.equal(
    [...paths].some((path) =>
      /^(src|tests|node_modules|\.git)\/|(^|\/)\.env(?:\.|$)/.test(path),
    ),
    false,
    "Source, development dependencies and local environment files must not ship",
  );
  const failures = [];
  const walk = async (directory) => {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, item.name);
      if (item.isDirectory()) await walk(path);
      else if (item.name.endsWith(".md")) {
        const text = await readFile(path, "utf8");
        for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
          const target = match[1];
          if (/^[a-z]+:/i.test(target)) continue;
          const [file, anchor] = target.split("#");
          const destination = file ? resolve(dirname(path), file) : path;
          const relative = destination
            .slice(packageRoot.length + 1)
            .replaceAll("\\", "/");
          if (
            !paths.has(relative) &&
            ![...paths].some((entry) => entry.startsWith(`${relative}/`))
          ) {
            failures.push(`${path.slice(packageRoot.length + 1)} -> ${target}`);
            continue;
          }
          if (anchor) {
            const headings = (await readFile(destination, "utf8"))
              .split(/\r?\n/)
              .filter((line) => line.startsWith("#"))
              .map((line) =>
                line
                  .replace(/^#+\s*/, "")
                  .toLowerCase()
                  .replace(/[^\p{L}\p{N}_\- ]/gu, "")
                  .replaceAll(" ", "-"),
              );
            if (!headings.includes(anchor))
              failures.push(`${path} -> ${target}: missing heading`);
          }
        }
      }
    }
  };
  await walk(packageRoot);
  assert.deepEqual(
    failures,
    [],
    "Published documentation must resolve without repository-only files",
  );
  console.log(
    JSON.stringify({
      ok: true,
      artifact: filename,
      entries: paths.size,
      name: manifest.name,
      version: manifest.version,
      projectLicense: manifest.license,
      developmentFilesExcluded: true,
      documentationLinks: "passed",
    }),
  );
} finally {
  await rm(folder, { recursive: true, force: true });
}
