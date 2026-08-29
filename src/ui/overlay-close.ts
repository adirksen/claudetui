/**
 * Tracks the close function of the currently-open help overlay.
 *
 * Identity matters here: blessed's screen key dispatcher snapshots the
 * focused element before running screen-level handlers, then re-emits the
 * keypress on that stale reference afterward. So pressing "?" while help is
 * open replaces box A with box B — and then still fires box A's own key
 * handler once. releaseOverlayCloser's identity check makes that stale
 * invocation inert instead of letting A's closure tear down B's state.
 */

import { isPointInBounds, type Bounds } from "./mouse.js";

let activeCloser: (() => void) | null = null;

/** Make `close` the active overlay's closer, replacing any previous one. */
export function registerOverlayCloser(close: () => void): void {
  activeCloser = close;
}

/** Close the active overlay, if any. Safe to call when none is open. */
export function closeActiveOverlay(): void {
  activeCloser?.();
}

/**
 * Claim the right to tear down. Returns true (and clears the registration)
 * only when `close` is still the active closer — a closer from a superseded
 * overlay gets false and must do nothing.
 */
export function releaseOverlayCloser(close: () => void): boolean {
  if (activeCloser !== close) return false;
  activeCloser = null;
  return true;
}

/** Test helper — restore the no-overlay state. */
export function resetOverlayCloser(): void {
  activeCloser = null;
}

export interface MouseEventData {
  x: number;
  y: number;
  action?: string;
}

/** Minimal slice of blessed.Widgets.Screen needed here. */
export interface MouseEventSource {
  on(event: "mouse", listener: (data: MouseEventData) => void): unknown;
  removeListener(event: "mouse", listener: (data: MouseEventData) => void): unknown;
}

/**
 * Close an overlay when the pointer is released outside `getBounds()`.
 * Returns a detach function.
 *
 * Filters on "mouseup", not "mousedown". blessed's Screen.prototype
 * ._listenMouse (node_modules/blessed/lib/widgets/screen.js) dispatches
 * per-element handlers before screen-level ones: on mousedown it just
 * records the topmost clickable element under the pointer as
 * `self.mouseDown`; on mouseup it emits 'click' on that element *and then*
 * emits the raw action, and only after that per-element dispatch does it
 * run `self.emit('mouse', data)`. Filtering here on "mousedown" would let
 * our screen-level listener close the overlay before the underlying
 * element's own 'click' handler runs — with the overlay already reporting
 * closed, that handler's guard (e.g. `isOverlayOpen()`) sees false and the
 * click goes through to whatever was underneath the overlay. Filtering on
 * "mouseup" instead means the underlying element's 'click' fires first,
 * while the overlay is still open and its guard still suppresses the
 * click; only afterward does this listener close the overlay.
 *
 * `getBounds` is a function (not a value) because blessed only computes
 * `atop`/`aleft` after render.
 */
export function attachClickOutsideClose(
  screen: MouseEventSource,
  getBounds: () => Bounds,
  close: () => void
): () => void {
  const onMouse = (data: MouseEventData) => {
    if (data.action !== "mouseup") return;
    if (!isPointInBounds(data.x, data.y, getBounds())) close();
  };
  screen.on("mouse", onMouse);
  return () => screen.removeListener("mouse", onMouse);
}
