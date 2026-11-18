import {
  foldSearchQuery,
  PALETTE_MESSAGE_LIMIT,
  PALETTE_SECONDARY_LIMIT,
  PALETTE_THREAD_LIMIT,
  rankSearchGroups,
  scoreSearchTerms,
  scoreThreadSearch,
  type SearchMatchHint,
  type SearchRange,
  threadRecentUse,
  type ThreadSearchSubject,
} from "@t3tools/shared/paletteSearch";

import type { IAppCommand } from "./keybindings";

export const RECENT_THREAD_LIMIT = 12;

export type IPaletteIcon = "new-thread" | "add-project" | "project" | "thread" | "focus" | "rename";

export interface IPaletteItem {
  /** Unique across the palette: `action:…`, `project:<id>`, `thread:<id>`. */
  Value: string;
  Title: string;
  /** Text in the title shown bold, as stock's `New thread in <project>`. */
  Emphasis?: string;
  Description?: string;
  SearchTerms: readonly string[];
  Icon: IPaletteIcon;
  /** Thread rows rank by this, with use history, instead of by `SearchTerms`. */
  Thread?: ThreadSearchSubject;
  /** Shows the thread's status and its project, environment, branch and provider line. */
  ThreadId?: string;
  Shortcut?: IAppCommand;
  /** Listed last in its group, as the open thread is. */
  Secondary?: boolean;
  /** Opens this nested list instead of running. */
  Submenu?: IPaletteGroup[];
  Timestamp?: string;
  Ranges?: ReadonlyArray<SearchRange>;
  Hint?: SearchMatchHint;
  Snippet?: string;
}

export interface IPaletteGroup {
  Value: string;
  Label: string;
  Items: IPaletteItem[];
}

// Follows scorePaletteItem and rankPaletteItem in apps/web/src/components/CommandPalette.logic.ts.
function rankItem(
  item: IPaletteItem,
  query: string,
  now: number,
  options: { readonly typos: boolean },
) {
  const match = item.Thread
    ? scoreThreadSearch(query, item.Thread, now, options)
    : (() => {
        const terms =
          item.Title !== item.SearchTerms[0] ? [item.Title, ...item.SearchTerms] : item.SearchTerms;
        return scoreSearchTerms(query, terms, options);
      })();
  return match && item.Secondary ? { ...match, groupQuality: 0 } : match;
}

// Follows buildRootGroups and the recent threads in apps/web/src/components/CommandPalette.tsx:
// recent means used recently, written in or opened, and the open thread is left out.
export function rootGroups(
  actions: readonly IPaletteItem[],
  threads: readonly IPaletteItem[],
  currentThreadValue: string | null,
): IPaletteGroup[] {
  const recent = threads
    .filter((item) => item.Value !== currentThreadValue)
    .toSorted(
      (left, right) =>
        (right.Thread ? threadRecentUse(right.Thread) : 0) -
        (left.Thread ? threadRecentUse(left.Thread) : 0),
    )
    .slice(0, RECENT_THREAD_LIMIT);
  return [
    ...(actions.length > 0 ? [{ Value: "actions", Label: "Actions", Items: [...actions] }] : []),
    ...(recent.length > 0
      ? [{ Value: "recent-threads", Label: "Recent Threads", Items: recent }]
      : []),
  ];
}

// Follows buildNestedSearchItems in apps/web/src/components/CommandPalette.logic.ts.
function nestedItems(actions: readonly IPaletteItem[], query: string): IPaletteItem[] {
  const topLevel = new Set(actions.map((item) => item.Title));
  const folded = foldSearchQuery(query);
  return actions.flatMap((parent) => {
    if (parent.Submenu === undefined) return [];
    const stem = parent.Title.replace(/(\.\.\.|…)$/u, "");
    if (foldSearchQuery(stem).startsWith(folded)) return [];
    const prefix = stem === parent.Title ? `${stem}: ` : `${stem.trimEnd()} `;
    return parent.Submenu.flatMap((group) =>
      group.Items.flatMap((child) => {
        if (child.Submenu !== undefined) return [];
        const title = `${prefix}${child.Title}`;
        if (topLevel.has(title)) return [];
        const { Emphasis: _emphasis, ...rest } = child;
        return [{ ...rest, Title: title, SearchTerms: [title] }];
      }),
    );
  });
}

