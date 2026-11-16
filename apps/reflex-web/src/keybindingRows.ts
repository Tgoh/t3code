import type {
  KeybindingShortcut,
  KeybindingWhenNode,
  ResolvedKeybindingsConfig,
} from "@t3tools/contracts";
import {
  DEFAULT_RESOLVED_KEYBINDINGS,
  mergeWithDefaultKeybindings,
} from "@t3tools/shared/keybindings";

// Follows apps/web/src/components/settings/KeybindingsSettings.logic.ts, read-only.

export interface IKeybindingRow {
  Id: string;
  Command: string;
  Label: string;
  Key: string;
  When: string;
  Source: "Default" | "Custom" | "Project";
}

export interface IKeybindingGroup {
  Title: string;
  Rows: IKeybindingRow[];
}

const USAGE_LABELS: Record<string, string> = {
  "usage.cost": "Usage: Cost",
  "usage.tokens": "Usage: Tokens",
  "usage.limits": "Usage: Limits",
  "usage.period.day": "Usage: Period: Past 24h",
  "usage.period.week": "Usage: Period: 7 days",
  "usage.period.month": "Usage: Period: 30 days",
  "usage.period.quarter": "Usage: Period: 90 days",
};

const USAGE_ORDER = ["usage.open", ...Object.keys(USAGE_LABELS)];

const FIXED_LABELS: Record<string, string> = {
  "workspace.focusNext": "Focus Next Workspace Area",
  "workspace.focusPrevious": "Focus Previous Workspace Area",
  "composer.sendAlternate": "Composer: Opposite Queue or Steer Action",
  "composer.sendBackground": "Composer: Start in Background",
  "composer.sendAndNewThread": "Composer: Send and Start New Thread",
  "composer.dictation": "Composer: Start or Finish Dictation",
  "thread.steerQueuedMessage": "Queue: Send First Queued Message",
  "thread.editQueuedMessage": "Queue: Edit Last Queued Message",
  "thread.copyReference": "Pull Request: Copy Link or Thread",
  "view.reopenClosed": "Reopen Closed Tab",
  "preview.focusUrl": "Preview: Focus URL",
  "preview.find": "Preview: Find on Page",
  ...USAGE_LABELS,
};

const GROUPS = [
  {
    Title: "Navigation",
    Prefixes: ["sidebar", "rightPanel", "commandPalette", "filePicker", "projectSearch", "editor"],
  },
  { Title: "Threads", Prefixes: ["thread", "chat", "pullRequest"] },
  { Title: "Composer", Prefixes: ["composer", "modelPicker"] },
  { Title: "Terminal", Prefixes: ["terminal"] },
  { Title: "Preview & diff", Prefixes: ["preview", "diff"] },
  { Title: "Appearance", Prefixes: ["theme", "appearance", "themeEditor"] },
  { Title: "Project scripts", Prefixes: ["script"] },
];

function titleCase(segment: string): string {
  return segment
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[-_\s]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

export function commandLabel(command: string): string {
  const fixed = FIXED_LABELS[command];
  if (fixed !== undefined) return fixed;
  if (command.startsWith("script.") && command.endsWith(".run")) {
    return `Run Script: ${titleCase(command.slice("script.".length, -".run".length))}`;
  }
  return command.split(".").map(titleCase).join(": ");
}

export function shortcutText(shortcut: KeybindingShortcut): string {
  const parts: string[] = [];
  if (shortcut.modKey) parts.push("mod");
  if (shortcut.metaKey) parts.push("meta");
  if (shortcut.ctrlKey) parts.push("ctrl");
  if (shortcut.altKey) parts.push("alt");
  if (shortcut.shiftKey) parts.push("shift");
  parts.push(shortcut.key === " " ? "space" : shortcut.key === "escape" ? "esc" : shortcut.key);
  return parts.join("+");
}

function whenText(node: KeybindingWhenNode | undefined): string {
  if (!node) return "";
  const wrap = (inner: KeybindingWhenNode) =>
    inner.type === "identifier" || inner.type === "not" ? whenText(inner) : `(${whenText(inner)})`;
  switch (node.type) {
    case "identifier":
      return node.name;
    case "not":
      return `!${wrap(node.node)}`;
    case "and":
      return `${wrap(node.left)} && ${wrap(node.right)}`;
    case "or":
      return `${wrap(node.left)} || ${wrap(node.right)}`;
  }
}

const DEFAULT_IDS = new Set(
  DEFAULT_RESOLVED_KEYBINDINGS.map(
    (binding) =>
      `${binding.command}\0${shortcutText(binding.shortcut)}\0${whenText(binding.whenAst)}`,
  ),
);

function compareCommands(left: string, right: string): number {
  const leftRank = USAGE_ORDER.indexOf(left);
  const rightRank = USAGE_ORDER.indexOf(right);
  if (leftRank !== -1 && rightRank !== -1) return leftRank - rightRank;
  return (leftRank === -1 ? left : "usage.cost").localeCompare(
    rightRank === -1 ? right : "usage.cost",
  );
}

export function keybindingGroups(keybindings: ResolvedKeybindingsConfig): IKeybindingGroup[] {
  const rows = new Map<string, IKeybindingRow>();
  for (const binding of mergeWithDefaultKeybindings(keybindings)) {
    const key = shortcutText(binding.shortcut);
    const when = whenText(binding.whenAst);
    const id = `${binding.command}\0${key}\0${when}`;
    const command = String(binding.command);
    rows.set(id, {
      Id: id,
      Command: command,
      Label: commandLabel(command),
      Key: key,
      When: when,
      Source: command.startsWith("script.")
        ? "Project"
        : DEFAULT_IDS.has(id)
          ? "Default"
          : "Custom",
    });
  }
  const sorted = [...rows.values()].sort(
    (left, right) =>
      compareCommands(left.Command, right.Command) || left.Key.localeCompare(right.Key),
  );
  const groups = [
    ...GROUPS.map((group) => ({ ...group, Rows: [] as IKeybindingRow[] })),
    {
      Title: "Other",
      Prefixes: [] as string[],
      Rows: [] as IKeybindingRow[],
    },
  ];
  for (const row of sorted) {
    const prefix = row.Command.split(".")[0] ?? "";
    (groups.find((group) => group.Prefixes.includes(prefix)) ?? groups.at(-1)!).Rows.push(row);
  }
  return groups
    .filter((group) => group.Rows.length > 0)
    .map((group) => ({ Title: group.Title, Rows: group.Rows }));
}

const isMac = () => navigator.platform.toLowerCase().includes("mac");

/** The key caps stock's KeybindingPill draws for one shortcut. */
export function keyCaps(key: string): string[] {
  return key.split("+").map((part) => {
    if (part === "mod") return isMac() ? "⌘" : "Ctrl";
    if (part === "shift") return "⇧";
    if (part === "alt") return isMac() ? "⌥" : "Alt";
    if (part === "ctrl") return "⌃";
    return part.length === 1 ? part.toUpperCase() : part;
  });
}
