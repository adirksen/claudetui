import { describe, it, expect } from "vitest";
import {
  rowIndexFromClick,
  hintRegions,
  hintActionAt,
  rowClickOutcome,
  contentColumnFromClick,
  isPointInBounds,
  parseMouseFlag,
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
