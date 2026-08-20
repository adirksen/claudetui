import { describe, it, expect } from "vitest";
import { wrapIndex } from "./keybindings.js";

describe("wrapIndex", () => {
  it("passes through in-range indices", () => {
    expect(wrapIndex(3, 7)).toBe(3);
  });
  it("wraps past the end", () => {
    expect(wrapIndex(7, 7)).toBe(0);
  });
  it("wraps negative indices", () => {
    expect(wrapIndex(-1, 7)).toBe(6);
  });
});
