import type { ThreadSearchSubject } from "@t3tools/shared/paletteSearch";
import { describe, expect, it } from "vite-plus/test";

import {
  filterPalette,
  type IPaletteItem,
  paletteRows,
  RECENT_THREAD_LIMIT,
  rootGroups,
} from "./paletteRanking";

const NOW = Date.parse("2026-06-01T00:00:00.000Z");
const DAY = 86_400_000;

const subject = (title: string, activityAt: number, extra: object = {}): ThreadSearchSubject => ({
  id: title as never,
  title,
  branch: null,
  projectTitle: null,
  environmentLabel: null,
  pullRequests: [],
  activityAt,
  opens: null,
  ...extra,
});

const thread = (id: string, title: string, activityAt = NOW - DAY): IPaletteItem => ({
  Value: `thread:${id}`,
  Title: title,
  SearchTerms: [title],
  Icon: "thread",
  Thread: subject(title, activityAt),
});

const project = (id: string, title: string): IPaletteItem => ({
  Value: `project:${id}`,
  Title: title,
  SearchTerms: [title, `/code/${id}`],
  Icon: "project",
});

const newThreadIn: IPaletteItem = {
  Value: "action:new-thread-in",
  Title: "New thread in...",
  SearchTerms: ["new thread", "project"],
  Icon: "new-thread",
  Submenu: [
    {
      Value: "new-thread-in",
      Label: "Projects",
      Items: [
        { ...project("p1", "Reflex"), Value: "new-thread-in:p1" },
        { ...project("p2", "Portal"), Value: "new-thread-in:p2" },
      ],
    },
  ],
};
const actions: IPaletteItem[] = [
  {
    Value: "action:new-thread",
    Title: "New thread in Reflex",
    SearchTerms: ["new thread", "chat", "create", "draft"],
    Icon: "new-thread",
  },
  newThreadIn,
  {
    Value: "action:add-project",
    Title: "Add project",
    SearchTerms: ["add project", "folder"],
    Icon: "add-project",
  },
];
const threads = [
  thread("1", "New thread"),
  thread("2", "Deploy pipeline", NOW - 2 * DAY),
  thread("3", "Fix flaky deploy test", NOW - 10 * DAY),
];
const projects = [project("p1", "Reflex"), project("p2", "Portal")];

const filter = (query: string, extra: Partial<Parameters<typeof filterPalette>[0]> = {}) =>
  filterPalette({
    groups: rootGroups(actions, threads, null),
    query,
    inSubmenu: false,
    actions,
    projects,
    threads,
    messages: [],
    now: NOW,
    ...extra,
  });
const values = (groups: ReturnType<typeof filter>) => paletteRows(groups).map((item) => item.Value);
const labels = (groups: ReturnType<typeof filter>) => groups.map((group) => group.Label);

describe("rootGroups", () => {
  it("lists actions, then recently used threads without the open one", () => {
    const many = Array.from({ length: 15 }, (_, index) =>
      thread(`${index}`, `T${index}`, NOW - index),
    );
    const groups = rootGroups(actions, many, "thread:0");
    expect(labels(groups)).toEqual(["Actions", "Recent Threads"]);
    expect(groups[1]!.Items).toHaveLength(RECENT_THREAD_LIMIT);
    expect(groups[1]!.Items[0]!.Value).toBe("thread:1");
  });
});

describe("filterPalette", () => {
  it("shows the root groups for an empty query", () => {
    expect(labels(filter(""))).toEqual(["Actions", "Recent Threads"]);
  });

  it("runs a command before a thread of the same name", () => {
    const groups = filter("new");
    expect(groups[0]!.Value).toBe("actions");
    expect(values(groups)[0]).toBe("action:new-thread");
    expect(values(groups)).toContain("thread:1");
  });

  it("ranks threads by match and recency, highlighting the title", () => {
    const groups = filter("deploy");
    expect(groups[0]!.Value).toBe("threads-search");
    expect(groups[0]!.Items.map((item) => item.Value)).toEqual(["thread:2", "thread:3"]);
    expect(groups[0]!.Items[0]!.Ranges?.length).toBeGreaterThan(0);
  });

  it("finds projects, and submenu options as suggestions", () => {
    const groups = filter("portal");
    expect(values(groups)).toContain("project:p2");
    expect(paletteRows(groups).find((item) => item.Value === "new-thread-in:p2")?.Title).toBe(
      "New thread in Portal",
    );
  });

  it("searches only actions after a leading >", () => {
    expect(labels(filter(">"))).toEqual(["Actions"]);
    expect(values(filter(">deploy"))).toEqual([]);
    expect(values(filter(">add"))).toEqual(["action:add-project"]);
  });

  it("filters a submenu's own options", () => {
    const groups = filter("ref", { groups: newThreadIn.Submenu!, inSubmenu: true });
    expect(values(groups)).toEqual(["new-thread-in:p1"]);
  });

  it("adds message matches last, skipping threads already listed", () => {
    const groups = filter("deploy", {
      messages: [
        { ...threads[1]!, Snippet: "ran the deploy" },
        { ...threads[0]!, Snippet: "deploy it" },
      ],
    });
    expect(groups.at(-1)!.Label).toBe("In messages");
    expect(groups.at(-1)!.Items.map((item) => item.Value)).toEqual(["thread:1"]);
  });

  it("lists the open thread last in its group", () => {
    const current = { ...threads[1]!, Secondary: true };
    const groups = filter("deploy", { threads: [current, threads[2]!] });
    expect(groups[0]!.Items.map((item) => item.Value)).toEqual(["thread:3", "thread:2"]);
  });
});
