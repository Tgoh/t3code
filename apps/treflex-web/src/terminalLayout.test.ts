import { describe, expect, it } from "vite-plus/test";

import {
  activateTerminal,
  EMPTY_TERMINAL_LAYOUT,
  type ITerminalLayout,
  normalizeLayout,
  placeTerminal,
  removeTerminal,
  shownGroup,
} from "./terminalLayout";

const build = (...steps: Array<(layout: ITerminalLayout) => ITerminalLayout>) =>
  steps.reduce((layout, step) => step(layout), EMPTY_TERMINAL_LAYOUT);
const add = (id: string) => (layout: ITerminalLayout) => placeTerminal(layout, id, "new");
const split =
  (id: string, direction: "horizontal" | "vertical" = "horizontal") =>
  (layout: ITerminalLayout) =>
    placeTerminal(layout, id, "split", direction);
const activate = (id: string) => (layout: ITerminalLayout) => activateTerminal(layout, id);
const remove = (id: string) => (layout: ITerminalLayout) => removeTerminal(layout, id);

describe("the terminal layout", () => {
  it("opens a first terminal in a group of its own, even when asked to split", () => {
    expect(build(split("term-1"))).toEqual({
      TerminalIds: ["term-1"],
      Groups: [{ Id: "group-term-1", TerminalIds: ["term-1"], SplitDirection: "horizontal" }],
      ActiveTerminalId: "term-1",
      ActiveGroupId: "group-term-1",
    });
  });

  it("caps splits at four terminals per group", () => {
    const layout = build(
      add("term-1"),
      split("term-2"),
      split("term-3"),
      split("term-4"),
      split("term-5"),
    );
    expect(layout.TerminalIds).toEqual(["term-1", "term-2", "term-3", "term-4"]);
    expect(layout.Groups).toEqual([
      {
        Id: "group-term-1",
        TerminalIds: ["term-1", "term-2", "term-3", "term-4"],
        SplitDirection: "horizontal",
      },
    ]);
    expect(layout.ActiveTerminalId).toBe("term-4");
  });

  it("splits beside the active terminal and takes the split's direction", () => {
    const layout = build(
      add("term-1"),
      split("term-2"),
      activate("term-1"),
      split("term-3", "vertical"),
    );
    expect(layout.Groups).toEqual([
      {
        Id: "group-term-1",
        TerminalIds: ["term-1", "term-3", "term-2"],
        SplitDirection: "vertical",
      },
    ]);
  });

  it("a new terminal is a new tab that becomes the shown group", () => {
    const layout = build(add("term-1"), split("term-2"), add("term-3"));
    expect(layout.Groups.map((group) => group.Id)).toEqual(["group-term-1", "group-term-3"]);
    expect(shownGroup(layout)?.TerminalIds).toEqual(["term-3"]);
    expect(shownGroup(activateTerminal(layout, "term-2"))?.TerminalIds).toEqual([
      "term-1",
      "term-2",
    ]);
  });

  it("closing the last terminal empties the layout", () => {
    expect(build(add("term-1"), remove("term-1"))).toEqual(EMPTY_TERMINAL_LAYOUT);
  });

  it("keeps a valid active terminal after closing an active split terminal", () => {
    const layout = build(add("term-1"), split("term-2"), split("term-3"), remove("term-3"));
    expect(layout.ActiveTerminalId).toBe("term-2");
    expect(layout.Groups).toEqual([
      { Id: "group-term-1", TerminalIds: ["term-1", "term-2"], SplitDirection: "horizontal" },
    ]);
  });

  it.each([
    ["term-3", "term-3", "term-1"],
    ["term-1", "term-1", "term-3"],
    ["term-3", "term-1", "term-3"],
  ])("keeps the split's tab when %s is active and %s closes", (activeId, closedId, nextId) => {
    const layout = build(
      add("term-1"),
      add("term-2"),
      activate("term-1"),
      split("term-3"),
      activate(activeId),
      remove(closedId),
    );
    expect(layout.ActiveTerminalId).toBe(nextId);
    expect(layout.ActiveGroupId).toBe("group-term-1");
  });

  it("repairs a stored layout: unknown ids leave their groups, and loose ids get groups", () => {
    expect(
      normalizeLayout({
        TerminalIds: ["term-1", "term-2", "term-1"],
        Groups: [{ Id: "g", TerminalIds: ["term-1", "gone"], SplitDirection: "vertical" }],
        ActiveTerminalId: "gone",
        ActiveGroupId: "missing",
      }),
    ).toEqual({
      TerminalIds: ["term-1", "term-2"],
      Groups: [
        { Id: "g", TerminalIds: ["term-1"], SplitDirection: "vertical" },
        { Id: "group-term-2", TerminalIds: ["term-2"], SplitDirection: "horizontal" },
      ],
      ActiveTerminalId: "term-1",
      ActiveGroupId: "g",
    });
  });
});
