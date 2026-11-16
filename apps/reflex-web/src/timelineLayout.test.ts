import { describe, expect, it } from "vite-plus/test";

import type { IWireTurnItem } from "./Infrastructure/wire";
import { THREAD_ID } from "./testing/threadFixture";
import {
  entryFacts,
  type ILatestRun,
  type ILayoutRow,
  layoutResponse,
  segmentResponses,
} from "./timelineLayout";

const at = (second: number) => `2026-06-20T00:00:${String(second).padStart(2, "0")}.000Z`;

function item(
  type: IWireTurnItem["type"],
  id: string,
  second: number,
  fields: Record<string, unknown> = {},
): IWireTurnItem {
  return {
    id,
    threadId: THREAD_ID,
    runId: "run-1",
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: second,
    status: "completed",
    title: null,
    startedAt: at(second),
    completedAt: at(second),
    updatedAt: at(second),
    type,
    ...fields,
  } as unknown as IWireTurnItem;
}

const user = (id: string, second: number, fields: Record<string, unknown> = {}) =>
  item("user_message", id, second, {
    runId: null,
    messageId: id,
    text: "Do it",
    inputIntent: "new_turn",
    ...fields,
  });
const reply = (id: string, second: number, fields: Record<string, unknown> = {}) =>
  item("assistant_message", id, second, {
    messageId: id,
    text: "Done",
    streaming: false,
    ...fields,
  });
const command = (id: string, second: number, fields: Record<string, unknown> = {}) =>
  item("command_execution", id, second, { input: "git status", exitCode: 0, ...fields });
const thought = (id: string, second: number, text = "Looking") =>
  item("reasoning", id, second, { text });
const checkpoint = (id: string, second: number) =>
  item("checkpoint", id, second, {
    checkpointId: `cp-${id}`,
    files: [{ path: "a.ts", additions: 1, deletions: 0 }],
  });

const settled: ILatestRun = {
  Id: "run-1",
  Status: "completed",
  StartedAt: at(0),
  CompletedAt: at(15),
};
const running: ILatestRun = { Id: "run-1", Status: "running", StartedAt: at(0), CompletedAt: null };

function layout(
  items: IWireTurnItem[],
  options: {
    run?: ILatestRun | null;
    working?: boolean;
    expanded?: string[];
    latest?: boolean;
  } = {},
): ILayoutRow[] {
  return layoutResponse({
    Entries: items.flatMap((held) => entryFacts(held) ?? []),
    Latest: options.latest ?? true,
    LatestRun: options.run === undefined ? settled : options.run,
    Working: options.working ?? false,
    PendingApproval: false,
    Expanded: (key) => options.expanded?.includes(key) === true,
  });
}

const shape = (rows: ILayoutRow[]) =>
  rows.map((row) => {
    switch (row.Kind) {
      case "item":
        return row.Meta ? `${row.Id} +meta` : row.Id;
      case "single":
        return `single ${row.Id}`;
      case "group":
        return `group ${row.Ids.join(",")}`;
      case "fold":
        return `fold ${row.Label}`;
      case "live":
        return `live ${row.Id} of ${row.Ids.join(",")}${row.Active ? "" : " settled"}`;
      case "meta":
        return `meta ${row.Id}`;
      default:
        return row.Kind;
    }
  });

