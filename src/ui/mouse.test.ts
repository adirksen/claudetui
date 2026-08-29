import { EventEmitter } from "node:events";
import { describe, it, expect, vi } from "vitest";
import type blessed from "blessed";
import type { FocusController } from "./keybindings.js";
import {
  rowIndexFromClick,
  hintRegions,
  hintActionAt,
  rowClickOutcome,
  contentColumnFromClick,
  isPointInBounds,
  parseMouseFlag,
  setupMouse,
  setupStatusBarMouse,
  type HintRegion,
} from "./mouse.js";

describe("rowIndexFromClick", () => {
  it("maps a click on the first visible row to the first data index", () => {
    expect(rowIndexFromClick(5, 5, 0)).toBe(0);
  });

  it("offsets by the list's scroll position (childBase)", () => {
    // List scrolled down 3 rows: clicking the top visible row = data row 3.
    expect(rowIndexFromClick(5, 5, 3)).toBe(3);
  });

  it("maps a click further down the list", () => {
    expect(rowIndexFromClick(9, 5, 2)).toBe(6);
  });

  it("returns -1 for a click above the list", () => {
    expect(rowIndexFromClick(4, 5, 0)).toBe(-1);
  });
});

describe("hintRegions", () => {
  // Rendered status text, tags stripped. [1-7] is deliberately inert.
  const text = " model sonnet  │  3 alive  │  [Tab] [1-7] [r] [?] [q]";

  it("finds the four actionable hint tokens with correct columns", () => {
    const regions = hintRegions(text);
    expect(regions.map((r) => r.action)).toEqual([
      "tab",
      "refresh",
      "help",
      "quit",
    ]);
    for (const r of regions) {
      expect(text.slice(r.start, r.end + 1)).toMatch(/^\[(Tab|r|\?|q)\]$/);
    }
  });

  it("does not produce a region for [1-7]", () => {
    const regions = hintRegions(text);
    const oneToSeven = text.indexOf("[1-7]");
    expect(
      regions.some((r) => r.start <= oneToSeven && oneToSeven <= r.end)
    ).toBe(false);
  });

  it("returns [] when the text has no hint tokens", () => {
    expect(hintRegions("no hints here")).toEqual([]);
  });
});

describe("hintActionAt", () => {
  const regions: HintRegion[] = [
    { start: 10, end: 14, action: "tab" },
    { start: 22, end: 24, action: "refresh" },
  ];

  it("returns the action whose region contains the column (inclusive)", () => {
    expect(hintActionAt(regions, 10)).toBe("tab");
    expect(hintActionAt(regions, 14)).toBe("tab");
    expect(hintActionAt(regions, 23)).toBe("refresh");
  });

  it("returns null between and outside regions", () => {
    expect(hintActionAt(regions, 15)).toBeNull();
    expect(hintActionAt(regions, 999)).toBeNull();
  });
});

describe("contentColumnFromClick", () => {
  it("subtracts both the widget's left edge and its border inset", () => {
    // A line-bordered widget (ileft 1) starting at absolute column 0: its
    // content column 0 renders at absolute column 1, so an absolute click at
    // column 2 lands on content column 1.
    expect(contentColumnFromClick(2, 0, 1)).toBe(1);
  });

  it("passes through unchanged for a borderless widget (ileft 0)", () => {
    expect(contentColumnFromClick(5, 0, 0)).toBe(5);
  });

  it("also subtracts a non-zero aleft alongside the border inset", () => {
    expect(contentColumnFromClick(13, 10, 1)).toBe(2);
  });
});

describe("rowClickOutcome", () => {
  it("selects when clicking a row that is not selected", () => {
    expect(rowClickOutcome(3, 0)).toBe("select");
  });
  it("drills when clicking the already-selected row", () => {
    expect(rowClickOutcome(3, 3)).toBe("drill");
  });
});

describe("isPointInBounds", () => {
  const bounds = { x: 10, y: 5, width: 20, height: 8 };

  it("is true for a point in the middle of the bounds", () => {
    expect(isPointInBounds(15, 8, bounds)).toBe(true);
  });

  it("is true on the top-left edge (inclusive)", () => {
    expect(isPointInBounds(10, 5, bounds)).toBe(true);
  });

  it("is false on the bottom-right edge (exclusive)", () => {
    expect(isPointInBounds(30, 13, bounds)).toBe(false);
  });

  it("is false to the left, above, right, and below the bounds", () => {
    expect(isPointInBounds(9, 8, bounds)).toBe(false);
    expect(isPointInBounds(15, 4, bounds)).toBe(false);
    expect(isPointInBounds(30, 8, bounds)).toBe(false);
    expect(isPointInBounds(15, 13, bounds)).toBe(false);
  });
});

