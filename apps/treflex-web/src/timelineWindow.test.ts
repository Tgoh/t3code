import { describe, expect, it } from "vite-plus/test";

import {
  CHUNK_ROWS,
  firstAfterChange,
  followAfterScroll,
  grow,
  INITIAL_ROWS,
  initialFirst,
  keepsWindow,
  trimToTail,
} from "./timelineWindow";

const ids = (from: number, to: number) =>
  Array.from({ length: to - from }, (_, index) => `r${from + index}`);

describe("the timeline window", () => {
  it("opens on the tail", () => {
    expect(initialFirst(10)).toBe(0);
    expect(initialFirst(500)).toBe(500 - INITIAL_ROWS);
  });

  it("opens on the tail when the first rows arrive", () => {
    expect(firstAfterChange([], ids(0, 500), 0)).toBe(500 - INITIAL_ROWS);
  });

  it("opens far enough up to hold a saved anchor, or on the tail when the anchor isn't loaded", () => {
    expect(firstAfterChange([], ids(0, 500), 0, "r100")).toBe(100);
    expect(firstAfterChange([], ids(0, 500), 0, "r480")).toBe(500 - INITIAL_ROWS);
    expect(firstAfterChange([], ids(0, 500), 0, "gone")).toBe(500 - INITIAL_ROWS);
  });

  it("keeps its top row through appends, inserts and removals", () => {
    const before = ids(0, 100);
    expect(firstAfterChange(before, ids(0, 101), 40)).toBe(40);
    expect(firstAfterChange(before, ["new", ...before], 40)).toBe(41);
    expect(
      firstAfterChange(
        before,
        before.filter((id) => id !== "r3"),
        40,
      ),
    ).toBe(39);
  });

  it("keeps its index when its top row is gone", () => {
    const before = ids(0, 100);
    expect(
      firstAfterChange(
        before,
        before.filter((id) => id !== "r40"),
        40,
      ),
    ).toBe(40);
    expect(firstAfterChange(before, ids(0, 10), 40)).toBe(9);
    expect(firstAfterChange(before, [], 40)).toBe(0);
  });

  it("stays at the top when a history page lands above it", () => {
    expect(firstAfterChange(ids(50, 100), ids(0, 100), 0)).toBe(0);
  });

  it("tells a plain append below the window from a change within it", () => {
    const before = ids(0, 100);
    expect(keepsWindow(before, 40, ids(0, 102), 40)).toBe(true);
    expect(keepsWindow(before, 40, ["new", ...before], 41)).toBe(true);
    expect(keepsWindow(before, 40, ["new", ...before], 40)).toBe(false);
    expect(keepsWindow(before, 40, before.toSpliced(70, 0, "new"), 40)).toBe(false);
    expect(keepsWindow(before, 40, before.toSpliced(70, 1), 40)).toBe(false);
  });

  it("grows a chunk at a time down to the top", () => {
    expect(grow(100)).toBe(100 - CHUNK_ROWS);
    expect(grow(10)).toBe(0);
  });

  it("trims back to its floor only once it is a chunk past it", () => {
    expect(trimToTail(200, 200 - INITIAL_ROWS - CHUNK_ROWS, INITIAL_ROWS)).toBe(
      200 - INITIAL_ROWS - CHUNK_ROWS,
    );
    expect(trimToTail(200, 0, INITIAL_ROWS)).toBe(200 - INITIAL_ROWS);
    expect(trimToTail(200, 0, 120)).toBe(80);
    expect(trimToTail(50, 0, INITIAL_ROWS)).toBe(0);
  });
});

describe("following the end", () => {
  const at = (Top: number, Height = 2_000, ClientHeight = 500) => ({ Top, Height, ClientHeight });

  it("sticks near the end and detaches on a move up with no size change", () => {
    expect(followAfterScroll(at(1_000), at(1_480), false)).toBe("stick");
    expect(followAfterScroll(at(1_000), at(900), false)).toBe("detach");
    expect(followAfterScroll(at(900), at(1_000), false)).toBe("keep");
  });

  it("keeps following when a shrink lowers scrollTop, unless the user is scrolling", () => {
    const clamped = at(1_200, 1_900, 500);
    expect(followAfterScroll(at(1_500, 2_000, 400), clamped, false)).toBe("keep");
    expect(followAfterScroll(at(1_500, 2_000, 400), clamped, true)).toBe("detach");
  });
});
