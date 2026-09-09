import blessed from "blessed";
import type { ActiveSession, AgentInfo, ConversationEntry } from "../../types.js";
import {
  formatDuration,
  formatTokens,
  formatCost,
  formatTime,
  truncate,
} from "../../util/format.js";
import { estimateCost } from "../../aggregators/token-aggregator.js";
import { COLORS } from "../theme.js";

/**
 * Show a full-screen drill-down view for a single session.
 * Returns a cleanup function to call when exiting the view.
 *
 * Layout:
 *   Row 0-2:   Header bar (status, key hints)
 *   Row 3-12:  Info panel (left 40%)
 *   Row 13-19: Token + cost breakdown (left 40%)
 *   Row 20+:   Agents list (left 40%, scrollable)
 *   Row 3+:    Messages panel (right 60%, scrollable, default focus)
 */
export function showSessionDetail(
  screen: blessed.Widgets.Screen,
  session: ActiveSession,
  agents: AgentInfo[],
  entries: ConversationEntry[],
  onClose: () => void,
  mouseEnabled = true
): () => void {
  // Root container
  const container = blessed.box({
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    tags: true,
    style: { fg: COLORS.fg, bg: COLORS.bg },
  });

  // Solid backdrop — paints every cell so underlying panels don't bleed through
  blessed.box({
    parent: container,
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    style: { bg: COLORS.bg },
  });

  const statusLabel = session.isAlive
    ? "{green-fg}● alive{/green-fg}"
    : "{red-fg}○ dead{/red-fg}";

  // ── Header ─────────────────────────────────────────────────────────────────
  // Captured so a click on it can close the view — the header text names the
  // action ("[Esc/q: back]"), so clicking it performs that action.
  const header = blessed.box({
    parent: container,
    top: 0,
    left: 0,
    width: "100%",
    height: 3,
    tags: true,
    border: { type: "line" },
    style: {
      fg: COLORS.fg,
      bg: COLORS.bg,
      border: { fg: COLORS.top.accent },
      label: { fg: COLORS.top.accent, bold: true },
    },
    label: ` Session: ${session.pid || "—"} — ${session.projectName} `,
    content: `  ${statusLabel}   {gray-fg}[Esc/q: back]  [j/k: scroll messages]{/gray-fg}`,
  });

  // ── Info panel ─────────────────────────────────────────────────────────────
  const cost = estimateCost(session.totalTokens, session.model);
  const t = session.totalTokens;

  const infoLines = [
    `  PID       {yellow-fg}${session.pid || "—"}{/yellow-fg}  ${statusLabel}`,
    `  Session   {gray-fg}${session.sessionId.slice(0, 28)}...{/gray-fg}`,
    `  Started   {cyan-fg}${formatDuration(session.duration)} ago{/cyan-fg}`,
    `  Model     {yellow-fg}${session.model?.replace("claude-", "") ?? "?"}{/yellow-fg}`,
    `  Messages  {white-fg}${session.messageCount}{/white-fg}`,
    `  Agents    {white-fg}${agents.length}{/white-fg}`,
    "",
    `  {bold}{yellow-fg}Token Usage (cumulative API calls){/yellow-fg}{/bold}`,
    `  Input     {cyan-fg}${formatTokens(t.input_tokens)}{/cyan-fg}`,
    `  Output    {yellow-fg}${formatTokens(t.output_tokens)}{/yellow-fg}`,
    `  Cache rd  {green-fg}${formatTokens(t.cache_read_input_tokens)}{/green-fg}`,
    `  Cache wr  {gray-fg}${formatTokens(t.cache_creation_input_tokens)}{/gray-fg}`,
    "",
    `  {bold}{yellow-fg}Estimated Cost{/yellow-fg}{/bold}`,
    `  Input     {cyan-fg}${formatCost(cost.inputCost, cost.pricingKnown)}{/cyan-fg}`,
    `  Output    {yellow-fg}${formatCost(cost.outputCost, cost.pricingKnown)}{/yellow-fg}`,
    `  Cache rd  {green-fg}${formatCost(cost.cacheReadCost, cost.pricingKnown)}{/green-fg}`,
    `  Cache wr  {gray-fg}${formatCost(cost.cacheCreationCost, cost.pricingKnown)}{/gray-fg}`,
    `  {bold}Total     {yellow-fg}${formatCost(cost.total, cost.pricingKnown)}{/yellow-fg}{/bold}`,
  ].join("\n");

  blessed.box({
    parent: container,
    top: 3,
    left: 0,
    width: "40%",
    height: 22,
    tags: true,
    border: { type: "line" },
    label: " Info ",
    style: {
      fg: COLORS.fg,
      bg: COLORS.bg,
      border: { fg: COLORS.top.border },
      label: { fg: COLORS.top.label, bold: true },
    },
    content: infoLines,
  });

  // ── Agents panel ───────────────────────────────────────────────────────────
  const agentLines =
    agents.length > 0
      ? agents.map(
          (a) =>
            `  {cyan-fg}${a.agentId.slice(0, 8)}{/cyan-fg}  {yellow-fg}${truncate(a.agentType, 10)}{/yellow-fg}  ${a.messageCount}msg  {gray-fg}${truncate(a.description, 16)}{/gray-fg}`
        )
      : ["  {gray-fg}No agents{/gray-fg}"];

  blessed.box({
    parent: container,
    top: 25,
    left: 0,
    width: "40%",
    height: "100%-26",
    tags: true,
    border: { type: "line" },
    label: ` Agents (${agents.length}) `,
    scrollable: true,
    mouse: mouseEnabled,
    keys: true,
    vi: true,
    style: {
      fg: COLORS.fg,
      bg: COLORS.bg,
      border: { fg: COLORS.mid.border },
      label: { fg: COLORS.mid.label, bold: true },
    },
    content: agentLines.join("\n"),
  });

  // ── Messages panel (focused — j/k scrolls here) ────────────────────────────
  const messageLines = entries
    .filter((e) => e.type === "user" || e.type === "assistant")
    .slice(-50)
    .map((e) => {
      const time = formatTime(e.timestamp);
      const role =
        e.type === "user"
          ? "{green-fg}[you ]{/green-fg}"
          : "{cyan-fg}[asst]{/cyan-fg}";
      let content = "";
      if (e.message?.content) {
        if (typeof e.message.content === "string") {
          content = truncate(e.message.content.replace(/\n/g, " "), 66);
        } else if (Array.isArray(e.message.content)) {
          const textBlock = (
            e.message.content as Array<{ type: string; text?: string }>
          ).find((b) => b.type === "text");
          content = truncate((textBlock?.text ?? "...").replace(/\n/g, " "), 66);
        }
      }
      return `  {gray-fg}${time}{/gray-fg} ${role}  ${content}`;
    });

  const messages = blessed.box({
    parent: container,
    top: 3,
    left: "40%",
    width: "60%",
    height: "100%-4",
    tags: true,
    border: { type: "line" },
    label: " Messages (j/k to scroll) ",
    scrollable: true,
    mouse: mouseEnabled,
    keys: true,
    vi: true,
    alwaysScroll: true,
    style: {
      fg: COLORS.fg,
      bg: COLORS.bg,
      border: { fg: COLORS.mid.border },
      label: { fg: COLORS.mid.label, bold: true },
    },
    content: messageLines.length > 0
      ? messageLines.join("\n")
      : "  {gray-fg}No conversation entries found{/gray-fg}",
  });

  screen.append(container);
  // Focus messages so j/k scrolls immediately
  messages.focus();
  screen.render();

  // Scroll to latest — must be after render so _clines is initialized
  (messages as unknown as { setScrollPerc: (n: number) => void }).setScrollPerc(100);
  screen.render();

  const closeHandler = () => {
    container.destroy();
    screen.render();
    onClose();
  };

  // Register close on both the messages panel (default focus) and the container
  messages.key(["escape", "q"], closeHandler);
  container.key(["escape", "q"], closeHandler);
  // Clicking the header (which reads "[Esc/q: back]") performs that action —
  // the views are full-screen, so there is no "outside" to click. Registering
  // a click listener is itself enough to make blessed enable the terminal's
  // mouse protocol, so this is skipped when --no-mouse is set.
  if (mouseEnabled) {
    header.on("click", closeHandler);
  }

  return closeHandler;
}
