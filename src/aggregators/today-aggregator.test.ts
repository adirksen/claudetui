import { describe, it, expect, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, utimes, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// `PATHS` in src/config.ts is computed at module import time. Every scenario
// below sets CLAUDETUI_HOME to a fresh temp directory and calls
// vi.resetModules() BEFORE dynamically importing the modules under test,
// forcing config.ts (and everything that reads PATHS from it) to re-evaluate
// against the fake Claude data directory on every platform.
// Static top-of-file imports of those modules would bind to whatever override
// was set at file-load time, so only dynamic imports are used here.
//
// NOTE: This test file's reliance on process.env.CLAUDETUI_HOME mutation and
// vi.resetModules() assumes vitest's default configuration with `isolate: true`
// (per-file worker processes). If a future vitest config sets `isolate: false`,
// this file must be revisited to handle module caching across tests.

const ORIGINAL_CLAUDETUI_HOME = process.env.CLAUDETUI_HOME;

async function makeHome(): Promise<string> {
  return mkdtemp(join(tmpdir(), "claudetui-today-agg-"));
}

async function loadTodayAggregator(home: string) {
  process.env.CLAUDETUI_HOME = join(home, ".claude");
  vi.resetModules();
  return import("./today-aggregator.js");
}

async function cleanup(home: string): Promise<void> {
  if (ORIGINAL_CLAUDETUI_HOME === undefined) {
    delete process.env.CLAUDETUI_HOME;
  } else {
    process.env.CLAUDETUI_HOME = ORIGINAL_CLAUDETUI_HOME;
  }
  await rm(home, { recursive: true, force: true });
}

// Local-midnight basis, matching getTodayStats' own `new Date(); setHours(0,0,0,0)`.
const startOfToday = new Date();
startOfToday.setHours(0, 0, 0, 0);

function todayAt(hoursAfterMidnight: number): string {
  return new Date(
    startOfToday.getTime() + hoursAfterMidnight * 60 * 60 * 1000
  ).toISOString();
}

function beforeMidnight(hoursBefore: number): Date {
  return new Date(startOfToday.getTime() - hoursBefore * 60 * 60 * 1000);
}

function yesterdayAt(hoursBeforeMidnight: number): string {
  return beforeMidnight(hoursBeforeMidnight).toISOString();
}

function jsonlLine(entry: unknown): string {
  return JSON.stringify(entry) + "\n";
}

type Usage = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
};

function assistantEntry(
  timestamp: string,
  model: string,
  usage: Usage,
  toolUses: Array<{ id: string; name: string }> = []
) {
  return {
    type: "assistant",
    uuid: `a-${timestamp}-${model}`,
    parentUuid: null,
    timestamp,
    sessionId: "s1",
    isSidechain: false,
    message: {
      role: "assistant",
      model,
      content: toolUses.map((t) => ({ type: "tool_use", id: t.id, name: t.name })),
      usage,
    },
  };
}

function userResultEntry(
  timestamp: string,
  results: Array<{ toolUseId: string; content: unknown }>
) {
  return {
    type: "user",
    uuid: `u-${timestamp}`,
    parentUuid: null,
    timestamp,
    sessionId: "s1",
    isSidechain: false,
    message: {
      role: "user",
      content: results.map((r) => ({
        type: "tool_result",
        tool_use_id: r.toolUseId,
        content: r.content,
      })),
    },
  };
}

