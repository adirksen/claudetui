# claudetui

**How much did Claude Code cost you today? Which session is burning tokens right now? Which one is stuck?**

claudetui answers all three at a glance, live, in your terminal — inspired by `htop` and `btop`.

![claudetui dashboard: live sessions, today's token spend, sub-agents, command history, and per-tool costs — then drilling into a session's full cost breakdown](docs/demo.gif)

*Recorded against a synthetic `~/.claude` (see `docs/make-demo-home.mjs`) — no real conversations were harmed.*

## Why

Claude Code tells you what it's doing right now, in one terminal. It doesn't tell you what
*all* of your sessions are doing, what they've cost, or which tools are quietly eating your
context window. That information is sitting in `~/.claude/` — claudetui just shows it to you.

**Running more than one session at a time?** That's when a dashboard stops being a curiosity
and starts being mission control: which of your five sessions is still working, which
sub-agent has been running for twenty minutes, what last night's autonomous run actually cost.

**On a Pro or Max plan?** The dollar figures are API-equivalent value, not a bill — a useful
way to see what your subscription is doing for you, and which projects are getting the most
out of it.

**Paying per token?** The numbers are real. claudetui prices every session with the model that
session actually ran on, using current published rates.

> **claudetui vs. `ccusage` and friends:** those tools produce retrospective cost reports, and do
> it well. claudetui is a live process monitor that happens to know about costs — running
> processes, active sub-agents, system load, and spend on one screen that updates as you work.

## What each panel tells you

| Panel | The question it answers |
|-------|--------------------------|
| **Sessions** | Which Claude Code processes are running, in which project, for how long, on which model |
| **Tokens** | What today cost, split by input / output / cache — plus a per-session breakdown |
| **Agents** | Which sub-agents your sessions spawned, and how much work each one did |
| **History** | What you've asked for recently across every project — press `Enter` for the full session |
| **Projects** | Where your Claude Code time actually goes |
| **Plugins & MCP** | Installed plugins, MCP servers needing re-auth, and **which tools eat your context window** |
| **System** | CPU, memory, and what claudetui itself is costing you in RAM |

The Plugins panel is the one people find most immediately actionable: it ranks today's tool
calls by estimated token cost, so when `bash` results turn out to be 40% of your input tokens,
you know there's something to fix.

Press `Enter` on Sessions or History to drill into a full session — scrollable message
history, token breakdown by type, and the sub-agents it spawned.

## Install

```bash
git clone https://github.com/adirksen/claudetui.git
cd claudetui
npm install
npm run dev          # run directly, no build step
```

To build a standalone bundle and put it on your `PATH`:

```bash
npm run build
npm link             # then run `claudetui` from anywhere
```

> **Not on npm yet.** The name `claudetui` is taken by an unrelated package, so
> `npx claudetui` installs someone else's tool — don't. Install from source until a
> published name is settled.

### Requirements

