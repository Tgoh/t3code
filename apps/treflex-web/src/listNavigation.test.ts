import { describe, expect, it } from "vite-plus/test";

import { arrowStep, stepHighlight } from "./listNavigation";

describe("list navigation", () => {
  it("steps on up and down, and on left and right only in a horizontal list", () => {
    expect(arrowStep("ArrowDown")).toBe(1);
    expect(arrowStep("ArrowUp")).toBe(-1);
    expect(arrowStep("ArrowRight")).toBeNull();
    expect(arrowStep("ArrowRight", true)).toBe(1);
    expect(arrowStep("ArrowLeft", true)).toBe(-1);
    expect(arrowStep("Enter", true)).toBeNull();
  });

  it("starts at an end when nothing is highlighted", () => {
    expect(stepHighlight(null, 3, 1)).toBe(0);
    expect(stepHighlight(null, 3, -1)).toBe(2);
    expect(stepHighlight(-1, 3, -1)).toBe(2);
  });

  it("wraps at both ends", () => {
    expect(stepHighlight(2, 3, 1)).toBe(0);
    expect(stepHighlight(0, 3, -1)).toBe(2);
    expect(stepHighlight(1, 3, 1)).toBe(2);
  });

  it("has nowhere to go in an empty list", () => {
    expect(stepHighlight(null, 0, 1)).toBeNull();
    expect(stepHighlight(4, 0, -1)).toBeNull();
  });
});
