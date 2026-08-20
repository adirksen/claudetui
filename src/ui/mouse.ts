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
