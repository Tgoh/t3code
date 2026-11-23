export type ISurfaceKind =
  | "browser"
  | "terminal"
  | "files"
  | "diff"
  | "pullRequest"
  | "pullRequests"
  | "device"
  | "sideChat";

export interface ISurfaceAction {
  Kind: ISurfaceKind;
  Label: string;
  Shortcut: string;
  /** Null when the surface can open now. */
  Unavailable: string | null;
}

const NOT_HERE_YET = "Not in this client yet.";

/** Follows RightPanelEmptyState in apps/web/src/components/RightPanelTabs.tsx. */
export function surfaceActions(input: {
  TerminalAvailable: boolean;
  DiffAvailable: boolean;
  SideChatAvailable: boolean;
}): ISurfaceAction[] {
  return [
    {
      Kind: "browser",
      Label: "Browser",
      Shortcut: "B",
      Unavailable: "Only available in the desktop app.",
    },
    {
      Kind: "terminal",
      Label: "Terminal",
      Shortcut: "T",
      Unavailable: input.TerminalAvailable ? null : "Available when a project is open.",
    },
    { Kind: "files", Label: "Files", Shortcut: "F", Unavailable: NOT_HERE_YET },
    {
      Kind: "diff",
      Label: "Diff",
      Shortcut: "D",
      Unavailable: input.DiffAvailable ? null : "Available for Git repositories.",
    },
    { Kind: "pullRequest", Label: "Pull request", Shortcut: "P", Unavailable: NOT_HERE_YET },
    {
      Kind: "pullRequests",
      Label: "Linked pull requests",
      Shortcut: "L",
      Unavailable: NOT_HERE_YET,
    },
    { Kind: "device", Label: "Device", Shortcut: "M", Unavailable: NOT_HERE_YET },
    {
      Kind: "sideChat",
      Label: "Side chat",
      Shortcut: "S",
      Unavailable: input.SideChatAvailable ? null : "Not available in a side chat or subagent.",
    },
  ];
}

/** Follows surfaceShortcutActionForKey and surfaceShortcutTargetsTypingContext in RightPanelTabs.tsx. */
export function shortcutAction(
  actions: readonly ISurfaceAction[],
  event: Pick<
    KeyboardEvent,
    "key" | "defaultPrevented" | "isComposing" | "metaKey" | "ctrlKey" | "altKey"
  >,
  target: { closest(selectors: string): unknown } | null,
): ISurfaceAction | null {
  if (event.defaultPrevented || event.isComposing) return null;
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  if (
    target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])') !=
    null
  )
    return null;
  const key = event.key.toLowerCase();
  return (
    actions.find(
      (action) => action.Unavailable === null && action.Shortcut.toLowerCase() === key,
    ) ?? null
  );
}
