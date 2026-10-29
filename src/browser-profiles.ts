import { createHash, randomUUID } from "node:crypto";
import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";

interface Owner {
  token: string;
  workerPid: number;
  browserPid?: number;
  phase: "launching" | "running";
}
export interface BrowserProfile {
  path: string;
  kept: boolean;
  lock: string;
  token: string;
}
const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
};
const busy = (detail: string): never => {
  throw new Error(
    `BROWSER_PROFILE_BUSY: ${detail}; close the owning automation browser before retrying`,
  );
};
async function ownerAt(lock: string): Promise<Owner | undefined> {
  try {
    const value: unknown = JSON.parse(
      await readFile(join(lock, "owner.json"), "utf8"),
    );
    if (
      value &&
      typeof value === "object" &&
      "token" in value &&
      typeof value.token === "string" &&
      "workerPid" in value &&
      Number.isSafeInteger(value.workerPid) &&
      Number(value.workerPid) > 0 &&
      "phase" in value &&
      ["launching", "running"].includes(String(value.phase))
    ) {
      const owner = value as Owner;
      if (
        owner.browserPid !== undefined &&
        (!Number.isSafeInteger(owner.browserPid) || owner.browserPid <= 0)
      )
        return undefined;
      return owner;
    }
  } catch {}
  return undefined;
}
function stale(owner: Owner | undefined): boolean {
  if (!owner || alive(owner.workerPid)) return false;
  if (owner.browserPid === undefined) return false; // A crash during launch has an unknown browser owner.
  return !alive(owner.browserPid);
}
async function claim(lock: string): Promise<string> {
  const token = randomUUID();
  try {
    await access(`${lock}.recover`);
    busy("profile recovery is active or incomplete");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  try {
    await mkdir(lock);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const owner = await ownerAt(lock);
    if (!stale(owner))
      busy(
        owner?.browserPid && alive(owner.browserPid)
          ? "profile browser is still alive (possibly orphaned)"
          : "live, unknown or incomplete profile ownership",
      );
    const recovery = `${lock}.recover`;
    try {
      await mkdir(recovery);
    } catch {
      busy("another profile recovery is active or incomplete");
    }
    try {
      const confirmed = await ownerAt(lock);
      if (!stale(confirmed) || confirmed?.token !== owner?.token)
        busy("profile ownership changed during recovery");
      const abandoned = `${lock}.abandoned-${token}`;
      await rename(lock, abandoned);
      try {
        await mkdir(lock);
      } finally {
        await rm(abandoned, { recursive: true, force: true });
      }
    } finally {
      await rm(recovery, { recursive: true, force: true });
    }
  }
  const owner: Owner = { token, workerPid: process.pid, phase: "launching" };
  await writeFile(join(lock, "owner.json"), JSON.stringify(owner), {
    flag: "wx",
  });
  return token;
}

export async function acquireBrowserProfile(
  app: string,
  executable: string,
  kept: boolean,
): Promise<BrowserProfile> {
  const local = process.env.LOCALAPPDATA;
  if (!local)
    throw new Error("BROWSER_SETUP_FAILED: Windows LOCALAPPDATA is required");
  const root = resolve(
    process.env.PI_CU_BROWSER_PROFILE_ROOT ??
      join(local, "pi-computer-use", "browser"),
  );
  await mkdir(root, { recursive: true });
  // Only sweep our recorded temporary leases after both recorded processes
  // are gone; unknown launches and live orphans remain untouched.
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (
      !entry.isDirectory() ||
      !/^temporary-[A-Za-z0-9]+\.lock$/.test(entry.name)
    )
      continue;
    const lock = join(root, entry.name);
    if (!stale(await ownerAt(lock))) continue;
    try {
      const token = await claim(lock);
      await releaseBrowserProfile({
        path: lock.slice(0, -5),
        kept: false,
        lock,
        token,
      });
    } catch (error) {
      if (
        !(
          error instanceof Error &&
          error.message.startsWith("BROWSER_PROFILE_BUSY")
        )
      )
        throw error;
    }
  }
  const identity = createHash("sha256")
    .update(`${app}\0${resolve(executable).toLowerCase()}`)
    .digest("hex")
    .slice(0, 24);
  const path = kept
    ? join(root, `kept-${app}-${identity}`)
    : await mkdtemp(join(root, "temporary-"));
  const lock = `${path}.lock`;
  try {
    const token = await claim(lock);
    await mkdir(path, { recursive: true });
    return { path, kept, lock, token };
  } catch (error) {
    if (!kept) await rm(path, { recursive: true, force: true });
    throw error;
  }
}
export async function recordProfileBrowser(
  profile: BrowserProfile,
  pid: number | undefined,
): Promise<void> {
  if (!pid) busy("launched browser did not expose its owning process");
  const owner = await ownerAt(profile.lock);
  if (owner?.token !== profile.token)
    busy("profile ownership changed before launch completed");
  await writeFile(
    join(profile.lock, "owner.json"),
    JSON.stringify({ ...owner, browserPid: pid, phase: "running" }),
  );
}
export async function releaseBrowserProfile(
  profile: BrowserProfile,
  browserPid?: number,
): Promise<void> {
  const owner = await ownerAt(profile.lock);
  if (owner?.token !== profile.token)
    busy("profile ownership changed during cleanup");
  if (browserPid && alive(browserPid))
    busy("browser is still alive; profile retained and blocked");
  if (!profile.kept)
    await rm(profile.path, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  await rm(profile.lock, { recursive: true, force: true });
}
export function browserIdleMs(): number {
  const value = Number(process.env.PI_CU_BROWSER_IDLE_MS ?? 600000);
  if (!Number.isSafeInteger(value) || value < 1000 || value > 86400000)
    throw new Error(
      "BROWSER_SETTINGS: PI_CU_BROWSER_IDLE_MS must be 1000–86400000 milliseconds",
    );
  return value;
}
