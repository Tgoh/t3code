import type { IWireTurnItem } from "./Infrastructure/wire";

export type IChecklistStep = Extract<IWireTurnItem, { type: "todo_list" }>["steps"][number];

export const CHECKLIST_ROWS = 6;

/**
 * The steps of the latest to-do list in the given run, read newest first from the timeline. Reading
 * stops at the first item of an earlier run, so a run without a list costs only its own items.
 */
export function currentTodoSteps(
  newestFirst: Iterable<IWireTurnItem | undefined>,
  run: { id: string; ordinal: number },
  runOrdinal: (runId: string) => number | undefined,
): readonly IChecklistStep[] | null {
  for (const item of newestFirst) {
    if (item === undefined || item.runId === null) continue;
    if (item.runId !== run.id) {
      const ordinal = runOrdinal(item.runId);
      if (ordinal !== undefined && ordinal < run.ordinal) return null;
      continue;
    }
    if (item.type === "todo_list" && item.steps.length > 0) return item.steps;
  }
  return null;
}

export interface IEarlierSteps {
  Ids: Set<string>;
  Texts: Set<string>;
}

// Claude's TodoWrite numbers its steps `todo-<i>` and Codex `step-<i+1>`, by position, so a new
// list reuses the ids. Claude's task tools keep a task's id across turns. See claudeTodoSteps and
// the plan steps in CodexAdapterV2.ts.
const isPositional = (steps: readonly IChecklistStep[]): boolean =>
  steps.every((step, index) => step.id === `todo-${index}` || step.id === `step-${index + 1}`);

/** What earlier runs' to-do lists had finished, by id where ids last across lists, else by text. */
export function earlierCompletedSteps(lists: Iterable<readonly IChecklistStep[]>): IEarlierSteps {
  const earlier: IEarlierSteps = { Ids: new Set(), Texts: new Set() };
  for (const steps of lists) {
    const positional = isPositional(steps);
    for (const step of steps) {
      if (step.status !== "completed") continue;
      earlier.Texts.add(step.text);
      if (!positional) earlier.Ids.add(step.id);
    }
  }
  return earlier;
}

/**
 * The run's steps less those an earlier run finished, which an agent's list carries across turns.
 * Where ids are positional, a step is matched by its text and has to be finished in both runs.
 */
export function liveSteps(
  steps: readonly IChecklistStep[],
  earlier: IEarlierSteps,
): readonly IChecklistStep[] {
  if (isPositional(steps))
    return steps.filter((step) => step.status !== "completed" || !earlier.Texts.has(step.text));
  return steps.filter((step) => !earlier.Ids.has(step.id));
}

/** The step being worked on: the running one, else the first not done, else -1. */
export function activeStepIndex(steps: readonly IChecklistStep[]): number {
  const running = steps.findIndex((step) => step.status === "running");
  return running === -1 ? steps.findIndex((step) => step.status === "pending") : running;
}

/**
 * Which steps show in a list capped at `cap` rows: the active step with one before it where room
 * allows, or the last rows once every step is done. The row count depends only on the step count.
 */
export function checklistWindow(
  count: number,
  active: number,
  cap = CHECKLIST_ROWS,
): { start: number; end: number } {
  if (count <= cap) return { start: 0, end: count };
  const start = active === -1 ? count - cap : Math.min(Math.max(active - 1, 0), count - cap);
  return { start, end: start + cap };
}
