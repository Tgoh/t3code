import {
  type EnvironmentThreadSearchMatch,
  nextShownOrder,
  type ShownOrder,
  threadSearchSubject,
  type ThreadSearchShell,
} from "@t3tools/client-runtime/state/thread-search";
import {
  foldSearchQuery,
  rankMessageMatches,
  rankSearchItems,
  scoreThreadSearch,
  type SearchRange,
  type ThreadSearchSubject,
} from "@t3tools/shared/paletteSearch";

import type { IWireThreadShell } from "./Infrastructure/wire";
import { isMainThread } from "./Shell";

export type IThreadSearchMatch = EnvironmentThreadSearchMatch;

// threadSearchSubject caches by shell identity, so each wire row keeps one search shell.
const searchShells = new WeakMap<IWireThreadShell, ThreadSearchShell>();

export function threadSubject(
  thread: IWireThreadShell,
  environmentId: string,
  projectTitle: string | null = null,
): ThreadSearchSubject {
  let shell = searchShells.get(thread);
  if (shell === undefined) {
    shell = { ...thread, environmentId } as unknown as ThreadSearchShell;
    searchShells.set(thread, shell);
  }
  return threadSearchSubject(shell, projectTitle);
}

export interface ISearchResult {
  Thread: IWireThreadShell;
  /** Where the title matches, for highlighting. */
  Ranges: ReadonlyArray<SearchRange>;
  /** Set on rows listed only because a message matches. */
  Match: IThreadSearchMatch | null;
}

// Follows searchSidebarThreads in apps/web/src/components/Sidebar.logic.ts: title, branch and pull
// request matches ranked as the palette ranks them, then threads listed only for their messages, in
// `messageOrder`.
export function searchThreads(input: {
  threads: readonly IWireThreadShell[];
  environmentId: string;
  query: string;
  messages: readonly IThreadSearchMatch[];
  messageOrder: readonly string[];
  now: number;
}): ISearchResult[] {
  const query = foldSearchQuery(input.query);
  if (query.length === 0) return [];
  const titles = rankSearchItems(input.threads, (thread, options) =>
    scoreThreadSearch(query, threadSubject(thread, input.environmentId), input.now, {
      ...options,
      picks: false,
    }),
  ).map(({ item, match }): ISearchResult => ({ Thread: item, Ranges: match.ranges, Match: null }));
  const listed = new Set<string>(titles.map((result) => result.Thread.id));
  const byId = new Map<string, IWireThreadShell>(
    input.threads.map((thread) => [thread.id, thread]),
  );
  const matchById = new Map<string, IThreadSearchMatch>(
    input.messages.map((match) => [match.threadId, match]),
  );
  const messages = input.messageOrder.flatMap((threadId): ISearchResult[] => {
    const thread = byId.get(threadId);
    const match = matchById.get(threadId);
    return thread === undefined || match === undefined || listed.has(threadId)
      ? []
      : [{ Thread: thread, Ranges: [], Match: match }];
  });
  return [...titles, ...messages];
}

/**
 * Server message matches for threads this client lists, best first, kept in the places they were
 * shown so late answers don't move rows under the pointer.
 */
export function rankMessages(input: {
  threads: readonly IWireThreadShell[];
  environmentId: string;
  query: string;
  matches: readonly IThreadSearchMatch[];
  shown: ShownOrder | null;
  now: number;
}): ShownOrder {
  const byId = new Map(input.threads.map((thread) => [thread.id, thread]));
  const ranked = rankMessageMatches(
    input.matches,
    (match) => {
      const thread = byId.get(match.threadId);
      return thread === undefined ? undefined : threadSubject(thread, input.environmentId);
    },
    foldSearchQuery(input.query),
    input.now,
    { picks: false },
  );
  return nextShownOrder(
    input.shown,
    input.query,
    ranked.map((match) => match.threadId),
    Number.POSITIVE_INFINITY,
  );
}

export interface IResultGroup {
  /** Null when the sidebar isn't grouped by project. */
  ProjectId: string | null;
  Results: ISearchResult[];
}

/**
 * Lays results out as the sidebar lists threads: grouped by project in folder order, with a Main
 * thread leading its project, or as one ranked list.
 */
export function groupResults(
  results: readonly ISearchResult[],
  folderOrder: readonly string[] | null,
): IResultGroup[] {
  if (folderOrder === null)
    return results.length === 0 ? [] : [{ ProjectId: null, Results: [...results] }];
  const groups = new Map<string, ISearchResult[]>();
  for (const projectId of folderOrder) groups.set(projectId, []);
  for (const result of results) {
    const projectId = result.Thread.projectId;
    const group = groups.get(projectId);
    if (group === undefined) groups.set(projectId, [result]);
    else group.push(result);
  }
  return [...groups]
    .filter(([, held]) => held.length > 0)
    .map(([projectId, held]) => ({
      ProjectId: projectId,
      Results: held.sort(
        (left, right) => Number(isMainThread(right.Thread)) - Number(isMainThread(left.Thread)),
      ),
    }));
}

/**
 * Leaves out threads outside the chosen projects, except the selected one, as hidden projects do;
 * no choice means every project.
 */
export function scopeThreads<T extends { id: string; projectId: string }>(
  threads: readonly T[],
  scope: ReadonlySet<string>,
  selectedId: string | null,
): T[] {
  return scope.size === 0
    ? [...threads]
    : threads.filter((thread) => scope.has(thread.projectId) || thread.id === selectedId);
}

/** A scope whose projects are all gone or hidden reads as every project. */
export function liveScope(
  scope: ReadonlySet<string>,
  pickable: ReadonlySet<string>,
): ReadonlySet<string> {
  const live = [...scope].filter((projectId) => pickable.has(projectId));
  return live.length === scope.size ? scope : new Set(live);
}
