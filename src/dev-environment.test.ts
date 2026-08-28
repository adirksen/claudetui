import { afterEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cleanupDemoHome,
  prepareDemoHome,
} from "../scripts/dev-environment.mjs";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "claudetui-dev-env-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("demo environment", () => {
  it("recreates a synthetic Claude data directory and cleans it up", async () => {
    const root = await makeTempDir();
    const demoHome = join(root, ".dev-home");
    await writeFile(join(root, "keep.txt"), "keep");
    // The directory is deliberately created with stale content before setup.
    await mkdir(demoHome, { recursive: true });
    await writeFile(join(demoHome, "stale.txt"), "stale");

    prepareDemoHome(demoHome);

    expect(existsSync(join(demoHome, ".claude", "history.jsonl"))).toBe(true);
    expect(existsSync(join(demoHome, "stale.txt"))).toBe(false);

    cleanupDemoHome(demoHome);

    expect(existsSync(demoHome)).toBe(false);
    expect(existsSync(join(root, "keep.txt"))).toBe(true);
  });
});