describe("getTodayStats", () => {
  it("sums today's tokens per field, prices each model at its own rate, and attributes tool stats", async () => {
    const home = await makeHome();
    try {
      const projectDir = join(home, ".claude", "projects", "proj1");
      await mkdir(projectDir, { recursive: true });

      const opusUsage: Usage = {
        input_tokens: 1000,
        output_tokens: 500,
        cache_creation_input_tokens: 100,
        cache_read_input_tokens: 50,
      };
      const haikuUsage: Usage = {
        input_tokens: 2000,
        output_tokens: 300,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      };
      // Deliberately huge, so if the yesterday filter ever broke, totals below would visibly blow up.
      const yesterdayUsage: Usage = {
        input_tokens: 99999,
        output_tokens: 99999,
        cache_creation_input_tokens: 99999,
        cache_read_input_tokens: 99999,
      };

      const content =
        jsonlLine(
          assistantEntry(todayAt(1), "claude-opus-5", opusUsage, [
            { id: "call-1", name: "Bash" },
          ])
        ) +
        jsonlLine(
          userResultEntry(todayAt(1), [
            { toolUseId: "call-1", content: "12345678" }, // 8 chars -> 2 tokens
          ])
        ) +
        jsonlLine(
          assistantEntry(todayAt(2), "claude-haiku-4-5", haikuUsage, [
            { id: "call-2", name: "Read" },
          ])
        ) +
        jsonlLine(
          userResultEntry(todayAt(2), [
            { toolUseId: "call-2", content: [{ type: "text", text: "abcdefgh" }] }, // 8 chars -> 2 tokens
          ])
        ) +
        jsonlLine(
          assistantEntry(yesterdayAt(2), "claude-opus-5", yesterdayUsage, [
            { id: "call-3", name: "Bash" },
          ])
        ) +
        jsonlLine(
          userResultEntry(yesterdayAt(2), [
            { toolUseId: "call-3", content: "should-not-be-counted-at-all" },
          ])
        );

      await writeFile(join(projectDir, "session-1.jsonl"), content);

      const { getTodayStats } = await loadTodayAggregator(home);
      const result = await getTodayStats();

      expect(result.tokens).toEqual({
        input_tokens: 3000,
        output_tokens: 800,
        cache_creation_input_tokens: 100,
        cache_read_input_tokens: 50,
      });

      // Opus: $5/$25/million, 0.1x cache read, 1.25x cache write.
      const expectedOpusCost =
        (1000 / 1_000_000) * 5 +
        (500 / 1_000_000) * 25 +
        (50 / 1_000_000) * 0.5 +
        (100 / 1_000_000) * 6.25;
      // Haiku: $1/$5/million.
      const expectedHaikuCost = (2000 / 1_000_000) * 1 + (300 / 1_000_000) * 5;
      expect(result.cost.total).toBeCloseTo(expectedOpusCost + expectedHaikuCost, 10);
      expect(result.cost.pricingKnown).toBe(true);

      expect(result.toolStats).toHaveLength(2);
      const bash = result.toolStats.find((t) => t.name === "Bash");
      const read = result.toolStats.find((t) => t.name === "Read");
      expect(bash?.calls).toBe(1); // yesterday's Bash call must not be counted
      expect(bash?.outputTokens).toBe(500);
      expect(bash?.resultTokens).toBe(2);
      expect(read?.calls).toBe(1);
      expect(read?.outputTokens).toBe(300);
      expect(read?.resultTokens).toBe(2);
    } finally {
      await cleanup(home);
    }
  });

  it("skips a session file whose mtime predates midnight, and never parses it", async () => {
    const home = await makeHome();
    try {
      const projectDir = join(home, ".claude", "projects", "proj1");
      await mkdir(projectDir, { recursive: true });

      const freshUsage: Usage = {
        input_tokens: 10,
        output_tokens: 20,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      };
      const freshPath = join(projectDir, "fresh-session.jsonl");
      await writeFile(
        freshPath,
        jsonlLine(
          assistantEntry(todayAt(1), "claude-sonnet-5", freshUsage, [
            { id: "call-1", name: "Bash" },
          ])
        )
      );

      // Old session: yesterday-stamped content AND an mtime before midnight.
      const oldUsage: Usage = {
        input_tokens: 5000,
        output_tokens: 5000,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      };
      const oldPath = join(projectDir, "old-session.jsonl");
      await writeFile(
        oldPath,
        jsonlLine(
          assistantEntry(yesterdayAt(2), "claude-sonnet-5", oldUsage, [
            { id: "call-2", name: "Read" },
          ])
        )
      );
      const oldMtime = beforeMidnight(1);
      await utimes(oldPath, oldMtime, oldMtime);

      process.env.CLAUDETUI_HOME = join(home, ".claude");
      vi.resetModules();

      const readCalls: string[] = [];
      vi.doMock("../data/conversation-cache.js", async () => {
        const actual = await vi.importActual<
          typeof import("../data/conversation-cache.js")
        >("../data/conversation-cache.js");
        return {
          ...actual,
          readJsonlCached: async (path: string) => {
            readCalls.push(path);
            return actual.readJsonlCached(path);
          },
        };
      });

      const { getTodayStats } = await import("./today-aggregator.js");
      const result = await getTodayStats();

      expect(readCalls).toContain(freshPath);
      expect(readCalls).not.toContain(oldPath);
      expect(result.tokens.input_tokens).toBe(10);
      expect(result.toolStats.find((t) => t.name === "Read")).toBeUndefined();
    } finally {
      vi.doUnmock("../data/conversation-cache.js");
      await cleanup(home);
    }
  });

  it("returns all-zero stats when the projects directory is empty", async () => {
    const home = await makeHome();
    try {
      await mkdir(join(home, ".claude", "projects"), { recursive: true });

      const { getTodayStats } = await loadTodayAggregator(home);
      const result = await getTodayStats();

      expect(result.tokens).toEqual({
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      });
      expect(result.toolStats).toEqual([]);
      expect(result.cost.total).toBe(0);
    } finally {
      await cleanup(home);
    }
  });
});