describe("parseMouseFlag", () => {
  it("defaults to mouse on", () => {
    expect(parseMouseFlag(["node", "claudetui"])).toBe(true);
  });
  it("disables with --no-mouse anywhere in argv", () => {
    expect(parseMouseFlag(["node", "claudetui", "--no-mouse"])).toBe(false);
  });
});

// --- Handler-level tests for setupMouse and setupStatusBarMouse -----------
//
// These use EventEmitter fakes standing in for blessed widgets: setupMouse
// and setupStatusBarMouse only call `.on(...)` plus a handful of members on
// their arguments, so no real blessed screen is needed.

/** Fake for a blessed list widget backing a table panel's rows. */
class FakeRows extends EventEmitter {
  atop = 3;
  childBase = 0;
  selected = 0;
  select = vi.fn((i: number) => {
    this.selected = i;
  });
}

/** Fake for a scrollable log-style panel (non-table). */
class FakeLog extends EventEmitter {
  scroll = vi.fn();
}

/**
 * Builds a 5-panel array matching TABLE_PANEL_INDICES = {0, 3, 4}: indices
 * 0, 3, 4 are table panels (wrapping a FakeRows), indices 1, 2 are log
 * panels (FakeLog is itself the click/wheel target). Fields are named
 * rather than indexed so callers get typed, non-optional access.
 */
function makePanels(): {
  panels: blessed.Widgets.BlessedElement[];
  row0: FakeRows;
  row3: FakeRows;
  row4: FakeRows;
  log1: FakeLog;
  log2: FakeLog;
} {
  const row0 = new FakeRows();
  const row3 = new FakeRows();
  const row4 = new FakeRows();
  const log1 = new FakeLog();
  const log2 = new FakeLog();
  const raw = [{ rows: row0 }, log1, log2, { rows: row3 }, { rows: row4 }];
  return {
    panels: raw as unknown as blessed.Widgets.BlessedElement[],
    row0,
    row3,
    row4,
    log1,
    log2,
  };
}

function makeController(): FocusController & {
  focusPanel: ReturnType<typeof vi.fn>;
  getFocusIndex: ReturnType<typeof vi.fn>;
} {
  return {
    focusPanel: vi.fn(),
    getFocusIndex: vi.fn(() => 0),
  };
}

function makeScreen(): blessed.Widgets.Screen & { render: ReturnType<typeof vi.fn> } {
  return { render: vi.fn() } as unknown as blessed.Widgets.Screen & {
    render: ReturnType<typeof vi.fn>;
  };
}

