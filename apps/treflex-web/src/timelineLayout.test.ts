import { describe, expect, it } from "vite-plus/test";

import type { ToolCallVisibility } from "@t3tools/contracts/settings";

import type { IWireTurnItem } from "./Infrastructure/wire";
import { THREAD_ID } from "./testing/threadFixture";
import {
  entryFacts,
  type IAttempt,
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
  TurnEnded: false,
};
const running: ILatestRun = {
  Id: "run-1",
  Status: "running",
  StartedAt: at(0),
  CompletedAt: null,
  TurnEnded: false,
};

function layout(
  items: IWireTurnItem[],
  options: {
    run?: ILatestRun | null;
    working?: boolean;
    expanded?: string[];
    latest?: boolean;
    visibility?: ToolCallVisibility;
    attempts?: Record<string, IAttempt>;
  } = {},
): ILayoutRow[] {
  return layoutResponse({
    Entries: items.flatMap((held) => entryFacts(held, options.attempts?.[held.id] ?? null) ?? []),
    Latest: options.latest ?? true,
    LatestRun: options.run === undefined ? settled : options.run,
    Working: options.working ?? false,
    Expanded: (key) => options.expanded?.includes(key) === true,
    Visibility: options.visibility ?? "showAll",
  });
}

const shape = (rows: ILayoutRow[]) =>
  rows.map((row) => {
    switch (row.Kind) {
      case "item":
        return `${row.Id}${row.Files === undefined ? "" : ` +files ${row.Files}`}${row.Meta ? " +meta" : ""}`;
      case "single":
        return `single ${row.Id}`;
      case "group":
        return `group ${row.Ids.join(",")}`;
      case "subagents":
        return `subagents ${row.Ids.join(",")}`;
      case "fold":
        return row.Running ? "fold running" : `fold ${row.Label}`;
      case "meta":
        return `meta ${row.Id}`;
      case "attempt":
        return row.Expanded ? "attempt open" : "attempt";
      case "compaction":
        return `compaction ${row.Id}${row.Age === null ? "" : ` after ${row.Age}`}`;
      case "compacting":
        return row.Pending ? `compacting ${row.Id} pending` : `compacting ${row.Id}`;
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
    expect(shape(layout(turn))).toEqual(["u", "fold Worked for 15s", "a2 +files cp +meta"]);
  });

  it("keeps the changed files under the reply when its actions move below later work", () => {
    const trailing = [...turn.slice(0, 7), command("c4", 7), checkpoint("cp", 8)];
    expect(shape(layout(trailing, { expanded: ["fold:run-1"] })).slice(-3)).toEqual([
      "a2 +files cp",
      "single c4",
      "meta a2",
    ]);
  });

  it("shows a run's changed files as their own row when the run has no reply", () => {
    expect(shape(layout([user("u", 0), command("c", 1), checkpoint("cp", 2)]))).toEqual([
      "u",
      "fold Worked for 15s",
      "cp",
    ]);
  });

  it("keeps a rendered page out of the fold", () => {
    const page = item("dynamic_tool", "page", 3, {
      toolName: "mcp__t3-code__html_render",
      input: {},
      output: {
        structuredContent: { htmlRender: { attachmentId: "a", title: "Chart", height: 400 } },
      },
    });
    expect(shape(layout([user("u", 0), command("c", 1), page, reply("a", 9)]))).toEqual([
      "u",
      "fold Worked for 15s",
      "page",
      "a +meta",
    ]);
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
    // Background work spawned it once the turn settled, so it adds no turn time.
    const late = item("subagent", "sub", 30, { childThreadId: "child", title: "Helper" });
    expect(entryFacts(late)).not.toBeNull();
    expect(shape(layout([...turn, late], { run: null }))[1]).toBe("fold Worked for 6s");
  });

  it("opens into work groups and a lone tool as its own row", () => {
    expect(shape(layout(turn, { expanded: ["fold:run-1"] }))).toEqual([
      "u",
      "fold Worked for 15s",
      "group t,c1,c2",
      "a1",
      "single c3",
      "a2 +files cp +meta",
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

  it("puts back-to-back subagents of one provider turn in one row", () => {
    const subagent = (id: string, second: number, turn: string) =>
      item("subagent", id, second, { providerTurnId: turn, subagentId: id, driver: "codex" });
    const launched = [
      user("u", 0),
      subagent("s1", 1, "p1"),
      subagent("s2", 2, "p1"),
      subagent("s3", 3, "p2"),
      command("c", 4),
      subagent("s4", 5, "p2"),
      reply("a", 9),
    ];
    expect(shape(layout(launched, { expanded: ["fold:run-1"] }))).toEqual([
      "u",
      "fold Worked for 15s",
      "subagents s1,s2",
      "s3",
      "single c",
      "s4",
      "a +meta",
    ]);
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

  it("keeps the reply before a steer, running or settled, so the steer doesn't move", () => {
    const steered = [
      user("u", 0),
      command("c1", 1),
      reply("a1", 2),
      user("s", 3, { runId: "run-1", inputIntent: "steer" }),
      command("c2", 4),
      reply("a2", 9),
    ];
    const settledShape = ["u", "fold Worked for 15s", "a1", "s", "fold Continued for 6s", "a2"];
    expect(shape(layout(steered))).toEqual([...settledShape.slice(0, -1), "a2 +meta"]);
    expect(shape(layout(steered, { run: running, working: true }))).toEqual([
      "u",
      "fold running",
      ...settledShape.slice(2),
    ]);
  });
});

describe("a compaction", () => {
  const compactPrompt = user("u", 0, { runId: "run-1", text: "/compact", attachments: [] });
  const compaction = item("compaction", "k", 1, { beforeTokenCount: 64_800, afterTokenCount: 1 });

  it("stands in for its bare /compact prompt once the provider reports it", () => {
    expect(shape(layout([compactPrompt, compaction]))).toEqual(["compaction k"]);
  });

  it("shows a divider for the prompt until then, which owns a running turn's status", () => {
    expect(shape(layout([compactPrompt]))).toEqual(["compacting u"]);
    expect(shape(layout([compactPrompt], { run: running, working: true }))).toEqual([
      "compacting u pending",
    ]);
    expect(shape(layout([compactPrompt, compaction], { run: running, working: true }))).toEqual([
      "compaction k",
    ]);
  });

  it("keeps a prompt that carries a file", () => {
    const withFile = user("u", 0, {
      runId: "run-1",
      text: "/compact",
      attachments: [{ id: "file" }],
    });
    expect(shape(layout([withFile, compaction]))).toEqual(["u", "compaction k"]);
  });

  it("names the idle time from the answered resume question, which it stands in for", () => {
    const question =
      "This session is 2h 5m old and uses 64,800 tokens. Compact it before continuing?";
    const answered = item("user_input_request", "q", 1, {
      questions: [],
      questionAnswer: {
        requestId: "r",
        questionTextById: { q1: question },
        answers: { q1: "Compact and continue" },
      },
    });
    const later = item("compaction", "k", 2, { beforeTokenCount: 64_800, afterTokenCount: 1 });
    expect(shape(layout([user("u", 0), answered, later, reply("a", 3)]))).toEqual([
      "u",
      "compaction k after 2h 5m",
      "a +meta",
    ]);
  });

  it("drops the stop notice of a compaction that ran, whose divider says it stopped", () => {
    const stopped = item("run_interrupt_result", "i", 2, { message: "Stopped" });
    expect(shape(layout([compactPrompt, compaction, stopped]))).toEqual(["compaction k"]);
  });
});

describe("the tool calls in chat setting", () => {
  const failed = command("c2", 3, { status: "failed", exitCode: 1 });
  const turn = [user("u", 0), thought("t", 1), command("c1", 2), failed, reply("a", 4)];

  it("hides successful tool calls, or all of them, before the turn folds", () => {
    const open = { expanded: ["fold:run-1"] };
    expect(shape(layout(turn, open))).toEqual([
      "u",
      "fold Worked for 15s",
      "group t,c1,c2",
      "a +meta",
    ]);
    expect(shape(layout(turn, { ...open, visibility: "hideSuccessful" }))).toEqual([
      "u",
      "fold Worked for 15s",
      "group t,c2",
      "a +meta",
    ]);
    expect(shape(layout(turn, { ...open, visibility: "hideAll" }))).toEqual([
      "u",
      "fold Worked for 15s",
      "single t",
      "a +meta",
    ]);
  });

  it("in zen shows only prompts, final answers and what needs you, with no folds", () => {
    const error = item("error", "e", 5, {
      status: "failed",
      parentItemId: "c2",
      failure: { class: "provider", message: "Boom" },
    });
    const zen = [user("u", 0), command("c1", 1), reply("a1", 2), error, reply("a2", 6)];
    expect(shape(layout(zen, { visibility: "zen" }))).toEqual(["u", "e", "a2 +meta"]);
  });

  it("in zen holds back the running turn's replies until its provider turn ends", () => {
    const live = [user("u", 0), command("c1", 1), reply("a", 2)];
    expect(shape(layout(live, { visibility: "zen", run: running, working: true }))).toEqual(["u"]);
    const waiting = { ...running, TurnEnded: true };
    expect(shape(layout(live, { visibility: "zen", run: waiting, working: true }))).toEqual([
      "u",
      "a",
    ]);
  });
});

describe("a superseded attempt", () => {
  const superseded: IAttempt = { Id: "att-1", Status: "superseded", CompletedAt: at(4) };
  const current: IAttempt = { Id: "att-2", Status: "completed", CompletedAt: null };
  const attempts = (ids: string[], attempt: IAttempt) =>
    Object.fromEntries(ids.map((id) => [id, attempt]));
  const steered = [
    user("u", 0),
    command("c1", 1),
    // Cut off by the steer: it only finished once the attempt was superseded.
    reply("a1", 2, { completedAt: at(5) }),
    user("s", 4, { runId: "run-1", inputIntent: "steer" }),
    command("c2", 5),
    reply("a2", 9),
  ];
  const cutOff = { ...attempts(["c1", "a1"], superseded), ...attempts(["c2", "a2"], current) };

  it("folds the work a steer cut off under its own row", () => {
    const rows = layout(steered, { attempts: cutOff, expanded: ["fold:run-1"] });
    expect(shape(rows)).toEqual([
      "u",
      "fold Worked for 15s",
      "attempt",
      "s",
      "fold Continued for 5s",
      "a2 +meta",
    ]);
    const open = layout(steered, {
      attempts: cutOff,
      expanded: ["fold:run-1", "attempt:att-1"],
    });
    expect(shape(open).slice(2, 5)).toEqual(["attempt open", "single c1", "a1"]);
  });

  it("keeps an attempt whose reply finished before the steer", () => {
    const finished = steered.map((held) => (held.id === "a1" ? reply("a1", 2) : held));
    const rows = layout(finished, { attempts: cutOff, expanded: ["fold:run-1"] });
    expect(shape(rows)).not.toContain("attempt");
  });
});

describe("a running turn", () => {
  const live = { run: running, working: true };
  const runningCommand = (id: string, second: number) =>
    command(id, second, { status: "running", exitCode: undefined });

  it("shows its fold from the start, before it has any work to hide", () => {
    expect(shape(layout([user("u", 0)], live))).toEqual(["u", "fold running"]);
    expect(shape(layout([user("u", 0), reply("a", 1, { streaming: true })], live))).toEqual([
      "u",
      "fold running",
      "a",
    ]);
  });

  it("hides its work behind the fold, running or failed, and shows only its latest reply", () => {
    const failing = command("c2", 3, { status: "failed", exitCode: 1 });
    expect(shape(layout([user("u", 0), command("c1", 1), runningCommand("c3", 2)], live))).toEqual([
      "u",
      "fold running",
    ]);
    const rows = layout(
      [user("u", 0), command("c1", 1), reply("a1", 2), failing, reply("a2", 4)],
      live,
    );
    expect(shape(rows)).toEqual(["u", "fold running", "a2"]);
    const after = layout([user("u", 0), command("c1", 1), reply("a1", 2), failing], live);
    expect(shape(after)).toEqual(["u", "fold running", "a1"]);
  });

  it("changes only the fold's label and the reply's actions when it settles", () => {
    const turn = [user("u", 0), command("c1", 1), reply("a", 2)];
    expect(shape(layout(turn, live))).toEqual(["u", "fold running", "a"]);
    expect(shape(layout(turn))).toEqual(["u", "fold Worked for 15s", "a +meta"]);
  });

  it("opens mid-turn to show its work, with a reasoning row that something followed ended", () => {
    const rows = layout(
      [
        user("u", 0),
        item("reasoning", "t", 1, { text: "Hmm", status: "running" }),
        runningCommand("c1", 2),
      ],
      { ...live, expanded: ["fold:run-1"] },
    );
    expect(shape(rows)).toEqual(["u", "fold running", "group t,c1"]);
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
