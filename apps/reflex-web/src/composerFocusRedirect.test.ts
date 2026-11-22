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
const button = element("button");
const link = element("a", { href: "#" });
const threadRow = element("div", { role: "button" });

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

const types = (event: KeyboardEvent, covered = false) => shouldTypeToFocusComposer(event, covered);

describe("type-to-focus", () => {
  it("takes a printable key pressed outside any field, shifted or not", () => {
    expect(types(keydown("h"))).toBe(true);
    expect(types(keydown("H", [body], { shiftKey: true }))).toBe(true);
    expect(types(keydown("?"))).toBe(true);
    expect(types(keydown(" "))).toBe(true);
  });

  it("takes a printable key typed on a button or a link", () => {
    for (const target of [button, link, threadRow]) {
      expect(types(keydown("h", [target, body]))).toBe(true);
      expect(types(keydown("H", [target, body], { shiftKey: true }))).toBe(true);
    }
  });

  it("leaves Space and Enter with a focused button or link", () => {
    for (const target of [button, link, threadRow]) {
      expect(types(keydown(" ", [target, body]))).toBe(false);
      expect(types(keydown("Enter", [target, body]))).toBe(false);
    }
  });

  it("leaves keys aimed at fields alone", () => {
    for (const target of [
      element("input"),
      element("textarea"),
      element("div", { contenteditable: "true" }),
      element("div", { role: "textbox" }),
    ]) {
      expect(types(keydown("a", [target, body]))).toBe(false);
    }
  });

  it("leaves keys alone while a layer covers the composer", () => {
    expect(types(keydown("a"), true)).toBe(false);
    expect(types(keydown("a", [button, body]), true)).toBe(false);
  });

  it("leaves keys with modifiers alone", () => {
    for (const target of [body, button]) {
      expect(types(keydown("k", [target, body], { ctrlKey: true }))).toBe(false);
      expect(types(keydown("k", [target, body], { metaKey: true }))).toBe(false);
      expect(types(keydown("k", [target, body], { altKey: true }))).toBe(false);
    }
  });

  it("leaves a key claimed by aria-keyshortcuts unless it's shifted", () => {
    const claimed = element("div", { "aria-keyshortcuts": "J K" });
    expect(types(keydown("j", [claimed, body]))).toBe(false);
    expect(types(keydown("j", [button, claimed, body]))).toBe(false);
    expect(types(keydown("x", [claimed, body]))).toBe(true);
    expect(types(keydown("J", [claimed, body], { shiftKey: true }))).toBe(true);
  });

  it("leaves named keys, IME composition, other controls and handled keys alone", () => {
    expect(types(keydown("Enter"))).toBe(false);
    expect(types(keydown("F2"))).toBe(false);
    expect(types(keydown("a", [body], { isComposing: true }))).toBe(false);
    for (const target of [element("div", { role: "menuitem" }), element("div", { role: "tab" })]) {
      expect(types(keydown("a", [target, body]))).toBe(false);
    }
    const handled = keydown("a", [button, body]);
    (handled as { defaultPrevented: boolean }).defaultPrevented = true;
    expect(types(handled)).toBe(false);
  });
});

describe("paste-to-focus", () => {
  it("takes pasted text outside any field, and leaves files, fields and controls alone", () => {
    expect(pasteTextToFocusComposer(paste("hello"))).toBe("hello");
    expect(pasteTextToFocusComposer(paste(""))).toBeNull();
    expect(pasteTextToFocusComposer(paste("hello", 1))).toBeNull();
    expect(pasteTextToFocusComposer(paste("hello", 0, [element("input"), body]))).toBeNull();
    expect(shouldRedirectInputToComposer(paste("hello", 0, [button, body]))).toBe(false);
  });
});
