import type blessed from "blessed";
import { TABLE_PANEL_INDICES } from "./theme.js";
import type { FocusController } from "./keybindings.js";

/** Actions dispatchable from the status-bar hint buttons. */
export type HintAction = "tab" | "refresh" | "help" | "quit";

export interface HintRegion {
  start: number;
  end: number;
  action: HintAction;
}

/**
 * Convert an absolute click row into a data-row index for a blessed list.
 * Lists have no border; the item at the list's top edge is item `childBase`
 * (the scroll offset). Returns -1 for clicks above the list.
 */
export function rowIndexFromClick(
  absoluteY: number,
  rowsTop: number,
  childBase: number
): number {
  const visibleRow = absoluteY - rowsTop;
  if (visibleRow < 0) return -1;
  return visibleRow + childBase;
}

/** Hint tokens that act as buttons. [1-7] is deliberately absent — a range is not one action. */
const HINT_TOKENS: ReadonlyArray<readonly [string, HintAction]> = [
  ["[Tab]", "tab"],
  ["[r]", "refresh"],
  ["[?]", "help"],
  ["[q]", "quit"],
];

/** Locate the clickable hint tokens in the rendered (tag-stripped) status text. */
export function hintRegions(plainStatusText: string): HintRegion[] {
  const regions: HintRegion[] = [];
  for (const [token, action] of HINT_TOKENS) {
    const start = plainStatusText.indexOf(token);
    if (start === -1) continue;
    regions.push({ start, end: start + token.length - 1, action });
  }
  return regions.sort((a, b) => a.start - b.start);
}

/**
 * Convert an absolute click column into a column within a widget's rendered
 * content. Bordered widgets (e.g. `border: {type: "line"}`) render content
 * starting at `aleft + ileft`, not `aleft` — blessed's `ileft` is 1 for a
 * line border, 0 for none. Skipping the inset silently shifts every hit-test
 * one column left of what's actually on screen.
 */
export function contentColumnFromClick(
  absoluteX: number,
  aleft: number,
  ileft: number
): number {
  return absoluteX - aleft - ileft;
}

/** The action whose region contains `column`, or null. Bounds are inclusive. */
export function hintActionAt(
  regions: HintRegion[],
  column: number
): HintAction | null {
  for (const r of regions) {
    if (column >= r.start && column <= r.end) return r.action;
  }
  return null;
}

export type RowClickOutcome = "select" | "drill";

/** Click-once selects; click-the-selected-row drills. No double-click timing. */
export function rowClickOutcome(
  clickedIndex: number,
  currentSelected: number
): RowClickOutcome {
  return clickedIndex === currentSelected ? "drill" : "select";
}

type MouseElement = blessed.Widgets.BlessedElement & {
  atop: number;
  childBase?: number;
  selected?: number;
  select?: (index: number) => void;
  scroll?: (offset: number) => void;
};

/**
 * Wire mouse navigation. Must be called after every rebuildLayout() — resize
 * destroys and recreates all widgets, dropping these listeners with them.
 * Registering mouse handlers is what makes blessed enable the terminal's
 * mouse protocol, so when --no-mouse is set this function is never called.
 */
export function setupMouse(
  screen: blessed.Widgets.Screen,
  panels: blessed.Widgets.BlessedElement[],
  controller: FocusController,
  callbacks: {
    onDrillIn: (panelIndex: number) => void;
    isOverlayOpen: () => boolean;
  }
): void {
  panels.forEach((panel, index) => {
    const isTable = TABLE_PANEL_INDICES.has(index);
    const rows = isTable
      ? (panel as unknown as { rows?: MouseElement }).rows
      : undefined;
    const target = (rows ?? panel) as MouseElement;

    // Focus-on-click for every panel; row handling for tables.
    target.on("click", (data: { x: number; y: number }) => {
      if (callbacks.isOverlayOpen()) return;
      controller.focusPanel(index);
      if (!rows) return;

      // VERIFY-ON-TERMINAL: if row clicks land one off, pass rows.atop + 1
      // here (see plan Task 3 notes).
      const clicked = rowIndexFromClick(data.y, rows.atop, rows.childBase ?? 0);
      if (clicked < 0) return;
      if (rowClickOutcome(clicked, rows.selected ?? 0) === "drill") {
        callbacks.onDrillIn(index);
      } else {
        rows.select?.(clicked);
        screen.render();
      }
    });

    // Wheel: move table selection / scroll log panels.
    target.on("wheelup", () => {
      if (callbacks.isOverlayOpen()) return;
      if (rows) rows.select?.(Math.max(0, (rows.selected ?? 0) - 1));
      else target.scroll?.(-1);
      screen.render();
    });
    target.on("wheeldown", () => {
      if (callbacks.isOverlayOpen()) return;
      if (rows) rows.select?.((rows.selected ?? 0) + 1);
      else target.scroll?.(1);
      screen.render();
    });
  });
}

/**
 * Wire the status-bar hint buttons ([Tab] [r] [?] [q]). [1-7] is inert by
 * design — see HINT_TOKENS. Hit-testing runs against the caller-supplied
 * rendered plain text so variable-width fields (cost, token count) can't
 * desync the click regions from what's actually on screen.
 *
 * Must be re-wired per widget generation exactly like setupMouse — the
 * statusBar widget is recreated on every rebuildLayout() (e.g. on resize).
 */
export function setupStatusBarMouse(
  statusBar: blessed.Widgets.BlessedElement & { aleft: number; ileft: number },
  controller: FocusController,
  getPlainText: () => string,
  actions: {
    refresh: () => void;
    help: () => void;
    quit: () => void;
  },
  isOverlayOpen: () => boolean
): void {
  statusBar.on("click", (data: { x: number }) => {
    if (isOverlayOpen()) return;
    const column = contentColumnFromClick(
      data.x,
      statusBar.aleft,
      statusBar.ileft ?? 0
    );
    const action = hintActionAt(hintRegions(getPlainText()), column);
    switch (action) {
      case "tab":
        controller.focusPanel(controller.getFocusIndex() + 1);
        break;
      case "refresh":
        actions.refresh();
        break;
      case "help":
        actions.help();
        break;
      case "quit":
        actions.quit();
        break;
    }
  });
}
