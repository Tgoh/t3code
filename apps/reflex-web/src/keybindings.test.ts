import type { KeybindingRule } from "@t3tools/contracts";
import {
  compileResolvedKeybindingsConfig,
  DEFAULT_RESOLVED_KEYBINDINGS,
} from "@t3tools/shared/keybindings";
import { describe, expect, it } from "vite-plus/test";

import {
  adjacentThread,
  resolveShortcutCommand,
  shortcutLabel,
  withClientKeybindings,
  withShortcut,
} from "./keybindings";

const WINDOWS = "Win32";
const MAC = "MacIntel";
const idle = { terminalFocus: false, editableFocus: false };

const key = (
  key: string,
  modifiers: Partial<Record<"ctrlKey" | "metaKey" | "shiftKey" | "altKey", boolean>> = {},
) =>
  ({
    key,
    code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...modifiers,
  }) as KeyboardEvent;

describe("resolveShortcutCommand", () => {
  it("dispatches the default palette, sidebar, new thread and thread traversal shortcuts", () => {
    const resolve = (event: KeyboardEvent, platform = WINDOWS) =>
      resolveShortcutCommand(event, DEFAULT_RESOLVED_KEYBINDINGS, idle, platform);
    expect(resolve(key("k", { ctrlKey: true }))).toBe("commandPalette.toggle");
    expect(resolve(key("k", { metaKey: true }), MAC)).toBe("commandPalette.toggle");
    expect(resolve(key("b", { ctrlKey: true }))).toBe("sidebar.toggle");
    expect(resolve(key("o", { ctrlKey: true, shiftKey: true }))).toBe("chat.new");
    expect(resolve(key("n", { ctrlKey: true, shiftKey: true }))).toBe("chat.newLocal");
    expect(resolve(key("]", { ctrlKey: true, shiftKey: true }))).toBe("thread.next");
    expect(resolve(key("[", { ctrlKey: true, shiftKey: true }))).toBe("thread.previous");
    expect(resolve(key("k"))).toBeNull();
  });

  it("renames on F2 from the page or the composer, but not from another field or the terminal", () => {
    const resolve = (context: Record<string, boolean>, rules = DEFAULT_RESOLVED_KEYBINDINGS) =>
      resolveShortcutCommand(
        key("f2"),
        withClientKeybindings(rules),
        { ...idle, ...context },
        WINDOWS,
      );
    expect(resolve({})).toBe("thread.rename");
    expect(resolve({ editableFocus: true, composerFocus: true })).toBe("thread.rename");
    expect(resolve({ editableFocus: true })).toBeNull();
    expect(resolve({ terminalFocus: true })).toBeNull();
    const custom = compileResolvedKeybindingsConfig([{ key: "f2", command: "usage.open" }]);
    expect(resolve({}, custom)).toBe("usage.open");
    expect(
      shortcutLabel(withClientKeybindings(DEFAULT_RESOLVED_KEYBINDINGS), "thread.rename", WINDOWS),
    ).toBe("F2");
  });

  it("honours when clauses, such as the terminal keeping its own keys", () => {
    expect(
      resolveShortcutCommand(
        key("k", { ctrlKey: true }),
        DEFAULT_RESOLVED_KEYBINDINGS,
        { terminalFocus: true, editableFocus: false },
        WINDOWS,
      ),
    ).toBeNull();
  });

  it("lets a user's rule override a default on the same keys", () => {
    const rules: KeybindingRule[] = [
      { key: "mod+k", command: "commandPalette.toggle" },
      { key: "mod+k", command: "sidebar.toggle" },
    ];
    const custom = compileResolvedKeybindingsConfig(rules);
    expect(resolveShortcutCommand(key("k", { ctrlKey: true }), custom, idle, WINDOWS)).toBe(
      "sidebar.toggle",
    );
  });
});

describe("shortcutLabel", () => {
  it("formats per platform, and drops a shortcut a later rule took for another command", () => {
    expect(shortcutLabel(DEFAULT_RESOLVED_KEYBINDINGS, "commandPalette.toggle", WINDOWS)).toBe(
      "Ctrl+K",
    );
    expect(shortcutLabel(DEFAULT_RESOLVED_KEYBINDINGS, "commandPalette.toggle", MAC)).toBe("⌘K");
    expect(shortcutLabel(DEFAULT_RESOLVED_KEYBINDINGS, "chat.newLocal", WINDOWS)).toBe(
      "Ctrl+Shift+N",
    );
    const custom = compileResolvedKeybindingsConfig([
      { key: "mod+k", command: "commandPalette.toggle" },
      { key: "mod+k", command: "sidebar.toggle" },
    ]);
    expect(shortcutLabel(custom, "commandPalette.toggle", WINDOWS)).toBeNull();
    expect(withShortcut("Toggle sidebar", shortcutLabel(custom, "sidebar.toggle", WINDOWS))).toBe(
      "Toggle sidebar (Ctrl+K)",
    );
    expect(withShortcut("New thread", null)).toBe("New thread");
  });
});

describe("adjacentThread", () => {
  const order = ["a", "b", "c"];

  it("steps through the sidebar's order and stops at the ends", () => {
    expect(adjacentThread(order, "b", "next")).toBe("c");
    expect(adjacentThread(order, "b", "previous")).toBe("a");
    expect(adjacentThread(order, "c", "next")).toBeNull();
    expect(adjacentThread(order, "a", "previous")).toBeNull();
  });

  it("starts from an end with nothing selected, and does nothing for a thread not listed", () => {
    expect(adjacentThread(order, null, "next")).toBe("a");
    expect(adjacentThread(order, null, "previous")).toBe("c");
    expect(adjacentThread(order, "z", "next")).toBeNull();
    expect(adjacentThread([], null, "next")).toBeNull();
  });
});
