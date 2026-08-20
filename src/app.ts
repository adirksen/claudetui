import blessed from "blessed";
import { createDashboard, type DashboardWidgets } from "./ui/layout.js";
import { setupKeybindings, type FocusController } from "./ui/keybindings.js";
import { setupMouse, setupStatusBarMouse } from "./ui/mouse.js";
import { COLORS, PANEL_BORDER_COLORS, TABLE_PANEL_INDICES } from "./ui/theme.js";
import { INTERVALS, applyPricingOverrides } from "./config.js";
import { showLoadingOverlay } from "./ui/loading-overlay.js";

// Data aggregators
import { getAllSessions } from "./aggregators/session-aggregator.js";
import { getTodayStats } from "./aggregators/today-aggregator.js";
import { aggregateProjects } from "./aggregators/project-aggregator.js";
import { aggregateAgents } from "./aggregators/agent-aggregator.js";
import { getRecentHistory } from "./data/history-reader.js";
import { readSettings } from "./data/settings-reader.js";
import { readInstalledPlugins } from "./data/plugin-reader.js";
import { readMcpAuthIssues } from "./data/mcp-reader.js";
import { getSystemStats } from "./data/process-monitor.js";
import { readConversation } from "./data/conversation-reader.js";
import { initLivePricing } from "./data/pricing-fetcher.js";

// Panel updaters
import { updateSessionsPanel } from "./ui/panels/sessions-panel.js";
import { updateTokensPanel, resetFingerprint as resetTokensFP } from "./ui/panels/tokens-panel.js";
import { updateAgentsPanel } from "./ui/panels/agents-panel.js";
import { updateHistoryPanel } from "./ui/panels/history-panel.js";
import { updateProjectsPanel } from "./ui/panels/projects-panel.js";
import { updateSystemPanel, resetFingerprint as resetSystemFP } from "./ui/panels/system-panel.js";
import { updatePluginsPanel, resetFingerprint as resetPluginsFP } from "./ui/panels/plugins-panel.js";
import { clearLog } from "./ui/panels/log-utils.js";

// File watcher
import { ClaudeFileWatcher } from "./data/file-watcher.js";

// Drill-down views
import { showSessionDetail } from "./ui/views/session-detail.js";
import { showHistoryDetail } from "./ui/views/history-detail.js";

// Utils
import { formatDuration, formatTokens, formatCost } from "./util/format.js";
import { estimateCost, sumCosts } from "./aggregators/token-aggregator.js";
import type { ActiveSession, HistoryEntry } from "./types.js";

// ── Module state ──────────────────────────────────────────────────────────────

let widgets: DashboardWidgets;
let screen: blessed.Widgets.Screen;
let refreshTimer: ReturnType<typeof setInterval> | undefined;
let systemTimer: ReturnType<typeof setInterval> | undefined;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;
const fileWatcher = new ClaudeFileWatcher();
let cachedSessions: ActiveSession[] = [];
let cachedHistory: HistoryEntry[] = [];
let inDrillDown = false;
let hideLoading: (() => void) | undefined;
// Assigned in startApp; read by mouse click routing.
let focusController: FocusController;
// Task 6 threads this flag from --no-mouse.
let mouseEnabled = true;
// Task 5's help overlay toggles this; initialized false is harmless until then.
let helpOpen = false;
// Tag-stripped rendered status text, kept in sync inside updateStatusBar so
// status-bar hit-testing always matches what's actually on screen.
let statusPlainText = "";
// Assigned in startApp; wireMouse() shares this with the "q"/Ctrl+C keybinding
// so keyboard and mouse quit through the exact same code path.
let quitApp: () => void = () => {};

// A single refresh scans every recent transcript, so overlapping runs would
// compete for the same I/O. One runs at a time; requests that arrive mid-run
// collapse into a single follow-up.
let refreshInFlight = false;
let refreshQueued = false;

// Mutable — keybinding closures capture this reference so resize updates work
const focusable: (blessed.Widgets.BlessedElement & { focus: () => void })[] = [];

// ── Panel index constants (must match focusable[] order) ─────────────────────
const SESSIONS_PANEL_INDEX = 0;
const HISTORY_PANEL_INDEX = 4;

// ── Layout helpers ────────────────────────────────────────────────────────────

/**
 * Destroy the old grid and recreate all widgets for the current terminal size.
 * Updates `widgets` and `focusable` in-place so keybinding closures stay valid.
 * Also wires up focus-highlight listeners on the new widgets.
 */
