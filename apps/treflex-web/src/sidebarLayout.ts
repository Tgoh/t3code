import type { IPreferences } from "./Infrastructure/preferences";
import type { IWireProject, IWireThreadShell } from "./Infrastructure/wire";
import { orderFolders } from "./projectOrder";
import {
  type IProjectFolder,
  type ISidebarSections,
  type ISubagentRequest,
  projectFolders,
  sidebarSections,
  unhiddenThreads,
} from "./Shell";
import { liveScope, scopeThreads } from "./threadSearch";

export const SETTLED_PAGE = 25;

/** Which of the sidebar's shelves are open on this page. Not kept across reloads. */
export interface IShelves {
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
  Shelves: IShelves;
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
  const sections = preferences.GroupByProject ? { ...sorted, Pinned: [] } : sorted;
  const folders = preferences.GroupByProject
    ? orderFolders(
        projectFolders([...sorted.Pinned, ...sorted.Active], input.Projects, hidden).filter(
          (folder) => scope.size === 0 || scope.has(folder.ProjectId) || folder.Threads.length > 0,
        ),
        preferences.ProjectSort,
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
