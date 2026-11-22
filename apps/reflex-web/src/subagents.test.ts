import { describe, expect, it } from "vite-plus/test";

import {
  type INotificationItem,
  type ISubagent,
  notificationEvent,
  notifiedSubagent,
} from "./subagents";

const at = (minute: number) => `2026-06-20T00:${String(minute).padStart(2, "0")}:00.000Z`;

const agent = (id: string, child: string, fields: Partial<ISubagent> = {}) =>
  ({
    id,
    childThreadId: child,
    status: "completed",
    startedAt: at(1),
    completedAt: at(2),
    ...fields,
  }) as ISubagent;

const notification = (source: Record<string, unknown>, outcome = "completed") =>
  ({
    type: "notification",
    source,
    outcome,
    summary: "Done",
    startedAt: at(3),
    updatedAt: at(3),
  }) as unknown as INotificationItem;

describe("a notification about a subagent", () => {
  const alpha = agent("task-a", "child-a");
  const beta = agent("task-b", "child-b");
  const agents = { [alpha.id]: alpha, [beta.id]: beta };

  it("finds its task from the child thread", () => {
    const named = notification({ kind: "subagent", childThreadId: "child-b" });
    expect(notifiedSubagent(agents, named)).toBe(beta);
    expect(notifiedSubagent(agents, notification({ kind: "background_task" }))).toBeNull();
  });

  it("finds a delegated task by its task ids", () => {
    const delegated = notification({
      kind: "delegated_task",
      taskIds: ["task-a"],
      childThreadId: "child-b",
    });
    expect(notifiedSubagent(agents, delegated)).toBe(alpha);
  });

  it("shows its outcome until the task starts again", () => {
    const finished = notification({ kind: "subagent", childThreadId: "child-a" });
    expect(notificationEvent(finished, alpha)).toEqual({
      Status: "completed",
      Label: "Finished",
      At: at(3),
    });
    expect(notificationEvent(finished, agent("task-a", "child-a", { startedAt: at(4) }))).toBe(
      undefined,
    );
    expect(notificationEvent(finished, agent("task-a", "child-a", { status: "running" }))).toBe(
      undefined,
    );
    const updated = notification({ kind: "subagent", childThreadId: "child-a" }, "updated");
    expect(notificationEvent(updated, agent("task-a", "child-a", { status: "running" }))).toEqual({
      Status: null,
      Label: "Updated",
      At: at(3),
    });
  });
});
