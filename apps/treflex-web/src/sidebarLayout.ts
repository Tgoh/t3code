import { type IInbox, isWorkingIn } from "./inbox";
import type { IPreferences } from "./Infrastructure/preferences";
import type { IWireProject, IWireThreadShell } from "./Infrastructure/wire";
import { type IProjectSort, orderFolders } from "./projectOrder";
import {
  type IProjectFolder,
  type ISidebarSections,
  type ISubagentRequest,
  projectFolders,
  runCompletedAt,
  sidebarSections,
  threadWorking,
  unhiddenThreads,
} from "./Shell";
import { liveScope, scopeThreads } from "./threadSearch";

export const SETTLED_PAGE = 25;

/** Which of the sidebar's shelves are open on this page. Not kept across reloads. */
export interface IShelves {
  WorkingOpen: boolean;
  SnoozedOpen: boolean;
  SettledOpen: boolean;
  SettledShown: number;
}

export interface ISidebarInput {
  Threads: IWireThreadShell[];
  Projects: Record<string, IWireProject>;
  SelectedId: string | null;
  Now: number;
  Subagents: Record<string, ISubagentRequest>;
  Preferences: IPreferences;
  ProjectSort: IProjectSort;
  /** The Working section's tracker, or null while it isn't shown. */
  Inbox: IInbox | null;
  Shelves: IShelves;
}

const sortable = (value: string | null | undefined) => {
  const at = value == null ? NaN : Date.parse(value);
  return Number.isFinite(at) ? at : 0;
};

const newestFirst =
  (stamps: Map<IWireThreadShell, number>) => (left: IWireThreadShell, right: IWireThreadShell) =>
    stamps.get(right)! - stamps.get(left)! || left.id.localeCompare(right.id);

// Follows sortInboxThreadsByReturn in packages/client-runtime/src/state/threadInbox.ts.
function byReturn(threads: IWireThreadShell[], inbox: IInbox): IWireThreadShell[] {
  const stamps = new Map(
    threads.map((thread) => [
      thread,
      Math.max(
        sortable(thread.createdAt),
        sortable(thread.unsettledAt),
        thread.latestRunId === null ? 0 : sortable(thread.latestRunRequestedAt),
        thread.latestRunId === null ? 0 : sortable(runCompletedAt(thread)),
        inbox.Returns[thread.id] ?? 0,
      ),
    ]),
  );
  return threads.toSorted(newestFirst(stamps));
}

// Follows sortWorkingThreadsBySend in packages/client-runtime/src/state/threadInbox.ts.
function bySend(threads: IWireThreadShell[]): IWireThreadShell[] {
  const stamps = new Map(
    threads.map((thread) => [
      thread,
      Math.max(
        sortable(thread.createdAt),
        sortable(
          thread.latestUserAuthoredMessageAt === undefined
            ? thread.latestRunId === null
              ? null
              : thread.latestRunRequestedAt
            : thread.latestUserAuthoredMessageAt,
        ),
      ),
    ]),
  );
  return threads.toSorted(newestFirst(stamps));
}

export interface ISidebarLayout {
  /** The project filter, less projects that are gone or hidden. */
  Scope: string[];
  /** Threads past the hidden projects and the filter, which search also reads. */
  Visible: IWireThreadShell[];
  Sections: ISidebarSections;
  /** Ordered project folders while grouped by project, else empty. */
  Folders: IProjectFolder[];
  /** Thread ids as the sidebar lists them, for next and previous thread. */
  Order: string[];
}

// Follows partitionSidebarThreads in apps/web/src/components/Sidebar.tsx with the Working shelf on.
function workingSplit(
  sections: ISidebarSections,
  inbox: IInbox,
  subagents: Record<string, ISubagentRequest>,
): ISidebarSections {
  const active: IWireThreadShell[] = [];
  const working: IWireThreadShell[] = [];
  for (const thread of sections.Active) {
    const held = isWorkingIn(inbox, thread.id, threadWorking(thread, subagents[thread.id]));
    (held ? working : active).push(thread);
  }
  return { ...sections, Active: byReturn(active, inbox), Working: bySend(working) };
}

export function layoutSidebar(input: ISidebarInput): ISidebarLayout {
  const { Preferences: preferences, Shelves: shelves, SelectedId: selectedId } = input;
  const hidden = new Set(preferences.HiddenProjects);
  const shown = new Set(
    Object.values(input.Projects)
      .filter((project) => project.archivedAt == null && !hidden.has(project.id))
      .map((project) => project.id),
  );
  const scope = liveScope(new Set(preferences.ProjectScope), shown);
  const visible = scopeThreads(
    unhiddenThreads(input.Threads, hidden, selectedId),
    scope,
    selectedId,
  );
  const sorted = sidebarSections(visible, input.Now, input.Subagents);
  // Grouped by project, pinned threads lead their own folder rather than a Pinned section.
  // Folders already separate the work, so as in stock's boring sidebar there's no Working section.
  const inbox = preferences.GroupByProject ? null : input.Inbox;
  const sections = preferences.GroupByProject
    ? { ...sorted, Pinned: [] }
    : inbox === null
      ? sorted
      : workingSplit(sorted, inbox, input.Subagents);
  const folders = preferences.GroupByProject
    ? orderFolders(
        projectFolders([...sorted.Pinned, ...sorted.Active], input.Projects, hidden).filter(
          (folder) => scope.size === 0 || scope.has(folder.ProjectId) || folder.Threads.length > 0,
        ),
        input.ProjectSort,
        preferences.ProjectOrder,
        visible,
      )
    : [];
  // A closed folder or shelf still lists the open thread, so its row doesn't vanish on settling it.
  const onlySelected = (threads: IWireThreadShell[]) =>
    threads.filter((thread) => thread.id === selectedId);
  const closed = new Set(preferences.ClosedFolders);
  const order = [
    ...sections.Pinned,
    ...(preferences.GroupByProject
      ? folders.flatMap((folder) =>
          closed.has(folder.ProjectId) ? onlySelected(folder.Threads) : folder.Threads,
        )
      : sections.Active),
    ...(shelves.WorkingOpen ? sections.Working : onlySelected(sections.Working)),
    ...(shelves.SnoozedOpen ? sections.Snoozed : onlySelected(sections.Snoozed)),
    ...(shelves.SettledOpen
      ? sections.Settled.slice(0, shelves.SettledShown)
      : onlySelected(sections.Settled)),
  ].map((thread) => thread.id);
  return {
    Scope: [...scope],
    Visible: visible,
    Sections: sections,
    Folders: folders,
    Order: order,
  };
}
