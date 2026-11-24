import { describe, expect, it } from "vite-plus/test";

import {
  CHUNK_ROWS,
  firstAfterChange,
  followAfterScroll,
  grow,
  INITIAL_ROWS,
  initialFirst,
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
  it("sticks near the end, including an overscroll past it", () => {
    expect(followAfterScroll(500, 20)).toBe("stick");
    expect(followAfterScroll(500, -30)).toBe("stick");
  });

  it("detaches on a move away from the end and keeps on a move towards it", () => {
    expect(followAfterScroll(20, 100)).toBe("detach");
    expect(followAfterScroll(500, 600)).toBe("detach");
    expect(followAfterScroll(600, 500)).toBe("keep");
    expect(followAfterScroll(600, 600)).toBe("keep");
  });
});
