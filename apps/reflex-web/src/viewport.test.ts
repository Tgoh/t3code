import { createRoot, createSignal } from "solid-js";
import { describe, expect, it } from "vite-plus/test";

import { composerCollapses, createMediaQuery, createSidebarSheet } from "./viewport";

function fakeMedia(initial: boolean) {
  let listener: (() => void) | undefined;
  const list = {
    matches: initial,
    addEventListener: (_type: string, next: () => void) => {
      listener = next;
    },
    removeEventListener: () => {
      listener = undefined;
    },
  };
  return {
    matchMedia: () => list as unknown as MediaQueryList,
    set: (matches: boolean) => {
      list.matches = matches;
      listener?.();
    },
    listening: () => listener !== undefined,
  };
}

describe("createMediaQuery", () => {
  it("follows the media list and stops listening on disposal", () => {
    const media = fakeMedia(false);
    createRoot((dispose) => {
      const matches = createMediaQuery("(max-width: 767px)", media.matchMedia);
      expect(matches()).toBe(false);
      media.set(true);
      expect(matches()).toBe(true);
      dispose();
    });
    expect(media.listening()).toBe(false);
  });
});

describe("createSidebarSheet", () => {
  it("closes on selection, and leaving the sheet layout forgets it was open", () => {
    createRoot((dispose) => {
      const [sheet, setSheet] = createSignal(true);
      const [selection, setSelection] = createSignal<string | null>(null);
      const sidebar = createSidebarSheet(sheet, selection);
      expect(sidebar.open()).toBe(false);

      sidebar.setOpen(true);
      expect(sidebar.open()).toBe(true);
      setSelection("thread-1");
      expect(sidebar.open()).toBe(false);

      sidebar.setOpen(true);
      setSheet(false);
      expect(sidebar.open()).toBe(false);
      setSheet(true);
      expect(sidebar.open()).toBe(false);
      dispose();
    });
  });
});

describe("composerCollapses", () => {
  const idle = { Phone: true, Focused: false, Draft: "draft", HasAttachments: false };
  it.each([
    ["an idle phone composer", idle, true],
    ["above the phone breakpoint", { ...idle, Phone: false }, false],
    ["while focused", { ...idle, Focused: true }, false],
    ["with a multiline draft", { ...idle, Draft: "one\ntwo" }, false],
    ["with attachments", { ...idle, HasAttachments: true }, false],
  ])("%s", (_label, input, expected) => {
    expect(composerCollapses(input)).toBe(expected);
  });
});
