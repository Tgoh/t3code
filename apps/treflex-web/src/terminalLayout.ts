export type ISplitDirection = "horizontal" | "vertical";

export interface ITerminalGroup {
  Id: string;
  TerminalIds: string[];
  SplitDirection: ISplitDirection;
}

export interface ITerminalLayout {
  TerminalIds: string[];
  Groups: ITerminalGroup[];
  ActiveTerminalId: string;
  ActiveGroupId: string;
}

export const MAX_TERMINALS_PER_GROUP = 4;

export const EMPTY_TERMINAL_LAYOUT: ITerminalLayout = Object.freeze({
  TerminalIds: [],
  Groups: [],
  ActiveTerminalId: "",
  ActiveGroupId: "",
}) as ITerminalLayout;

const groupIdOf = (terminalId: string) => `group-${terminalId}`;

function uniqueGroupId(base: string, used: Set<string>): string {
  let candidate = base;
  for (let index = 2; used.has(candidate); index += 1) candidate = `${base}-${index}`;
  used.add(candidate);
  return candidate;
}

function distinct(ids: readonly string[]): string[] {
  return [...new Set(ids.map((id) => id.trim()).filter((id) => id.length > 0))];
}

/** Follows `normalizeThreadTerminalUiState` in `apps/web/src/terminalUiStateStore.ts`. */
export function normalizeLayout(layout: ITerminalLayout): ITerminalLayout {
  const terminalIds = distinct(layout.TerminalIds);
  if (terminalIds.length === 0) return EMPTY_TERMINAL_LAYOUT;
  const known = new Set(terminalIds);
  const assigned = new Set<string>();
  const used = new Set<string>();
  const groups: ITerminalGroup[] = [];
  for (const group of layout.Groups) {
    const ids = distinct(group.TerminalIds).filter((id) => known.has(id) && !assigned.has(id));
    if (ids.length === 0) continue;
    for (const id of ids) assigned.add(id);
    groups.push({
      Id: uniqueGroupId(group.Id.trim() || groupIdOf(ids[0]!), used),
      TerminalIds: ids,
      SplitDirection: group.SplitDirection === "vertical" ? "vertical" : "horizontal",
    });
  }
  for (const id of terminalIds) {
    if (assigned.has(id)) continue;
    groups.push({
      Id: uniqueGroupId(groupIdOf(id), used),
      TerminalIds: [id],
      SplitDirection: "horizontal",
    });
  }
  const activeTerminalId = known.has(layout.ActiveTerminalId)
    ? layout.ActiveTerminalId
    : terminalIds[0]!;
  const activeGroupId = groups.some((group) => group.Id === layout.ActiveGroupId)
    ? layout.ActiveGroupId
    : (groups.find((group) => group.TerminalIds.includes(activeTerminalId)) ?? groups[0]!).Id;
  return {
    TerminalIds: terminalIds,
    Groups: groups,
    ActiveTerminalId: activeTerminalId,
    ActiveGroupId: activeGroupId,
  };
}

const copyGroups = (groups: readonly ITerminalGroup[]) =>
  groups.map((group) => ({ ...group, TerminalIds: [...group.TerminalIds] }));

/**
 * A new tab, or a split beside the active terminal. A split into a full group changes nothing.
 * Follows `upsertTerminalIntoGroups` in `apps/web/src/terminalUiStateStore.ts`.
 */