/**
 * Follows filterCommandPaletteGroups in apps/web/src/components/CommandPalette.logic.ts. Equal match
 * classes put commands before threads, so "new" runs "New thread". A leading `>` searches only
 * actions. Message matches stay in a final group so late results can't move earlier rows.
 */
export function filterPalette(input: {
  /** The groups on screen: the root's, or a submenu's. */
  groups: readonly IPaletteGroup[];
  query: string;
  inSubmenu: boolean;
  actions: readonly IPaletteItem[];
  projects: readonly IPaletteItem[];
  threads: readonly IPaletteItem[];
  /** Threads whose messages match, best first; threads already listed are skipped. */
  messages: readonly IPaletteItem[];
  now: number;
}): IPaletteGroup[] {
  const actionsOnly = input.query.startsWith(">");
  const query = foldSearchQuery(actionsOnly ? input.query.slice(1) : input.query);
  if (query.length === 0) {
    return actionsOnly
      ? input.groups.filter((group) => group.Value === "actions")
      : [...input.groups];
  }
  const everything = !input.inSubmenu && !actionsOnly;
  const searched = input.groups.filter((group) =>
    actionsOnly ? group.Value === "actions" : input.inSubmenu || group.Value !== "recent-threads",
  );
  if (everything) {
    const nested = nestedItems(input.actions, input.query);
    if (nested.length > 0)
      searched.push({ Value: "nested-search", Label: "Suggestions", Items: nested });
    if (input.threads.length > 0)
      searched.push({ Value: "threads-search", Label: "Threads", Items: [...input.threads] });
    if (input.projects.length > 0)
      searched.push({ Value: "projects-search", Label: "Projects", Items: [...input.projects] });
  }
  const ranked = rankSearchGroups(
    searched.map((group) => ({ group, items: group.Items })),
    (item, options) => rankItem(item, query, input.now, options),
  );
  const threadsMatch = ranked.some(({ group }) => group.Value === "threads-search");
  const groups = ranked.map(({ group, ranked: items }): IPaletteGroup => {
    const limit =
      group.Value === "threads-search"
        ? PALETTE_THREAD_LIMIT
        : group.Value === "nested-search" || (everything && threadsMatch)
          ? PALETTE_SECONDARY_LIMIT
          : items.length;
    return {
      Value: group.Value,
      Label: group.Label,
      Items: items
        .toSorted(
          (left, right) =>
            Number(left.item.Secondary ?? false) - Number(right.item.Secondary ?? false),
        )
        .slice(0, limit)
        .map(({ item, match }) => {
          if (match.ranges.length > 0) return { ...item, Ranges: match.ranges };
          const explain: unknown = "explain" in match ? match.explain : undefined;
          const hint =
            typeof explain === "function" ? (explain() as SearchMatchHint | undefined) : undefined;
          return hint ? { ...item, Hint: hint } : item;
        }),
    };
  });
  if (!everything) return groups;
  const listed = new Set(groups.flatMap((group) => group.Items.map((item) => item.Value)));
  const messages = input.messages
    .filter((item) => !listed.has(item.Value))
    .slice(0, PALETTE_MESSAGE_LIMIT);
  return messages.length === 0
    ? groups
    : [...groups, { Value: "threads-messages", Label: "In messages", Items: messages }];
}

export function paletteRows(groups: readonly IPaletteGroup[]): IPaletteItem[] {
  return groups.flatMap((group) => group.Items);
}
