import { homedir } from "node:os";
import { join } from "node:path";
import type { ModelPricing } from "./types.js";

/**
 * The directory containing Claude Code's data. CLAUDETUI_HOME is primarily
 * useful for demos and tests, where reading the user's real data is unwanted.
 */
export const CLAUDE_HOME = process.env.CLAUDETUI_HOME || join(homedir(), ".claude");

export const PATHS = {
  history: join(CLAUDE_HOME, "history.jsonl"),
  projects: join(CLAUDE_HOME, "projects"),
  settings: join(CLAUDE_HOME, "settings.json"),
  plugins: join(CLAUDE_HOME, "plugins", "installed_plugins.json"),
  mcpAuth: join(CLAUDE_HOME, "mcp-needs-auth-cache.json"),
  debug: join(CLAUDE_HOME, "debug"),
  fileHistory: join(CLAUDE_HOME, "file-history"),
} as const;

export const INTERVALS = {
  pidCheck: 5_000,
  systemResources: 2_000,
  /** Collapse bursts of file-watcher events into a single refresh. */
  refreshDebounce: 400,
} as const;

/**
 * Cache rates are a fixed multiple of the input rate on every current model:
 * reads bill at ~0.1x, and writes to the default 5-minute cache at 1.25x.
 * (A 1-hour-TTL cache write is 2x, but Claude Code uses the 5-minute default.)
 */
const CACHE_READ_MULTIPLIER = 0.1;
const CACHE_WRITE_MULTIPLIER = 1.25;

/** Round to cents-per-million so derived rates don't carry float noise. */
const round = (n: number): number => Math.round(n * 10_000) / 10_000;

export function pricingFromRates(
  inputPerMillion: number,
  outputPerMillion: number
): ModelPricing {
  return {
    inputPerMillion,
    outputPerMillion,
    cacheReadPerMillion: round(inputPerMillion * CACHE_READ_MULTIPLIER),
    cacheCreationPerMillion: round(inputPerMillion * CACHE_WRITE_MULTIPLIER),
  };
}

/**
 * Anthropic list pricing per million tokens, current as of 2026-07.
 *
 * Historical sessions can reference retired models, so older IDs are kept —
 * a conversation billed at the old Opus rate should still cost that much.
 *
 * Note: Sonnet 5 carries promotional pricing of $2/$10 through 2026-08-31.
 * The standard $3/$15 rate is used here so estimates stay correct after the
 * promotion ends rather than silently drifting on that date. This table is
 * only the baked-in floor, though: the live pricing fetch (pricing-fetcher.ts)
 * overrides it at runtime, so promo rates apply for as long as the catalog
 * carries them.
 */
export const MODEL_PRICING: Record<string, ModelPricing> = {
  // Mythos class
  "claude-fable-5": pricingFromRates(10, 50),
  "claude-mythos-5": pricingFromRates(10, 50),
  "claude-mythos-preview": pricingFromRates(10, 50),

  // Opus class
  "claude-opus-5": pricingFromRates(5, 25),
  "claude-opus-4-8": pricingFromRates(5, 25),
  "claude-opus-4-7": pricingFromRates(5, 25),
  "claude-opus-4-6": pricingFromRates(5, 25),
  "claude-opus-4-5": pricingFromRates(5, 25),
  "claude-opus-4-1": pricingFromRates(15, 75),
  "claude-opus-4-0": pricingFromRates(15, 75),
  "claude-3-opus": pricingFromRates(15, 75),

  // Sonnet class
  "claude-sonnet-5": pricingFromRates(3, 15),
  "claude-sonnet-4-6": pricingFromRates(3, 15),
  "claude-sonnet-4-5": pricingFromRates(3, 15),
  "claude-sonnet-4-0": pricingFromRates(3, 15),
  "claude-3-7-sonnet": pricingFromRates(3, 15),
  "claude-3-5-sonnet": pricingFromRates(3, 15),

  // Haiku class
  "claude-haiku-4-5": pricingFromRates(1, 5),
  "claude-3-5-haiku": pricingFromRates(0.8, 4),
  "claude-3-haiku": pricingFromRates(0.25, 1.25),
};

/**
 * Anchor model IDs backing each family fallback, most- to least-specific so
 * "claude-fable-5-preview" doesn't fall through to Sonnet.
 */
const FAMILY_ANCHORS: ReadonlyArray<readonly [string, string]> = [
  ["fable", "claude-fable-5"],
  ["mythos", "claude-mythos-5"],
  ["opus", "claude-opus-5"],
  ["sonnet", "claude-sonnet-5"],
  ["haiku", "claude-haiku-4-5"],
];

/**
 * Mutable current pricing table. Starts as the baked table and can be
 * overridden at runtime (e.g. by a live pricing fetch); the baked table
 * itself is never mutated, so it always remains the fallback floor.
 */
let currentPricing: Record<string, ModelPricing> = { ...MODEL_PRICING };

/**
 * Layer live overrides on top of the baked table. Each call replaces any
 * prior overrides outright — baked entries survive unless re-overridden,
 * and overrides may introduce keys the baked table doesn't have.
 */
export function applyPricingOverrides(
  overrides: Record<string, ModelPricing>
): void {
  currentPricing = { ...MODEL_PRICING, ...overrides };
}

/** The current pricing table (baked table plus any active overrides). */
export function getModelPricing(): Record<string, ModelPricing> {
  return currentPricing;
}

/**
 * Per-family fallbacks for model IDs newer than the current table. Ordered
 * most- to least-specific so "claude-fable-5-preview" doesn't fall through
 * to Sonnet. Reflects the current table, so an override of an anchor model
 * flows through to its family rate.
 */
export function getFamilyPricing(): ReadonlyArray<readonly [string, ModelPricing]> {
  return FAMILY_ANCHORS.map(
    ([family, anchor]) => [family, currentPricing[anchor]!] as const
  );
}

/** Last resort for a completely unrecognized model name. */
export function getDefaultPricing(): ModelPricing {
  return currentPricing["claude-sonnet-5"]!;
}

/** Discard any active overrides, restoring the baked-only table. For tests. */
export function resetPricingOverrides(): void {
  currentPricing = { ...MODEL_PRICING };
}