function rebuildLayout(): void {
  if (widgets?.grid) {
    (widgets.grid as unknown as { destroy?: () => void }).destroy?.();
  }

  widgets = createDashboard(screen);

  focusable.length = 0;
  focusable.push(
    ...[
      widgets.sessions,
      widgets.tokens,
      widgets.system,
      widgets.agents,
      widgets.history,
      widgets.projects,
      widgets.plugins,
    ] as unknown as (blessed.Widgets.BlessedElement & { focus: () => void })[]
  );

  setupFocusHighlighting();

  // Re-wire mouse listeners — rebuild destroys and recreates every widget, so
  // any prior listeners are gone with them. Guarded: on the very first call
  // (from startApp, before setupKeybindings runs) focusController is still
  // undefined; startApp makes the one explicit wireMouse() call for that case.
  if (mouseEnabled && focusController) {
    wireMouse();
  }

  // Reset stale fingerprints so fresh widgets always get populated after rebuild
  resetTokensFP();
  resetSystemFP();
  resetPluginsFP();
}

/**
 * Attach focus/blur listeners to each panel so the active panel gets a white border.
 * For blessed-contrib tables the focus lands on the inner `rows` list — must
 * listen there, not on the table wrapper.
 */
function setupFocusHighlighting(): void {
  focusable.forEach((panel, i) => {
    const origColor = PANEL_BORDER_COLORS[i] ?? "white";

    // Tables delegate focus to their inner rows list
    const target = TABLE_PANEL_INDICES.has(i)
      ? (panel as unknown as { rows: blessed.Widgets.BlessedElement }).rows
      : panel;

    if (!target) return;

    // Do NOT call screen.render() here — Table.render() calls rows.focus()
    // which would re-fire focus → render → focus → stack overflow.
    // The keybinding's focusPanel() calls screen.render() after focus() returns.
    target.on("focus", () => {
      (
        panel as unknown as { style: { border: { fg: string } } }
      ).style.border.fg = COLORS.focus;
    });

    target.on("blur", () => {
      (
        panel as unknown as { style: { border: { fg: string } } }
      ).style.border.fg = origColor;
    });
  });
}

/** setupMouse/setupStatusBarMouse call shared by rebuildLayout()'s resize path and startApp's initial wiring. */
function wireMouse(): void {
  const isOverlayOpen = () => inDrillDown || helpOpen;
  setupMouse(screen, focusable, focusController, {
    onDrillIn: (panelIndex) => {
      if (panelIndex === HISTORY_PANEL_INDEX) void drillIntoHistory();
      else if (panelIndex === SESSIONS_PANEL_INDEX) void drillIntoSession();
    },
    isOverlayOpen,
  });
  setupStatusBarMouse(
    widgets.statusBar as unknown as blessed.Widgets.BlessedElement & { aleft: number },
    focusController,
    () => statusPlainText,
    {
      refresh: () => void refreshAll(),
      help: () => showHelp(),
      quit: quitApp,
    },
    isOverlayOpen
  );
}

function showLoading(label = "Loading..."): void {
  hideLoading?.();
  hideLoading = showLoadingOverlay(screen, label);
}

function dismissLoading(): void {
  hideLoading?.();
  hideLoading = undefined;
}

// ── App lifecycle ─────────────────────────────────────────────────────────────

/**
 * Start the TUI application.
 * Returns a promise that resolves only when the user quits (q / Ctrl+C).
 */
