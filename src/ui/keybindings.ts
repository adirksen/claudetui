import type blessed from "blessed";

type FocusableWidget = blessed.Widgets.BlessedElement & {
  focus: () => void;
};

export interface FocusController {
  focusPanel(index: number): void;
  getFocusIndex(): number;
}

/** Wrap an index into [0, length) with negative-safe modulo. */
export function wrapIndex(index: number, length: number): number {
  return ((index % length) + length) % length;
}

export function setupKeybindings(
  screen: blessed.Widgets.Screen,
  panels: FocusableWidget[],
  callbacks: {
    onRefresh: () => void;
    onDrillIn: (panelIndex: number) => void;
    onDrillOut: () => void;
    onHelp: () => void;
  }
): FocusController {
  let focusIndex = 0;

  function focusPanel(index: number): void {
    focusIndex = wrapIndex(index, panels.length);
    panels[focusIndex]?.focus();
    screen.render();
  }

  // Quit is handled in app.ts (needs to resolve the startApp promise)

  // Tab cycling
  screen.key(["tab"], () => focusPanel(focusIndex + 1));
  screen.key(["S-tab"], () => focusPanel(focusIndex - 1));

  // Number keys to jump to panels
  for (let i = 0; i < panels.length && i < 9; i++) {
    screen.key([String(i + 1)], () => focusPanel(i));
  }

  // Force refresh
  screen.key(["r"], callbacks.onRefresh);

  // Drill-down / back — pass focused panel index so app.ts can route correctly
  screen.key(["enter"], () => callbacks.onDrillIn(focusIndex));
  screen.key(["escape"], callbacks.onDrillOut);

  // Help
  screen.key(["?"], callbacks.onHelp);

  // Focus first panel
  focusPanel(0);

  return { focusPanel, getFocusIndex: () => focusIndex };
}
