import { afterEach, describe, expect, it, vi } from "vitest";
import { homedir } from "node:os";
import { join } from "node:path";

const ORIGINAL_CLAUDETUI_HOME = process.env.CLAUDETUI_HOME;

async function loadConfig(claudeHome?: string) {
  if (claudeHome === undefined) {
    delete process.env.CLAUDETUI_HOME;
  } else {
    process.env.CLAUDETUI_HOME = claudeHome;
  }
  vi.resetModules();
  return import("./config.js");
}

afterEach(() => {
  if (ORIGINAL_CLAUDETUI_HOME === undefined) {
    delete process.env.CLAUDETUI_HOME;
  } else {
    process.env.CLAUDETUI_HOME = ORIGINAL_CLAUDETUI_HOME;
  }
  vi.resetModules();
});

describe("Claude data home", () => {
  it("uses CLAUDETUI_HOME as the direct path to Claude data", async () => {
    const claudeHome = join("fixture", "claude-data");
    const { CLAUDE_HOME, PATHS } = await loadConfig(claudeHome);

    expect(CLAUDE_HOME).toBe(claudeHome);
    expect(PATHS.history).toBe(join(claudeHome, "history.jsonl"));
    expect(PATHS.projects).toBe(join(claudeHome, "projects"));
  });

  it("defaults to the user's .claude directory when CLAUDETUI_HOME is unset", async () => {
    const { CLAUDE_HOME } = await loadConfig();

    expect(CLAUDE_HOME).toBe(join(homedir(), ".claude"));
  });
});