export async function startApp(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    try {
      screen = blessed.screen({
        smartCSR: true,
        title: "claudetui — Claude Code Monitor",
        fullUnicode: true,
        warnings: false,
      });

      screen.on("error", (err: Error) => {
        process.stderr.write(`[claudetui] screen error: ${err.message}\n`);
      });

      quitApp = () => void stopApp().then(resolve);

      rebuildLayout();

      focusController = setupKeybindings(screen, focusable, {
        onRefresh: () => void refreshAll(),
        onDrillIn: (panelIndex) => {
          if (panelIndex === HISTORY_PANEL_INDEX) {
            void drillIntoHistory();
          } else if (panelIndex === SESSIONS_PANEL_INDEX) {
            void drillIntoSession();
          }
          // All other panels: no drill-down (prevents crashes)
        },
        onDrillOut: () => {
          // Handled by each detail view's own Esc handler
        },
        onHelp: () => showHelp(),
      });

      // First rebuildLayout() ran before focusController existed (its own
      // guard skipped setupMouse), so wire it explicitly here. Every
      // subsequent rebuild (resize) re-wires itself via the guard above.
      if (mouseEnabled) {
        wireMouse();
      }

      // Rebuild grid on terminal resize (contrib.grid uses absolute px at creation time)
      screen.on("resize", () => {
        if (inDrillDown) return;
        showLoading("Resizing...");
        rebuildLayout();
        screen.render(); // Ensure widgets are positioned before refreshAll populates them
        void refreshAll();
      });

      screen.key(["q", "C-c"], quitApp);

      // Initial load
      void (async () => {
        try {
          showLoading("Starting up...");
          await initLivePricing({
            apply: applyPricingOverrides,
            onLiveUpdate: () => void refreshAll(),
          });
          await refreshAll();

          await fileWatcher.start();
          for (const event of [
            "conversation-changed",
            "history-changed",
            "plugins-changed",
            "settings-changed",
            "mcp-changed",
          ] as const) {
            fileWatcher.on(event, scheduleRefresh);
          }
          fileWatcher.on("watch-error", (err: Error) => {
            process.stderr.write(`[claudetui] watch error: ${err.message}\n`);
          });

          refreshTimer = setInterval(
            () => void refreshAll(),
            INTERVALS.pidCheck
          );
          systemTimer = setInterval(
            () => refreshSystemPanel(),
            INTERVALS.systemResources
          );

          screen.render();
        } catch (err) {
          dismissLoading();
          process.stderr.write(
            `[claudetui] init error: ${err instanceof Error ? err.message : String(err)}\n`
          );
          screen.render();
        }
      })();
    } catch (err) {
      reject(err);
    }
  });
}

// ── Data refresh ─────────────────────────────────────────────────────────────

/** Coalesce bursts of watcher events into one refresh. */
function scheduleRefresh(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = undefined;
    void refreshAll();
  }, INTERVALS.refreshDebounce);
}

async function refreshAll(): Promise<void> {
  if (inDrillDown) return;

  if (refreshInFlight) {
    refreshQueued = true;
    return;
  }
  refreshInFlight = true;

  try {
    const [sessions, history, projects, settings, plugins, mcpIssues, today] =
      await Promise.all([
        getAllSessions(),
        getRecentHistory(200),
        aggregateProjects(),
        readSettings(),
        readInstalledPlugins(),
        readMcpAuthIssues(),
        getTodayStats(),
      ]);

    cachedSessions = sessions;
    cachedHistory = history;
    const agents = await aggregateAgents(sessions);

    updateSessionsPanel(widgets.sessions, sessions);
    updateAgentsPanel(widgets.agents, agents);
    updateHistoryPanel(widgets.history, history.slice(-20));
    updateProjectsPanel(widgets.projects, projects);
    updatePluginsPanel(widgets.plugins, plugins, mcpIssues, today.toolStats);
    updateTokensPanel(widgets.tokens, sessions, today);

    refreshSystemPanel(sessions);
    updateStatusBar(sessions, settings.model);

    screen.render();
  } catch {
    // Don't crash on refresh errors
    screen.render();
  } finally {
    refreshInFlight = false;
    dismissLoading();
    if (refreshQueued) {
      refreshQueued = false;
      scheduleRefresh();
    }
  }
}

function refreshSystemPanel(sessions?: ActiveSession[]): void {
  try {
    const effective = sessions ?? cachedSessions;
    const pids = effective.filter((s) => s.isAlive).map((s) => s.pid);
    pids.push(process.pid);
    const stats = getSystemStats(pids);
    updateSystemPanel(widgets.system, stats);
    screen.render();
  } catch {
    // System panel fails gracefully
  }
}

