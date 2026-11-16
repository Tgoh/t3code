import {
  getThreadSortTimestamp,
  toSortableTimestamp,
} from "@t3tools/client-runtime/state/thread-sort";
import type { SidebarProjectSortOrder } from "@t3tools/contracts/settings";

import type { IWireProject, IWireThreadShell } from "./Infrastructure/wire";
import type { IProjectFolder } from "./Shell";

export type IProjectSort = SidebarProjectSortOrder;

// Follows SIDEBAR_PROJECT_SORT_ORDER_LABELS in apps/web/src/components/settings/SettingsPanels.tsx.
export const PROJECT_SORT_LABELS: Record<IProjectSort, string> = {
  updated_at: "Last user message",
  created_at: "Created at",
  manual: "Manual",
};

export function isProjectSort(value: unknown): value is IProjectSort {
  return typeof value === "string" && Object.hasOwn(PROJECT_SORT_LABELS, value);
}

const title = (folder: IProjectFolder) => folder.Project?.title ?? "";

// Archived projects with active threads sit last in every order.
const archivedLast = (left: IProjectFolder, right: IProjectFolder) =>
  Number(left.Project?.archivedAt != null) - Number(right.Project?.archivedAt != null);

const pinnedFirst = (left: IProjectFolder, right: IProjectFolder) => {
  const leftPin = left.Project?.pinnedAt;
  const rightPin = right.Project?.pinnedAt;
  if (leftPin != null && rightPin != null) return Date.parse(leftPin) - Date.parse(rightPin);
  return Number(rightPin != null) - Number(leftPin != null);
};

// Follows getProjectSortTimestamp in apps/web/src/components/Sidebar.logic.ts.
function projectTimestamp(
  project: IWireProject | undefined,
  threads: readonly IWireThreadShell[],
  sort: Exclude<IProjectSort, "manual">,
): number {
  if (threads.length > 0) {
    return threads.reduce(
      (latest, thread) => Math.max(latest, getThreadSortTimestamp(thread, sort)),
      Number.NEGATIVE_INFINITY,
    );
  }
  if (project === undefined) return Number.NEGATIVE_INFINITY;
  const at = sort === "created_at" ? project.createdAt : (project.updatedAt ?? project.createdAt);
  return toSortableTimestamp(at) ?? Number.NEGATIVE_INFINITY;
}

/**
 * Manual puts the saved ids first, in their saved order, then the rest pinned first and by
 * title; ids no longer shown are skipped. The other orders keep pinned projects on top.
 */
export function orderFolders(
  folders: readonly IProjectFolder[],
  sort: IProjectSort,
  savedOrder: readonly string[],
  threads: readonly IWireThreadShell[],
): IProjectFolder[] {
  if (sort === "manual") {
    const saved = new Map(savedOrder.map((id, index) => [id, index]));
    const rank = (folder: IProjectFolder) => saved.get(folder.ProjectId) ?? Infinity;
    return [...folders].sort(
      (left, right) =>
        archivedLast(left, right) ||
        (rank(left) === rank(right) ? 0 : rank(left) < rank(right) ? -1 : 1) ||
        pinnedFirst(left, right) ||
        title(left).localeCompare(title(right)),
    );
  }
  const byProject = new Map<string, IWireThreadShell[]>();
  for (const thread of threads) {
    if (thread.archivedAt != null) continue;
    const held = byProject.get(thread.projectId);
    if (held === undefined) byProject.set(thread.projectId, [thread]);
    else held.push(thread);
  }
  const stamped = folders.map((folder) => ({
    folder,
    at: projectTimestamp(folder.Project, byProject.get(folder.ProjectId) ?? [], sort),
  }));
  return stamped
    .sort(
      (left, right) =>
        archivedLast(left.folder, right.folder) ||
        pinnedFirst(left.folder, right.folder) ||
        (right.at === left.at ? 0 : right.at > left.at ? 1 : -1) ||
        title(left.folder).localeCompare(title(right.folder)),
    )
    .map(({ folder }) => folder);
}

/**
 * Moves `id` to the gap before `order[gap]` (or the end when `gap` is the length), where
 * gaps are counted in the order as it was before the move. Returns null when nothing moves.
 */
export function moveProject(order: readonly string[], id: string, gap: number): string[] | null {
  const from = order.indexOf(id);
  if (from < 0) return null;
  const to = Math.max(0, Math.min(gap, order.length));
  if (to === from || to === from + 1) return null;
  const next = order.filter((held) => held !== id);
  next.splice(to > from ? to - 1 : to, 0, id);
  return next;
}

/** The gap a pointer at `y` drops into: before the first header whose middle is below it. */
export function dropGap(headerMiddles: readonly number[], y: number): number {
  let low = 0;
  let high = headerMiddles.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (headerMiddles[mid]! <= y) low = mid + 1;
    else high = mid;
  }
  return low;
}
