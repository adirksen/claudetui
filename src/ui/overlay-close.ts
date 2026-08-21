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