describe("setupMouse", () => {
  it("clicking a log panel focuses it and does not drill in", () => {
    const { panels, log1 } = makePanels();
    const controller = makeController();
    const onDrillIn = vi.fn();
    const isOverlayOpen = vi.fn(() => false);
    const screen = makeScreen();
    setupMouse(screen, panels, controller, { onDrillIn, isOverlayOpen });

    log1.emit("click", { x: 2, y: 5 });

    expect(controller.focusPanel).toHaveBeenCalledWith(1);
    expect(onDrillIn).not.toHaveBeenCalled();
  });

  it("clicking an unselected table row focuses, selects, and renders", () => {
    const { panels, row0 } = makePanels();
    const controller = makeController();
    const onDrillIn = vi.fn();
    const isOverlayOpen = vi.fn(() => false);
    const screen = makeScreen();
    setupMouse(screen, panels, controller, { onDrillIn, isOverlayOpen });

    // Table panel 0: atop 5, scrolled down 2 rows (childBase). Click at
    // absolute y=8 -> visible row 3 -> data row 3 + childBase 2 = 5.
    row0.atop = 5;
    row0.childBase = 2;
    row0.selected = 0;
    row0.emit("click", { x: 3, y: 8 });

    expect(controller.focusPanel).toHaveBeenCalledWith(0);
    expect(row0.select).toHaveBeenCalledWith(5);
    expect(screen.render).toHaveBeenCalled();
    expect(onDrillIn).not.toHaveBeenCalled();
  });

  it("clicking the already-selected row drills in instead of selecting", () => {
    const { panels, row0 } = makePanels();
    const controller = makeController();
    const onDrillIn = vi.fn();
    const isOverlayOpen = vi.fn(() => false);
    const screen = makeScreen();
    setupMouse(screen, panels, controller, { onDrillIn, isOverlayOpen });

    row0.atop = 3;
    row0.childBase = 0;
    row0.selected = 2;
    // visible row = 5 - 3 = 2, + childBase 0 = 2 === selected -> drill.
    row0.emit("click", { x: 1, y: 5 });

    expect(controller.focusPanel).toHaveBeenCalledWith(0);
    expect(onDrillIn).toHaveBeenCalledWith(0);
    expect(row0.select).not.toHaveBeenCalled();
  });

  it("clicking above the rows' top focuses but neither selects nor drills", () => {
    const { panels, row0 } = makePanels();
    const controller = makeController();
    const onDrillIn = vi.fn();
    const isOverlayOpen = vi.fn(() => false);
    const screen = makeScreen();
    setupMouse(screen, panels, controller, { onDrillIn, isOverlayOpen });

    row0.atop = 5;
    row0.emit("click", { x: 1, y: 2 }); // y < atop

    expect(controller.focusPanel).toHaveBeenCalledWith(0);
    expect(row0.select).not.toHaveBeenCalled();
    expect(onDrillIn).not.toHaveBeenCalled();
    expect(screen.render).not.toHaveBeenCalled();
  });

  it("does nothing on click, wheelup, or wheeldown while an overlay is open", () => {
    const { panels, row0, log1 } = makePanels();
    const controller = makeController();
    const onDrillIn = vi.fn();
    const isOverlayOpen = vi.fn(() => true);
    const screen = makeScreen();
    setupMouse(screen, panels, controller, { onDrillIn, isOverlayOpen });

    row0.emit("click", { x: 1, y: 5 });
    row0.emit("wheelup");
    row0.emit("wheeldown");
    log1.emit("click", { x: 1, y: 5 });
    log1.emit("wheelup");
    log1.emit("wheeldown");

    expect(controller.focusPanel).not.toHaveBeenCalled();
    expect(row0.select).not.toHaveBeenCalled();
    expect(log1.scroll).not.toHaveBeenCalled();
    expect(screen.render).not.toHaveBeenCalled();
    expect(onDrillIn).not.toHaveBeenCalled();
  });

  it("wheelup clamps table selection at 0 and moves selection up otherwise", () => {
    const { panels, row0, row3 } = makePanels();
    const controller = makeController();
    const onDrillIn = vi.fn();
    const isOverlayOpen = vi.fn(() => false);
    const screen = makeScreen();
    setupMouse(screen, panels, controller, { onDrillIn, isOverlayOpen });

    row0.selected = 0;
    row0.emit("wheelup");
    expect(row0.select).toHaveBeenCalledWith(0);
    expect(screen.render).toHaveBeenCalledTimes(1);

    row3.selected = 2;
    row3.emit("wheelup");
    expect(row3.select).toHaveBeenCalledWith(1);
    expect(screen.render).toHaveBeenCalledTimes(2);
  });

  it("wheeldown moves table selection down by one and renders", () => {
    const { panels, row4 } = makePanels();
    const controller = makeController();
    const onDrillIn = vi.fn();
    const isOverlayOpen = vi.fn(() => false);
    const screen = makeScreen();
    setupMouse(screen, panels, controller, { onDrillIn, isOverlayOpen });

    row4.selected = 2;
    row4.emit("wheeldown");

    expect(row4.select).toHaveBeenCalledWith(3);
    expect(screen.render).toHaveBeenCalledTimes(1);
  });

  it("wheelup / wheeldown on a log panel scroll it and render", () => {
    const { panels, log1, log2 } = makePanels();
    const controller = makeController();
    const onDrillIn = vi.fn();
    const isOverlayOpen = vi.fn(() => false);
    const screen = makeScreen();
    setupMouse(screen, panels, controller, { onDrillIn, isOverlayOpen });

    log1.emit("wheelup");
    expect(log1.scroll).toHaveBeenCalledWith(-1);
    expect(screen.render).toHaveBeenCalledTimes(1);

    log2.emit("wheeldown");
    expect(log2.scroll).toHaveBeenCalledWith(1);
    expect(screen.render).toHaveBeenCalledTimes(2);
  });
});

/** Fake for the blessed status-bar widget: a bordered element with click. */
class FakeStatusBar extends EventEmitter {
  aleft = 0;
  ileft = 1; // line border
}

const STATUS_TEXT =
  " model fable-5  │  2 alive  │  1.2M tok  │  $3.21  │  up 1h  │  [Tab] [1-7] [r] [?] [q]";

