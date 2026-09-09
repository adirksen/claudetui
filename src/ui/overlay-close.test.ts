import { describe, it, expect, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import {
  registerOverlayCloser,
  closeActiveOverlay,
  releaseOverlayCloser,
  resetOverlayCloser,
  attachClickOutsideClose,
  type MouseEventSource,
} from "./overlay-close.js";

beforeEach(resetOverlayCloser);

describe("overlay close registry", () => {
  it("closes the registered overlay via closeActiveOverlay", () => {
    const events: string[] = [];
    const closerA = (): void => {
      if (!releaseOverlayCloser(closerA)) return;
      events.push("A closed");
    };
    registerOverlayCloser(closerA);

    closeActiveOverlay();

    expect(events).toEqual(["A closed"]);
  });

  it("is a no-op when nothing is registered", () => {
    expect(() => closeActiveOverlay()).not.toThrow();
  });

  it("release returns true exactly once for the active closer", () => {
    const closer = (): void => undefined;
    registerOverlayCloser(closer);
    expect(releaseOverlayCloser(closer)).toBe(true);
    expect(releaseOverlayCloser(closer)).toBe(false);
  });

  it("a superseded closer cannot tear down its successor's registration", () => {
    // Reproduces the blessed stale-focus re-emit: a screen-level "?" handler
    // replaces overlay A with overlay B, then blessed still fires A's own
    // key handler once more. That stale invocation must be inert.
    const events: string[] = [];
    const closerA = (): void => {
      if (!releaseOverlayCloser(closerA)) return;
      events.push("A closed");
    };
    const closerB = (): void => {
      if (!releaseOverlayCloser(closerB)) return;
      events.push("B closed");
    };

    registerOverlayCloser(closerA);
    closeActiveOverlay(); // showHelp's open-time close of the old box
    registerOverlayCloser(closerB); // the new box is now active

    closerA(); // stale re-emit from blessed's snapshotted focus — must no-op

    expect(events).toEqual(["A closed"]);

    closeActiveOverlay(); // B must still be reachable and closable
    expect(events).toEqual(["A closed", "B closed"]);
  });
});

describe("attachClickOutsideClose", () => {
  const bounds = { x: 10, y: 5, width: 20, height: 10 };

  function makeFixture() {
    const screen = new EventEmitter() as unknown as MouseEventSource & EventEmitter;
    // Stands in for a dashboard element underneath the overlay (e.g. the
    // status bar's [q] button). Mirrors the app's real gating: a click
    // handler only acts when no overlay is open.
    const underlying = new EventEmitter();
    const activated: string[] = [];
    let overlayOpen = true;

    underlying.on("click", () => {
      if (!overlayOpen) activated.push("click");
    });

    let closed = 0;
    const close = () => {
      overlayOpen = false;
      closed++;
    };

    /**
     * Replays blessed's per-report dispatch order for one full click at
     * (x, y): Screen.prototype._listenMouse (node_modules/blessed/lib/
     * widgets/screen.js) first dispatches to the topmost clickable element
     * under the pointer — mousedown records it as self.mouseDown, mouseup
     * emits 'click' on it and then the raw 'mouseup' — and only after that
     * per-element dispatch does it emit the screen-level "mouse" event.
     */
    function press(x: number, y: number): void {
      const down = { x, y, action: "mousedown" };
      const up = { x, y, action: "mouseup" };
      underlying.emit("mousedown", down);
      screen.emit("mouse", down);
      underlying.emit("click", up);
      screen.emit("mouse", up);
    }

    return { screen, activated, close, press, getClosed: () => closed };
  }

  it("a click outside closes the overlay without activating the element underneath", () => {
    const { screen, activated, close, press, getClosed } = makeFixture();
    attachClickOutsideClose(screen, () => bounds, close);

    press(2, 2); // outside bounds

    expect(getClosed()).toBe(1);
    expect(activated).toEqual([]);
  });

  it("a click inside the overlay does not close it", () => {
    const { screen, close, press, getClosed } = makeFixture();
    attachClickOutsideClose(screen, () => bounds, close);

    press(15, 8); // inside bounds

    expect(getClosed()).toBe(0);
  });

  it("mousemove outside does not close it", () => {
    const { screen, close, getClosed } = makeFixture();
    attachClickOutsideClose(screen, () => bounds, close);

    screen.emit("mouse", { x: 2, y: 2, action: "mousemove" });

    expect(getClosed()).toBe(0);
  });

  it("detach stops listening", () => {
    const { screen, close, press, getClosed } = makeFixture();
    const detach = attachClickOutsideClose(screen, () => bounds, close);

    detach();
    press(2, 2);

    expect(getClosed()).toBe(0);
  });
});
