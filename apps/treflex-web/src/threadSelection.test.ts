import { describe, expect, it } from "vite-plus/test";

import {
  EMPTY_SELECTION,
  type IThreadSelection,
  keepSelected,
  rangeSelectTo,
  toggleSelected,
} from "./threadSelection";

const ids = (selection: IThreadSelection) => [...selection.Ids];
const ORDER = ["a", "b", "c", "d", "e"];

describe("selecting several threads", () => {
  it("toggles a thread in and out, anchoring on the one added", () => {
    let held = toggleSelected(EMPTY_SELECTION, "b");
    held = toggleSelected(held, "d");
    expect(ids(held)).toEqual(["b", "d"]);
    expect(held.Anchor).toBe("d");
    held = toggleSelected(held, "d");
    expect(ids(held)).toEqual(["b"]);
    expect(held.Anchor).toBe("d");
  });

  it("adds the run from the anchor to the target, keeping the anchor", () => {
    let held = toggleSelected(EMPTY_SELECTION, "d");
    held = rangeSelectTo(held, "b", ORDER);
    expect(ids(held).toSorted()).toEqual(["b", "c", "d"]);
    expect(held.Anchor).toBe("d");
    held = rangeSelectTo(held, "e", ORDER);
    expect(ids(held).toSorted()).toEqual(["b", "c", "d", "e"]);
  });

  it("with no anchor, or one no longer shown, adds just the target and anchors there", () => {
    let held = rangeSelectTo(EMPTY_SELECTION, "c", ORDER);
    expect(ids(held)).toEqual(["c"]);
    expect(held.Anchor).toBe("c");
    held = rangeSelectTo({ Ids: new Set(["gone"]), Anchor: "gone" }, "a", ORDER);
    expect(ids(held).toSorted()).toEqual(["a", "gone"]);
    expect(held.Anchor).toBe("a");
  });

  it("drops threads that left, and the anchor with them", () => {
    const held = keepSelected({ Ids: new Set(["a", "b", "c"]), Anchor: "b" }, (id) => id !== "b");
    expect(ids(held)).toEqual(["a", "c"]);
    expect(held.Anchor).toBeNull();
    expect(keepSelected(held, () => true)).toBe(held);
  });
});
