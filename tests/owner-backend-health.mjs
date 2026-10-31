// Run only a non-input health request inside the test supervisor's job.
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createComparisonClient } from "./comparison-client.mjs";

const [engine, output, referencePath] = process.argv.slice(2);
process.env.PI_CU_SETTINGS_FILE = join(output, "settings.json");
try {
  const client = await createComparisonClient({
    engine,
    referencePath,
    cwd: output,
  });
  const result = await client.execute("health", {});
  await writeFile(
    join(output, "health.json"),
    JSON.stringify({ engine, ok: result.ok === true }),
  );
  // The supervisor intentionally times out this disposable runner and its workers.
  await new Promise(() => setInterval(() => {}, 1000));
} catch (error) {
  await writeFile(
    join(output, "error.json"),
    JSON.stringify({ engine, error: error.message }),
  );
  process.exitCode = 1;
}
