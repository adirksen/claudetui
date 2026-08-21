import { describe, it, expect, beforeEach } from "vitest";
import {
  registerOverlayCloser,
  closeActiveOverlay,
  releaseOverlayCloser,
  resetOverlayCloser,
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
