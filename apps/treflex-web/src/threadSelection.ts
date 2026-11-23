// Follows useThreadSelectionStore in apps/web/src/threadSelectionStore.ts.

export interface IThreadSelection {
  Ids: ReadonlySet<string>;
  Anchor: string | null;
}

export const EMPTY_SELECTION: IThreadSelection = { Ids: new Set(), Anchor: null };

export function toggleSelected(selection: IThreadSelection, threadId: string): IThreadSelection {
  const ids = new Set(selection.Ids);
  if (ids.has(threadId)) ids.delete(threadId);
  else ids.add(threadId);
  return { Ids: ids, Anchor: ids.has(threadId) ? threadId : selection.Anchor };
}

/** Adds the rows from the anchor to `threadId` in the sidebar's `order`. */
export function rangeSelectTo(
  selection: IThreadSelection,
  threadId: string,
  order: readonly string[],
): IThreadSelection {
  const ids = new Set(selection.Ids);
  const from = selection.Anchor === null ? -1 : order.indexOf(selection.Anchor);
  const to = order.indexOf(threadId);
  if (from === -1 || to === -1) {
    ids.add(threadId);
    return { Ids: ids, Anchor: threadId };
  }
  for (const id of order.slice(Math.min(from, to), Math.max(from, to) + 1)) ids.add(id);
  return { Ids: ids, Anchor: selection.Anchor };
}

export function keepSelected(
  selection: IThreadSelection,
  keep: (threadId: string) => boolean,
): IThreadSelection {
  const ids = [...selection.Ids].filter(keep);
  if (ids.length === selection.Ids.size) return selection;
  const anchor = selection.Anchor !== null && keep(selection.Anchor) ? selection.Anchor : null;
  return { Ids: new Set(ids), Anchor: anchor };
}