describe("the timeline's turn folds", () => {
  const turn = [
    user("u", 0),
    thought("t", 1),
    command("c1", 2),
    command("c2", 3),
    reply("a1", 4),
    command("c3", 5),
    reply("a2", 6),
    checkpoint("cp", 7),
  ];

  it("folds a settled turn's work under one row, keeping the answer and its changed files", () => {
    expect(shape(layout(turn))).toEqual(["u", "fold Worked for 15s", "a2", "cp", "meta a2"]);
  });

  it("leaves out workspace preparation, so a reply after only that gets no fold", () => {
    const preparation = command("prep", 1, { input: "Preparing workspace" });
    expect(shape(layout([user("u", 0), preparation, reply("a", 9)]))).toEqual(["u", "a +meta"]);
    const deferred = {
      ...preparation,
      deferredWork: { cursor: "c", itemCount: 1, lastOrdinal: 1 },
    };
    expect(shape(layout([user("u", 0), deferred as IWireTurnItem, reply("a", 9)]))).toEqual([
      "u",
      "fold Worked for 15s",
      "a +meta",
    ]);
  });

  it("times a turn that isn't the latest run from its rows", () => {
    expect(shape(layout(turn, { run: null }))[1]).toBe("fold Worked for 6s");
  });

  it("opens into work groups, a lone tool as its own row, and moves the reply's actions below its work", () => {
    expect(shape(layout(turn, { expanded: ["fold:run-1"] }))).toEqual([
      "u",
      "fold Worked for 15s",
      "group t,c1,c2",
      "a1",
      "single c3",
      "a2",
      "cp",
      "meta a2",
    ]);
  });

  it("leaves a failed run, an interrupted one and a streaming one unfolded", () => {
    const failed = [
      ...turn.slice(0, 4),
      item("error", "e", 4, {
        status: "failed",
        failure: { class: "provider", message: "Boom" },
      }),
    ];
    expect(shape(layout(failed, { run: { ...settled, Status: "failed" } }))).toEqual([
      "u",
      "t",
      "c1",
      "c2",
      "e",
    ]);
    const stopped = [
      ...turn.slice(0, 3),
      item("run_interrupt_result", "i", 3, { message: "Stopped" }),
    ];
    expect(shape(layout(stopped))).toEqual(["u", "group t,c1", "i"]);
    const streaming = [...turn.slice(0, 3), reply("a", 3, { streaming: true })];
    expect(shape(layout(streaming))).toEqual(["u", "group t,c1", "a +meta"]);
  });

  it("says when the user stopped the latest run", () => {
    const rows = layout(turn.slice(0, 5), { run: { ...settled, Status: "interrupted" } });
    expect(shape(rows)[1]).toBe("fold You stopped after 15s");
  });

  it("folds the work after a steer under its own row", () => {
    const steered = [
      user("u", 0),
      command("c1", 1),
      user("s", 2, { runId: "run-1", inputIntent: "steer" }),
      command("c2", 3),
      reply("a", 9),
    ];
    expect(shape(layout(steered, { run: null }))).toEqual([
      "u",
      "fold Worked for 9s",
      "s",
      "fold Continued for 7s",
      "a +meta",
    ]);
  });
});

describe("a running turn", () => {
  it("shows how long it has worked, and its trailing tools as one live row", () => {
    const rows = layout(
      [
        user("u", 0),
        command("c1", 1),
        command("c2", 2, { status: "running", exitCode: undefined }),
      ],
      { run: running, working: true },
    );
    expect(shape(rows)).toEqual(["u", "working", "live c2 of c1,c2"]);
  });

  it("thinks once no tool is running and keeps finished tools in the live row", () => {
    expect(shape(layout([user("u", 0)], { run: running, working: true }))).toEqual([
      "u",
      "working",
      "thinking",
    ]);
    const rows = layout([user("u", 0), reply("a", 1), command("c1", 2)], {
      run: running,
      working: true,
    });
    expect(shape(rows)).toEqual(["u", "working", "a", "live c1 of c1"]);
  });

  it("gives a reply no actions until its run settles", () => {
    const rows = layout([user("u", 0), command("c1", 1), reply("a", 2)], {
      run: running,
      working: true,
    });
    expect(shape(rows)).toEqual(["u", "working", "single c1", "a", "thinking"]);
  });

  it("ends a reasoning row that something followed", () => {
    const rows = layout(
      [
        user("u", 0),
        item("reasoning", "t", 1, { text: "Hmm", status: "running" }),
        command("c1", 2, { status: "running", exitCode: undefined }),
      ],
      { run: running, working: true },
    );
    expect(shape(rows)).toEqual(["u", "working", "live c1 of t,c1"]);
  });
});

describe("responses", () => {
  const starts = (id: string) => id.startsWith("u");

  it("splits rows at each prompt", () => {
    const split = segmentResponses(undefined, ["x", "u1", "a", "u2", "b"], starts);
    expect(split.Starts).toEqual(["x", "u1", "u2"]);
    expect(split.Segments).toEqual({ x: ["x"], u1: ["u1", "a"], u2: ["u2", "b"] });
  });

  it("keeps earlier responses' arrays when rows only grow, so only the last is laid out again", () => {
    const first = segmentResponses(undefined, ["u1", "a", "u2", "b"], starts);
    const grown = segmentResponses(first, ["u1", "a", "u2", "b", "c", "u3"], starts);
    expect(grown.Segments.u1).toBe(first.Segments.u1);
    expect(grown.Segments.u2).toEqual(["u2", "b", "c"]);
    expect(grown.Starts).toEqual(["u1", "u2", "u3"]);
    const changed = segmentResponses(grown, ["u0", "u1", "a", "u2", "b", "c", "u3"], starts);
    expect(changed.Starts).toEqual(["u0", "u1", "u2", "u3"]);
  });
});
