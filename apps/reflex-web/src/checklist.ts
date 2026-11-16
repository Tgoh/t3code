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