function makeStatusBarHarness(aleft = 0) {
  const statusBar = new FakeStatusBar();
  statusBar.aleft = aleft;
  const controller = makeController();
  const actions = {
    refresh: vi.fn(),
    help: vi.fn(),
    quit: vi.fn(),
  };
  const isOverlayOpen = vi.fn(() => false);
  setupStatusBarMouse(
    statusBar as unknown as blessed.Widgets.BlessedElement & {
      aleft: number;
      ileft: number;
    },
    controller,
    () => STATUS_TEXT,
    actions,
    isOverlayOpen
  );
  const regions = hintRegions(STATUS_TEXT);
  const xFor = (col: number) => col + statusBar.aleft + statusBar.ileft;
  return { statusBar, controller, actions, isOverlayOpen, regions, xFor };
}

describe("setupStatusBarMouse", () => {
  it("clicking [Tab] advances focus from the controller's current index", () => {
    const { statusBar, controller, xFor, regions } = makeStatusBarHarness();
    controller.getFocusIndex.mockReturnValue(2);
    const region = regions.find((r) => r.action === "tab")!;

    statusBar.emit("click", { x: xFor(region.start) });

    expect(controller.focusPanel).toHaveBeenCalledWith(3);
  });

  it("clicking [r] triggers refresh only", () => {
    const { statusBar, actions, xFor, regions } = makeStatusBarHarness();
    const region = regions.find((r) => r.action === "refresh")!;

    statusBar.emit("click", { x: xFor(region.start) });

    expect(actions.refresh).toHaveBeenCalledTimes(1);
    expect(actions.help).not.toHaveBeenCalled();
    expect(actions.quit).not.toHaveBeenCalled();
  });

  it("clicking [?] triggers help only", () => {
    const { statusBar, actions, xFor, regions } = makeStatusBarHarness();
    const region = regions.find((r) => r.action === "help")!;

    statusBar.emit("click", { x: xFor(region.start) });

    expect(actions.help).toHaveBeenCalledTimes(1);
    expect(actions.refresh).not.toHaveBeenCalled();
    expect(actions.quit).not.toHaveBeenCalled();
  });

  it("clicking [q] triggers quit only", () => {
    const { statusBar, actions, xFor, regions } = makeStatusBarHarness();
    const region = regions.find((r) => r.action === "quit")!;

    statusBar.emit("click", { x: xFor(region.start) });

    expect(actions.quit).toHaveBeenCalledTimes(1);
    expect(actions.refresh).not.toHaveBeenCalled();
    expect(actions.help).not.toHaveBeenCalled();
  });

  it("dispatches on the token's last character but not the column after it", () => {
    const { statusBar, actions, xFor, regions } = makeStatusBarHarness();
    const region = regions.find((r) => r.action === "quit")!;

    statusBar.emit("click", { x: xFor(region.end) });
    expect(actions.quit).toHaveBeenCalledTimes(1);

    actions.quit.mockClear();
    statusBar.emit("click", { x: xFor(region.end + 1) });
    expect(actions.quit).not.toHaveBeenCalled();
  });

  it("dispatches nothing for [1-7], a separator, or the border column", () => {
    const { statusBar, actions, controller, xFor } = makeStatusBarHarness();

    const oneToSevenStart = STATUS_TEXT.indexOf("[1-7]");
    statusBar.emit("click", { x: xFor(oneToSevenStart + 1) }); // inside "1-7"

    const sepColumn = STATUS_TEXT.indexOf("│");
    statusBar.emit("click", { x: xFor(sepColumn) });

    statusBar.emit("click", { x: 0 }); // border column, left of content

    expect(controller.focusPanel).not.toHaveBeenCalled();
    expect(actions.refresh).not.toHaveBeenCalled();
    expect(actions.help).not.toHaveBeenCalled();
    expect(actions.quit).not.toHaveBeenCalled();
  });

  it("dispatches nothing while an overlay is open, even on a hint token", () => {
    const { statusBar, actions, isOverlayOpen, xFor, regions } =
      makeStatusBarHarness();
    isOverlayOpen.mockReturnValue(true);
    const region = regions.find((r) => r.action === "quit")!;

    statusBar.emit("click", { x: xFor(region.start) });

    expect(actions.quit).not.toHaveBeenCalled();
  });

  it("applies a non-zero aleft when hit-testing the same content column", () => {
    const { statusBar, actions, xFor, regions } = makeStatusBarHarness(4);
    const region = regions.find((r) => r.action === "refresh")!;

    statusBar.emit("click", { x: xFor(region.start) });

    expect(actions.refresh).toHaveBeenCalledTimes(1);
  });
});
