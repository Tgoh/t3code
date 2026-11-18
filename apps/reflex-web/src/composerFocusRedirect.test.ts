import { describe, expect, it } from "vite-plus/test";

import {
  pasteTextToFocusComposer,
  shouldRedirectInputToComposer,
  shouldTypeToFocusComposer,
} from "./composerFocusRedirect";

/** An element that matches the selectors naming its tag or attributes, as `closest` would. */
function element(tag: string, attributes: Record<string, string> = {}) {
  return {
    closest: (selector: string) =>
      selector
        .split(",")
        .some(
          (part) =>
            part === tag ||
            Object.entries(attributes).some(([name, value]) => part === `[${name}="${value}"]`) ||
            (part === "a[href]" && tag === "a" && "href" in attributes),
        )
        ? {}
        : null,
    getAttribute: (name: string) => attributes[name] ?? null,
  };
}

const body = element("body");

function keydown(
  key: string,
  path: unknown[] = [body],
  modifiers: Partial<
    Record<"ctrlKey" | "metaKey" | "altKey" | "shiftKey" | "isComposing", boolean>
  > = {},
) {
  return {
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    isComposing: false,
    defaultPrevented: false,
    target: path[0],
    composedPath: () => [...path],
    ...modifiers,
  } as unknown as KeyboardEvent;
}

function paste(text: string, files = 0, path: unknown[] = [body]) {
  return {
    defaultPrevented: false,
    target: path[0],
    composedPath: () => [...path],
    clipboardData: { files: { length: files }, getData: () => text },
  } as unknown as ClipboardEvent;
}

describe("type-to-focus", () => {
  it("takes a printable key pressed outside any field, shifted or not", () => {
    expect(shouldTypeToFocusComposer(keydown("h"))).toBe(true);
    expect(shouldTypeToFocusComposer(keydown("H", [body], { shiftKey: true }))).toBe(true);
    expect(shouldTypeToFocusComposer(keydown("?"))).toBe(true);
  });

  it("leaves chords, named keys and IME composition alone", () => {
    expect(shouldTypeToFocusComposer(keydown("k", [body], { ctrlKey: true }))).toBe(false);
    expect(shouldTypeToFocusComposer(keydown("k", [body], { metaKey: true }))).toBe(false);
    expect(shouldTypeToFocusComposer(keydown("k", [body], { altKey: true }))).toBe(false);
    expect(shouldTypeToFocusComposer(keydown("Enter"))).toBe(false);
    expect(shouldTypeToFocusComposer(keydown("F2"))).toBe(false);
    expect(shouldTypeToFocusComposer(keydown("a", [body], { isComposing: true }))).toBe(false);
  });

  it("leaves keys aimed at fields and controls, or already handled, alone", () => {
    for (const target of [
      element("input"),
      element("textarea"),
      element("div", { contenteditable: "true" }),
      element("div", { role: "textbox" }),
      element("button"),
      element("a", { href: "#" }),
      element("div", { role: "menuitem" }),
      element("div", { role: "tab" }),
    ]) {
      expect(shouldTypeToFocusComposer(keydown("a", [target, body]))).toBe(false);
    }
    const handled = keydown("a");
    (handled as { defaultPrevented: boolean }).defaultPrevented = true;
    expect(shouldTypeToFocusComposer(handled)).toBe(false);
  });

  it("leaves a key claimed by aria-keyshortcuts unless it's shifted", () => {
    const claimed = element("div", { "aria-keyshortcuts": "J K" });
    expect(shouldTypeToFocusComposer(keydown("j", [claimed, body]))).toBe(false);
    expect(shouldTypeToFocusComposer(keydown("x", [claimed, body]))).toBe(true);
    expect(shouldTypeToFocusComposer(keydown("J", [claimed, body], { shiftKey: true }))).toBe(true);
  });
});

describe("paste-to-focus", () => {
  it("takes pasted text outside any field, and leaves files and fields alone", () => {
    expect(pasteTextToFocusComposer(paste("hello"))).toBe("hello");
    expect(pasteTextToFocusComposer(paste(""))).toBeNull();
    expect(pasteTextToFocusComposer(paste("hello", 1))).toBeNull();
    expect(pasteTextToFocusComposer(paste("hello", 0, [element("input"), body]))).toBeNull();
    expect(shouldRedirectInputToComposer(paste("hello", 0, [element("button"), body]))).toBe(false);
  });
});