function updateStatusBar(sessions: ActiveSession[], model?: string): void {
  const aliveCount = sessions.filter((s) => s.isAlive).length;
  const totalTokens = sessions.reduce(
    (sum, s) => sum + s.totalTokens.input_tokens + s.totalTokens.output_tokens,
    0
  );
  const oldest = sessions[sessions.length - 1];
  const uptime = oldest
    ? formatDuration(Date.now() - oldest.startedAt)
    : "—";

  // Price each session with the model it actually ran on — the configured model
  // in settings.json only describes new sessions, not historical ones.
  const cost = sumCosts(
    sessions.map((s) => estimateCost(s.totalTokens, s.model))
  );

  // Labels are plain text, not emoji, on purpose. blessed computes emoji as one
  // cell where the terminal draws two, so every redraw landed a cell to the left
  // of the last one and the status bar accumulated garbage — "$1955.41" became
  // "81775.41" within seconds. Single-width glyphs only here.
  const statusText = [
    `{gray-fg}model{/gray-fg} {yellow-fg}${model?.replace("claude-", "") ?? "?"}{/yellow-fg}`,
    `{green-fg}${aliveCount} alive{/green-fg}`,
    `{cyan-fg}${formatTokens(totalTokens)}{/cyan-fg} {gray-fg}tok{/gray-fg}`,
    `{yellow-fg}${formatCost(cost.total, cost.pricingKnown)}{/yellow-fg}`,
    `{gray-fg}up ${uptime}{/gray-fg}`,
    `{gray-fg}[Tab] [1-7] [r] [?] [q]{/gray-fg}`,
  ].join("  {gray-fg}│{/gray-fg}  ");

  // Tag-stripped equivalent of what's actually rendered, including the
  // leading space log() prepends — status-bar hit-testing keys off this.
  statusPlainText = ` ${statusText.replace(/\{[^}]+\}/g, "")}`;

  clearLog(widgets.statusBar);
  widgets.statusBar.log(` ${statusText}`);
}

// ── Drill-down ────────────────────────────────────────────────────────────────

async function drillIntoSession(): Promise<void> {
  // .rows is the inner blessed.list — .selected is 0-based into data rows
  const selectedIndex =
    (widgets.sessions as unknown as { rows?: { selected?: number } }).rows?.selected ?? 0;
  const session = cachedSessions[selectedIndex];
  if (!session) return;

  inDrillDown = true;

  // Use the pre-matched project dir from aggregateSessions (avoids path mismatch)
  const projectDir = session.encodedProjectDir;
  const [agents, entries] = await Promise.all([
    import("./data/agent-reader.js").then((m) =>
      m.readAgents(projectDir, session.sessionId)
    ),
    readConversation(projectDir, session.sessionId),
  ]);

  showSessionDetail(screen, session, agents, entries, () => {
    inDrillDown = false;
    void refreshAll();
  });
}

async function drillIntoHistory(): Promise<void> {
  // .rows is the inner blessed.list — .selected is 0-based into data rows
  const selectedIndex =
    (widgets.history as unknown as { rows?: { selected?: number } }).rows?.selected ?? 0;
  const recentEntries = cachedHistory.slice(-20);
  const entry = recentEntries[selectedIndex];
  if (!entry) return;

  inDrillDown = true;
  await showHistoryDetail(screen, entry, cachedHistory);
  inDrillDown = false;
  void refreshAll();
}

// ── Help overlay ──────────────────────────────────────────────────────────────

function showHelp(): void {
  const helpBox = blessed.box({
    top: "center",
    left: "center",
    width: 52,
    height: 18,
    tags: true,
    border: { type: "line" },
    style: {
      fg: COLORS.fg,
      bg: COLORS.bg,
      border: { fg: COLORS.top.accent },
      label: { fg: COLORS.top.accent, bold: true },
    },
    label: " claudetui Help ",
    content: [
      "",
      "  {bold}claudetui{/bold} — Claude Code Monitor",
      "",
      "  {yellow-fg}Tab / Shift+Tab{/yellow-fg}   Cycle panels",
      "  {yellow-fg}1 – 7{/yellow-fg}             Jump to panel",
      "  {yellow-fg}Enter{/yellow-fg}             Drill into session / history",
      "  {yellow-fg}Esc{/yellow-fg}               Back",
      "  {yellow-fg}r{/yellow-fg}                 Force refresh",
      "  {yellow-fg}q / Ctrl+C{/yellow-fg}        Quit",
      "  {yellow-fg}?{/yellow-fg}                 Toggle help",
      "",
      "  {cyan-fg}⚡ Sessions{/cyan-fg}  — Enter to drill in",
      "  {cyan-fg}📜 History{/cyan-fg}   — Enter for session detail",
      "",
      "  Press any key to close",
    ].join("\n"),
  });

  screen.append(helpBox);
  helpBox.focus();
  screen.render();

  helpBox.key(["escape", "q", "?", "enter", "space"], () => {
    helpBox.destroy();
    screen.render();
  });
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

export function stopApp(): Promise<void> {
  if (refreshTimer) clearInterval(refreshTimer);
  if (systemTimer) clearInterval(systemTimer);
  if (debounceTimer) clearTimeout(debounceTimer);
  refreshTimer = undefined;
  systemTimer = undefined;
  debounceTimer = undefined;
  dismissLoading();
  screen?.destroy();
  return fileWatcher.stop();
}