export function placeTerminal(
  current: ITerminalLayout,
  terminalId: string,
  mode: "new" | "split",
  direction: ISplitDirection = "horizontal",
): ITerminalLayout {
  const layout = normalizeLayout(current);
  if (terminalId.trim().length === 0) return layout;
  const isNew = !layout.TerminalIds.includes(terminalId);
  const terminalIds = isNew ? [...layout.TerminalIds, terminalId] : layout.TerminalIds;
  const groups = copyGroups(layout.Groups);
  const heldIndex = groups.findIndex((group) => group.TerminalIds.includes(terminalId));
  if (heldIndex >= 0) {
    groups[heldIndex]!.TerminalIds = groups[heldIndex]!.TerminalIds.filter(
      (id) => id !== terminalId,
    );
    if (groups[heldIndex]!.TerminalIds.length === 0) groups.splice(heldIndex, 1);
  }

  if (mode === "new" || layout.TerminalIds.length === 0) {
    const groupId = uniqueGroupId(groupIdOf(terminalId), new Set(groups.map((group) => group.Id)));
    groups.push({ Id: groupId, TerminalIds: [terminalId], SplitDirection: "horizontal" });
    return normalizeLayout({
      TerminalIds: terminalIds,
      Groups: groups,
      ActiveTerminalId: terminalId,
      ActiveGroupId: groupId,
    });
  }

  const target =
    groups.find((group) => group.Id === layout.ActiveGroupId) ??
    groups.find((group) => group.TerminalIds.includes(layout.ActiveTerminalId));
  if (target === undefined) return layout;
  if (!target.TerminalIds.includes(terminalId)) {
    if (isNew && target.TerminalIds.length >= MAX_TERMINALS_PER_GROUP) return layout;
    const anchor = target.TerminalIds.indexOf(layout.ActiveTerminalId);
    if (anchor >= 0) target.TerminalIds.splice(anchor + 1, 0, terminalId);
    else target.TerminalIds.push(terminalId);
  }
  target.SplitDirection = direction;
  return normalizeLayout({
    TerminalIds: terminalIds,
    Groups: groups,
    ActiveTerminalId: terminalId,
    ActiveGroupId: target.Id,
  });
}

/** Follows `setThreadActiveTerminal` in `apps/web/src/terminalUiStateStore.ts`. */
export function activateTerminal(current: ITerminalLayout, terminalId: string): ITerminalLayout {
  const layout = normalizeLayout(current);
  if (!layout.TerminalIds.includes(terminalId)) return layout;
  const group = layout.Groups.find((held) => held.TerminalIds.includes(terminalId));
  return {
    ...layout,
    ActiveTerminalId: terminalId,
    ActiveGroupId: group?.Id ?? layout.ActiveGroupId,
  };
}

/** Follows `closeThreadTerminal` in `apps/web/src/terminalUiStateStore.ts`. */
export function removeTerminal(current: ITerminalLayout, terminalId: string): ITerminalLayout {
  const layout = normalizeLayout(current);
  if (!layout.TerminalIds.includes(terminalId)) return layout;
  const remaining = layout.TerminalIds.filter((id) => id !== terminalId);
  if (remaining.length === 0) return EMPTY_TERMINAL_LAYOUT;
  const closedIndex = layout.TerminalIds.indexOf(terminalId);
  const siblings =
    layout.Groups.find((group) => group.TerminalIds.includes(terminalId))?.TerminalIds ?? [];
  const siblingIndex = siblings.indexOf(terminalId);
  const nextActive =
    layout.ActiveTerminalId === terminalId
      ? (siblings[siblingIndex + 1] ??
        siblings[siblingIndex - 1] ??
        remaining[Math.min(closedIndex, remaining.length - 1)]!)
      : layout.ActiveTerminalId;
  const groups = layout.Groups.map((group) => ({
    ...group,
    TerminalIds: group.TerminalIds.filter((id) => id !== terminalId),
  })).filter((group) => group.TerminalIds.length > 0);
  return normalizeLayout({
    TerminalIds: remaining,
    Groups: groups,
    ActiveTerminalId: nextActive,
    ActiveGroupId: groups.find((group) => group.TerminalIds.includes(nextActive))?.Id ?? "",
  });
}

export function shownGroup(layout: ITerminalLayout): ITerminalGroup | undefined {
  return (
    layout.Groups.find((group) => group.Id === layout.ActiveGroupId) ??
    layout.Groups.find((group) => group.TerminalIds.includes(layout.ActiveTerminalId))
  );
}