- Node.js 20+
- [Claude Code](https://claude.ai/code) installed and used at least once (claudetui reads `~/.claude/`)
- macOS, Linux, or Windows

## Keybindings

| Key | Action |
|-----|--------|
| `Tab` / `Shift+Tab` | Cycle focus between panels |
| `1` – `7` | Jump to panel by number |
| `Enter` | Drill into Sessions or History |
| `Esc` / `q` | Close drill-down / quit |
| `r` | Force refresh all data |
| `?` | Toggle help overlay |
| `Ctrl+C` | Quit |

Within drill-down views, `j` / `k` or arrow keys scroll content.

### Mouse

Mouse support is on by default: click a panel to focus it, click a row to
select it and click it again to drill in, scroll with the wheel, and click
the status-bar hints (`[Tab]`, `[r]`, `[?]`, `[q]`) as buttons. In
drill-down views the header's `[Esc: back]` is clickable and the wheel
scrolls messages.

Terminal notes: with the mouse protocol on, select text with **Shift+drag**
(standard xterm behavior). Run with `--no-mouse` to disable mouse support
entirely and restore normal drag-selection. In tmux, `set -g mouse on` is
required for passthrough. Legacy Windows conhost handles mouse protocols
poorly — use Windows Terminal.

## Privacy

**claudetui sends no telemetry and your conversations never leave your machine.** It reads
local files under `~/.claude/` and nothing else. Its one network call is an optional
startup fetch of public model pricing (LiteLLM's community catalog — see "How the numbers
are calculated"); nothing local is sent, and when offline the built-in table is used.

The only external commands it runs are for process discovery: `pgrep` and `lsof` on
macOS/Linux, a PowerShell `Get-CimInstance` process query on Windows.

| Data | Source |
|------|--------|
| Sessions | `~/.claude/history.jsonl` (derived — Claude Code no longer writes session files) |
| Token usage & messages | `~/.claude/projects/<encoded-path>/<session-id>.jsonl` |
| Sub-agents | `~/.claude/projects/<encoded-path>/<session-id>/subagents/` |
| Running Claude processes | `pgrep` + `lsof` (macOS/Linux) / PowerShell `Get-CimInstance` (Windows) |
| Installed plugins | `~/.claude/plugins/installed_plugins.json` |
| MCP auth status | `~/.claude/mcp-needs-auth-cache.json` |
| Settings / model | `~/.claude/settings.json` |

## How the numbers are calculated

**Token counts are exact.** They come from the `usage` field Claude Code records for every
assistant turn — claudetui does not estimate them.

**Costs** are those token counts multiplied by [Anthropic's published
pricing](https://www.anthropic.com/pricing), using the model recorded in each session's own
transcript. A session that ran on Opus is priced as Opus even if your current default is
Sonnet. Cache reads bill at 0.1× the input rate and cache writes at 1.25×, matching the
5-minute cache Claude Code uses.

Per-session cost is **cumulative API cost**: every turn resends the whole conversation, so
long sessions compound — that's real spend, not double-counting.

A cost shown as `~$1.24` means the model wasn't in claudetui's pricing table and a rate from the
same model family was substituted. A cost without the `~` is list price × exact token count.
If you're on a subscription plan, treat every figure as API-equivalent value rather than a bill.

**Tool costs in the Plugins panel are the one real estimate.** Tool results carry no usage
data of their own, so their input cost is derived from result size (characters ÷ 4 ≈ tokens).
Read them as a ranking of which tools are expensive, not as an exact number.

**Pricing stays current automatically.** At startup, claudetui fetches current rates from
[LiteLLM's community pricing catalog](https://github.com/BerriAI/litellm) and layers them over
the built-in table, caching the result on disk for 24 hours under `~/.cache/claudetui/`. If the
fetch fails or you're offline, claudetui uses a fresh disk cache when available and otherwise
falls back to built-in rates — costs are never blocked on network access.

## Architecture

```
bin/claudetui.ts          Entrypoint — starts the TUI app
src/
  app.ts              Main loop: layout, keybindings, refresh cycle, drill-down routing
  config.ts           Paths, intervals, model pricing table
  types.ts            Shared interfaces (ActiveSession, HistoryEntry, TokenUsage, …)
  data/               Raw readers (JSONL, process list, file system)
    conversation-cache.ts   mtime-validated, incrementally-appending transcript cache
  aggregators/        Data aggregation (sessions, today's tokens + tool costs, projects, agents)
  ui/
    layout.ts         12×12 blessed-contrib grid definition
    theme.ts          Color palette (amber top / teal mid / purple bot)
    keybindings.ts    Tab/Enter/number key routing
    loading-overlay.ts  Randomized ASCII art spinner shown during resize/startup
    panels/           Per-panel update functions (sessions, tokens, system, …)
    views/            Full-screen drill-down overlays (session detail, history detail)
  util/               JSONL parsing, formatting helpers
```

Transcripts are parsed once and cached against `(mtime, size)`; a file that grows is re-parsed
only from the byte where the last read stopped. Aggregates scoped to today skip transcripts
last modified before midnight. In a directory with 291 transcripts totalling 134 MB, a
steady-state refresh costs about 25 ms.

## Known limitations

- **Tool cost attribution is an estimate** (result size ÷ 4), not an exact token count.
- **Session liveness needs `lsof`.** Sessions are matched to processes by working directory.
  Where that's unavailable — Windows, or a restricted `lsof` — claudetui shows no PID rather than
  a possibly-wrong one, and falls back to marking recently-active sessions as live.
- **Windows liveness is heuristic.** Claude Code processes are found by command-line
  matching (npm installs run under `node.exe`, bun installs under `bun.exe`, the native
  installer as `claude.exe`; Claude Desktop is excluded), but Windows can't report another
  process's working directory, so sessions get the recently-active fallback above with no
  PID column. If you run Claude Code inside WSL, run claudetui inside WSL too — processes
  and `~/.claude` aren't visible across the WSL/Windows boundary.
- **Two sessions in the same directory** are matched to that directory's processes by
  recency, which can transpose them.
- **Very large `history.jsonl` files** (100k+ entries) add a small startup delay.

## License

MIT — Anthony Dirksen
