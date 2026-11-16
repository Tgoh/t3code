import type {
  KeybindingCommand,
  KeybindingShortcut,
  KeybindingWhenNode,
  ResolvedKeybindingsConfig,
} from "@t3tools/contracts";
import {
  isMacPlatform,
  matchesKeybindingShortcut,
  type ShortcutEventLike,
} from "@t3tools/shared/keybindings";

export interface IShortcutContext {
  terminalFocus: boolean;
  editableFocus: boolean;
  [key: string]: boolean;
}

const BASE_CONTEXT = { isWeb: true, isDesktop: false };

/** A panel shortcut for the open thread's view, which cancels the event when it handled it. */
export const THREAD_SHORTCUT_EVENT = "reflex-thread-shortcut";

function evaluateWhen(node: KeybindingWhenNode, context: Record<string, boolean>): boolean {
  switch (node.type) {
    case "identifier":
      if (node.name === "true") return true;
      if (node.name === "false") return false;
      return Boolean(context[node.name]);
    case "not":
      return !evaluateWhen(node.node, context);
    case "and":
      return evaluateWhen(node.left, context) && evaluateWhen(node.right, context);
    case "or":
      return evaluateWhen(node.left, context) || evaluateWhen(node.right, context);
  }
}

function conflictKey(shortcut: KeybindingShortcut, platform: string): string {
  const useMetaForMod = isMacPlatform(platform);
  return [
    shortcut.key,
    shortcut.metaKey || (shortcut.modKey && useMetaForMod) ? "meta" : "",
    shortcut.ctrlKey || (shortcut.modKey && !useMetaForMod) ? "ctrl" : "",
    shortcut.shiftKey ? "shift" : "",
    shortcut.altKey ? "alt" : "",
  ].join("|");
}

// Follows resolveShortcutCommand in apps/web/src/keybindings.ts: later rules win.
export function resolveShortcutCommand(
  event: ShortcutEventLike,
  keybindings: ResolvedKeybindingsConfig,
  context: IShortcutContext,
  platform: string,
): KeybindingCommand | null {
  const held = { ...BASE_CONTEXT, ...context };
  for (let index = keybindings.length - 1; index >= 0; index -= 1) {
    const binding = keybindings[index]!;
    if (binding.whenAst !== undefined && !evaluateWhen(binding.whenAst, held)) continue;
    if (matchesKeybindingShortcut(event, binding.shortcut, platform)) return binding.command;
  }
  return null;
}

// Follows effectiveShortcutsForCommand in apps/web/src/keybindings.ts: a shortcut a later rule
// claims for another command isn't this command's.
function shortcutForCommand(
  keybindings: ResolvedKeybindingsConfig,
  command: KeybindingCommand,
  context: Partial<IShortcutContext>,
  platform: string,
): KeybindingShortcut | null {
  const held = { ...BASE_CONTEXT, terminalFocus: false, editableFocus: false, ...context };
  const claimed = new Set<string>();
  for (let index = keybindings.length - 1; index >= 0; index -= 1) {
    const binding = keybindings[index]!;
    if (binding.whenAst !== undefined && !evaluateWhen(binding.whenAst, held)) continue;
    const key = conflictKey(binding.shortcut, platform);
    if (claimed.has(key)) continue;
    claimed.add(key);
    if (binding.command === command) return binding.shortcut;
  }
  return null;
}

// Follows formatShortcutKeyLabel and formatShortcutLabel in apps/web/src/keybindings.ts.
function keyLabel(key: string): string {
  if (key === " ") return "Space";
  if (key.length === 1) return key.toUpperCase();
  if (key === "escape") return "Esc";
  if (key === "arrowup") return "Up";
  if (key === "arrowdown") return "Down";
  if (key === "arrowleft") return "Left";
  if (key === "arrowright") return "Right";
  if (key === "pageup") return "PageUp";
  if (key === "pagedown") return "PageDown";
  return key.slice(0, 1).toUpperCase() + key.slice(1);
}

export function formatShortcutLabel(shortcut: KeybindingShortcut, platform: string): string {
  const label = keyLabel(shortcut.key);
  const useMetaForMod = isMacPlatform(platform);
  const meta = shortcut.metaKey || (shortcut.modKey && useMetaForMod);
  const ctrl = shortcut.ctrlKey || (shortcut.modKey && !useMetaForMod);
  if (useMetaForMod) {
    return `${ctrl ? "⌃" : ""}${shortcut.altKey ? "⌥" : ""}${shortcut.shiftKey ? "⇧" : ""}${meta ? "⌘" : ""}${label}`;
  }
  return [
    ...(ctrl ? ["Ctrl"] : []),
    ...(shortcut.altKey ? ["Alt"] : []),
    ...(shortcut.shiftKey ? ["Shift"] : []),
    ...(meta ? ["Meta"] : []),
    label,
  ].join("+");
}

export function shortcutLabel(
  keybindings: ResolvedKeybindingsConfig,
  command: KeybindingCommand,
  platform: string,
  context: Partial<IShortcutContext> = {},
): string | null {
  const shortcut = shortcutForCommand(keybindings, command, context, platform);
  return shortcut === null ? null : formatShortcutLabel(shortcut, platform);
}

/** A tooltip with the command's shortcut, as stock's `New thread (Ctrl+N)`. */
export function withShortcut(label: string, shortcut: string | null): string {
  return shortcut === null ? label : `${label} (${shortcut})`;
}

// Follows resolveAdjacentThreadId in apps/web/src/components/Sidebar.logic.ts.
export function adjacentThread(
  ordered: readonly string[],
  current: string | null,
  direction: "previous" | "next",
): string | null {
  if (ordered.length === 0) return null;
  if (current === null) return direction === "previous" ? ordered.at(-1)! : ordered[0]!;
  const index = ordered.indexOf(current);
  if (index === -1) return null;
  return ordered[direction === "previous" ? index - 1 : index + 1] ?? null;
}

const EDITABLE_SELECTOR = [
  "input",
  "textarea",
  "select",
  '[contenteditable=""]',
  '[contenteditable="true"]',
  '[contenteditable="plaintext-only"]',
  '[role="textbox"]',
].join(",");

// Follows isEditableFocused in apps/web/src/lib/editableFocus.ts.
export function isEditable(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(EDITABLE_SELECTOR) !== null;
}
