import blessed from "blessed";
import type { HistoryEntry } from "../../types.js";
import { COLORS } from "../theme.js";
import {
  formatTime,
  formatDuration,
  formatTokens,
  formatCost,
  truncate,
} from "../../util/format.js";
import { encodeProjectPath } from "../../data/claude-home.js";
import {
  readConversation,
  extractTokenUsage,
  extractModel,
} from "../../data/conversation-reader.js";
import { estimateCost } from "../../aggregators/token-aggregator.js";
import { isPointInBounds } from "../mouse.js";
import { basename } from "node:path";

const SEP = `  {gray-fg}${"─".repeat(66)}{/gray-fg}`;

function row(label: string, value: string, label2?: string, value2?: string): string {
  const col1 = `  {bold}${label.padEnd(12)}{/bold} ${value}`;
  if (label2 !== undefined && value2 !== undefined) {
    return `${col1.padEnd(42)}  {bold}${label2.padEnd(10)}{/bold} ${value2}`;
  }
  return col1;
}

/**
 * Show a modal overlay with structured details about a history session.
 * Resolves when the user closes the overlay.
 */
export async function showHistoryDetail(
  screen: blessed.Widgets.Screen,
  entry: HistoryEntry,
  allEntries: HistoryEntry[]
): Promise<void> {
  const sessionEntries = allEntries
    .filter((e) => e.sessionId === entry.sessionId)
    .sort((a, b) => a.timestamp - b.timestamp);

  const firstSeen = sessionEntries[0]?.timestamp ?? entry.timestamp;
  const lastSeen =
    sessionEntries[sessionEntries.length - 1]?.timestamp ?? entry.timestamp;
  const projectName =
    basename((entry.project ?? "").replace(/\\/g, "/")) || "Unknown";
  const encodedProject = encodeProjectPath(entry.project ?? "");
  const sessionShort = entry.sessionId.slice(0, 36);
  const durationMs = lastSeen - firstSeen;

  // Solid backdrop so underlying dashboard panels don't bleed through
  const backdrop = blessed.box({
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    style: { bg: COLORS.bg },
  });
  screen.append(backdrop);

  const container = blessed.box({
    top: "center",
    left: "center",
    width: "76%",
    height: "85%",
    tags: true,
    border: { type: "line" },
    style: {
      fg: COLORS.fg,
      bg: COLORS.bg,
      border: { fg: COLORS.mid.accent },
      label: { fg: COLORS.mid.accent, bold: true },
    },
    label: " Session History ",
    scrollable: true,
    mouse: true,
    keys: true,
    vi: true,
    alwaysScroll: true,
  });

  function buildCommandLines(commands: HistoryEntry[]): string[] {
    const total = sessionEntries.length;
    const recent = commands.slice(-20);
    const startIdx = total - recent.length + 1;
    const lines: string[] = [];

    for (let i = 0; i < recent.length; i++) {
      const e = recent[i]!;
      const prev = recent[i - 1];
      const num = `#${startIdx + i}`.padStart(4);
      const time = formatTime(e.timestamp);
      const isLast = i === recent.length - 1;
      const displayText = truncate(e.display.replace(/\n/g, " "), 54);
      const bullet = isLast ? "{green-fg}▶{/green-fg}" : " ";
      const textColor = isLast ? "green-fg" : "white-fg";

      // Gap line showing time elapsed since previous command
      if (prev) {
        const gapMs = e.timestamp - prev.timestamp;
        if (gapMs > 5000) {
          const gap = formatDuration(gapMs);
          lines.push(`        {gray-fg}  + ${gap}{/gray-fg}`);
        }
      }

      lines.push(
        `  {gray-fg}${num}  ${time}{/gray-fg}  ${bullet}  {${textColor}}${displayText}{/${textColor}}`
      );
    }

    return lines;
  }

  function buildLines(conv?: {
    model: string;
    tokenLine: string;
    costLine: string;
  }): string {
    const cmdLines = buildCommandLines(sessionEntries);

    return [
      "",
      `  {bold}{yellow-fg}PROJECT{/yellow-fg}{/bold}`,
      SEP,
      row("Project", `{yellow-fg}${projectName}{/yellow-fg}`),
      row("Path", `{gray-fg}${truncate(entry.project ?? "", 56)}{/gray-fg}`),
      row("Session ID", `{cyan-fg}${sessionShort}{/cyan-fg}`),
      "",
      `  {bold}{yellow-fg}TIMING{/yellow-fg}{/bold}`,
      SEP,
      row(
        "First seen",
        `${formatTime(firstSeen)}  {gray-fg}(${formatDuration(Date.now() - firstSeen)} ago){/gray-fg}`,
        "Commands",
        `{white-fg}${sessionEntries.length}{/white-fg}`
      ),
      row(
        "Last seen",
        `${formatTime(lastSeen)}`,
        "Duration",
        `{white-fg}${durationMs > 0 ? formatDuration(durationMs) : "< 1s"}{/white-fg}`
      ),
      "",
      `  {bold}{yellow-fg}TOKENS & COST{/yellow-fg}{/bold}`,
      SEP,
      conv
        ? row("Model", `{yellow-fg}${conv.model.replace("claude-", "")}{/yellow-fg}`, "Cost", `{yellow-fg}${conv.costLine}{/yellow-fg}`)
        : row("Model", `{gray-fg}loading...{/gray-fg}`, "Cost", `{gray-fg}—{/gray-fg}`),
      conv
        ? `  ${conv.tokenLine}`
        : `  {gray-fg}Token data loading...{/gray-fg}`,
      "",
      `  {bold}{yellow-fg}COMMAND HISTORY{/yellow-fg}{/bold}  {gray-fg}(showing last ${Math.min(sessionEntries.length, 20)} of ${sessionEntries.length}){/gray-fg}`,
      SEP,
      ...cmdLines,
      "",
      `  {gray-fg}[Esc / q / Enter]  Close     [j/k or arrows]  Scroll{/gray-fg}`,
    ]
      .join("\n");
  }

  container.setContent(buildLines());
  screen.append(container);
  container.focus();
  screen.render();

  // Load conversation data async, then re-render with real token info
  readConversation(encodedProject, entry.sessionId)
    .then((entries) => {
      const tokens = extractTokenUsage(entries);
      const model = extractModel(entries);
      const cost = estimateCost(tokens, model);
      const tokenLine = [
        `{bold}In{/bold}  {cyan-fg}${formatTokens(tokens.input_tokens)}{/cyan-fg}`,
        `{bold}Out{/bold} {yellow-fg}${formatTokens(tokens.output_tokens)}{/yellow-fg}`,
        `{bold}Cache rd{/bold} {green-fg}${formatTokens(tokens.cache_read_input_tokens)}{/green-fg}`,
        `{bold}Cache wr{/bold} {gray-fg}${formatTokens(tokens.cache_creation_input_tokens)}{/gray-fg}`,
      ].join("   ");
      container.setContent(
        buildLines({ model, tokenLine, costLine: formatCost(cost.total, cost.pricingKnown) })
      );
      screen.render();
    })
    .catch(() => {
      const tokenLine = `{gray-fg}Conversation data not found in ~/.claude/projects/{/gray-fg}`;
      container.setContent(
        buildLines({ model: "unknown", tokenLine, costLine: "—" })
      );
      screen.render();
    });

  return new Promise((resolve) => {
    const close = () => {
      container.destroy();
      backdrop.destroy();
      screen.render();
      resolve();
    };
    container.key(["escape", "q", "enter"], close);

    // No distinct header element exists here — container is a single
    // scrollable box whose top border carries the " Session History " label.
    // That border row is the closest equivalent to session-detail's clickable
    // header, so a click confined to that one row (not the scrollable body
    // beneath it) closes the view.
    container.on("click", (data: { x: number; y: number }) => {
      const bounds = container as unknown as {
        atop: number;
        aleft: number;
        width: number;
      };
      const isTopBar = isPointInBounds(data.x, data.y, {
        x: Number(bounds.aleft),
        y: Number(bounds.atop),
        width: Number(bounds.width),
        height: 1,
      });
      if (isTopBar) close();
    });
  });
}
