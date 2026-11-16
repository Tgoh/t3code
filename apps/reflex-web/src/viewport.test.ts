import { createRoot, createSignal } from "solid-js";
import { describe, expect, it, vi } from "vite-plus/test";

import { composerCollapses, createMediaQuery, createSidebarSheet, longPress } from "./viewport";

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

describe("longPress", () => {
  const pointer = (pointerType: string, clientX = 10, clientY = 20) =>
    ({ pointerType, clientX, clientY }) as PointerEvent;

  it("opens after a held touch and swallows the click that ends it", () => {
    vi.useFakeTimers();
    try {
      const opened: Array<[number, number]> = [];
      const press = longPress((x, y) => opened.push([x, y]));
      press.onPointerDown(pointer("touch"));
      vi.advanceTimersByTime(499);
      expect(opened).toEqual([]);
      vi.advanceTimersByTime(1);
      expect(opened).toEqual([[10, 20]]);
      press.onPointerUp();
      expect(press.swallowsClick()).toBe(true);
      expect(press.swallowsClick()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores mice, a released tap and a touch that moves", () => {
    vi.useFakeTimers();
    try {
      const opened: unknown[] = [];
      const press = longPress(() => opened.push(true));
      press.onPointerDown(pointer("mouse"));
      vi.advanceTimersByTime(600);
      press.onPointerDown(pointer("touch"));
      press.onPointerUp();
      vi.advanceTimersByTime(600);
      press.onPointerDown(pointer("touch"));
      press.onPointerMove(pointer("touch", 10, 40));
      vi.advanceTimersByTime(600);
      expect(opened).toEqual([]);
      expect(press.swallowsClick()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
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
