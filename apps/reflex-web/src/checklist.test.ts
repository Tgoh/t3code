import { describe, expect, it } from "vite-plus/test";

import {
  activeStepIndex,
  checklistWindow,
  currentTodoSteps,
  earlierCompletedSteps,
  type IChecklistStep,
  liveSteps,
} from "./checklist";
import type { IWireTurnItem } from "./Infrastructure/wire";

const step = (id: string, status: IChecklistStep["status"]): IChecklistStep =>
  ({ id, text: id, status }) as IChecklistStep;

const todo = (runId: string, ...steps: IChecklistStep[]): IWireTurnItem =>
  ({ type: "todo_list", runId, steps }) as unknown as IWireTurnItem;

const other = (runId: string | null): IWireTurnItem =>
  ({ type: "assistant_message", runId }) as unknown as IWireTurnItem;

const ordinals: Record<string, number> = { "run-1": 1, "run-2": 2, "run-3": 3 };
const runOrdinal = (id: string) => ordinals[id];
const run2 = { id: "run-2", ordinal: 2 };

describe("currentTodoSteps", () => {
  it("takes the newest list in the run", () => {
    const older = todo("run-2", step("a", "running"));
    const newer = todo("run-2", step("a", "completed"), step("b", "running"));
    const steps = currentTodoSteps([other("run-2"), newer, older], run2, runOrdinal);
    expect(steps?.map((held) => held.id)).toEqual(["a", "b"]);
  });

  it("ignores an earlier run's list", () => {
    const items = [other("run-2"), other(null), todo("run-1", step("a", "pending"))];
    expect(currentTodoSteps(items, run2, runOrdinal)).toBeNull();
  });

  it("passes over rows of later or unknown runs", () => {
    const items = [other("run-3"), other("queued"), undefined, todo("run-2", step("a", "pending"))];
    expect(currentTodoSteps(items, run2, runOrdinal)).toHaveLength(1);
  });

  it("treats an empty list as none", () => {
    expect(currentTodoSteps([todo("run-2")], run2, runOrdinal)).toBeNull();
  });
});

describe("liveSteps", () => {
  const texts = (steps: readonly IChecklistStep[]) => steps.map((held) => held.text);
  const named = (id: string, text: string, status: IChecklistStep["status"]) =>
    ({ id, text, status }) as IChecklistStep;

  it("leaves out steps an earlier run finished, by id, and keeps unfinished carried steps", () => {
    const earlier = earlierCompletedSteps([
      [named("task-1", "One", "completed"), named("task-2", "Two", "pending")],
      [named("task-3", "Three", "completed")],
    ]);
    const current = [
      named("task-1", "One", "completed"),
      named("task-2", "Two", "completed"),
      named("task-3", "Three", "completed"),
      named("task-4", "One", "running"),
    ];
    expect(texts(liveSteps(current, earlier))).toEqual(["Two", "One"]);
  });

  it("matches positional ids by text and finished status", () => {
    const earlier = earlierCompletedSteps([
      [named("todo-0", "One", "completed"), named("todo-1", "Two", "pending")],
    ]);
    const current = [
      named("todo-0", "Zero", "completed"),
      named("todo-1", "One", "completed"),
      named("todo-2", "Two", "completed"),
      named("todo-3", "One", "pending"),
    ];
    expect(texts(liveSteps(current, earlier))).toEqual(["Zero", "Two", "One"]);
  });

  it("keeps a whole new list when nothing came before", () => {
    const current = [named("step-1", "One", "completed")];
    expect(liveSteps(current, earlierCompletedSteps([]))).toEqual(current);
  });
});

describe("activeStepIndex", () => {
  it.each([
    [["completed", "running", "pending"], 1],
    [["completed", "pending", "running"], 2],
    [["completed", "pending", "pending"], 1],
    [["completed", "completed"], -1],
  ] as const)("%j is at %i", (statuses, expected) => {
    expect(activeStepIndex(statuses.map((status, index) => step(`${index}`, status)))).toBe(
      expected,
    );
  });
});

describe("checklistWindow", () => {
  it.each([
    [5, 4, { start: 0, end: 5 }],
    [9, 0, { start: 0, end: 6 }],
    [9, 4, { start: 3, end: 9 }],
    [9, 3, { start: 2, end: 8 }],
    [9, 8, { start: 3, end: 9 }],
    [9, -1, { start: 3, end: 9 }],
  ])("%i steps with step %i active", (count, active, expected) => {
    expect(checklistWindow(count, active)).toEqual(expected);
  });

  it("keeps the active step in view and the row count fixed", () => {
    for (let active = 0; active < 20; active += 1) {
      const { start, end } = checklistWindow(20, active);
      expect(end - start).toBe(6);
      expect(active).toBeGreaterThanOrEqual(start);
      expect(active).toBeLessThan(end);
    }
  });
});
