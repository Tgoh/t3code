import { createRoot, createSignal } from "solid-js";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  composerCollapses,
  composerRequiresModifier,
  createKeyboardDetector,
  createMediaQuery,
  createSidebarSheet,
  enterIsAlternate,
  enterSends,
  longPress,
} from "./viewport";

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

  it("closes when the already selected thread is picked again", () => {
    createRoot((dispose) => {
      const [selection] = createSignal<string | null>("thread-1");
      const sidebar = createSidebarSheet(() => true, selection);
      sidebar.setOpen(true);
      sidebar.choseThread();
      expect(sidebar.open()).toBe(false);
      dispose();
    });
  });

  it("toggles the sheet on a narrow layout and the column's collapse on a wide one", () => {
    createRoot((dispose) => {
      const [sheet, setSheet] = createSignal(false);
      const saved: boolean[] = [];
      const sidebar = createSidebarSheet(sheet, () => null, {
        initial: true,
        onChange: (collapsed) => saved.push(collapsed),
      });
      expect(sidebar.collapsed()).toBe(true);

      sidebar.toggle();
      expect(sidebar.collapsed()).toBe(false);
      sidebar.toggle();
      expect(saved).toEqual([false, true]);

      setSheet(true);
      expect(sidebar.collapsed()).toBe(false);
      sidebar.toggle();
      expect(sidebar.open()).toBe(true);
      expect(saved).toEqual([false, true]);
      setSheet(false);
      expect(sidebar.collapsed()).toBe(true);
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

describe("createKeyboardDetector", () => {
  const phone = { width: 393, height: 760 };
  const keyboardUp = { width: 393, height: 420 };
  it("sees a keyboard that shrinks only the visual viewport", () => {
    const open = createKeyboardDetector(() => true);
    expect(open(phone, 760)).toBe(false);
    expect(open(keyboardUp, 760)).toBe(true);
  });
  it("sees a keyboard that shrinks the layout viewport with it", () => {
    const open = createKeyboardDetector(() => true);
    expect(open(phone, 760)).toBe(false);
    expect(open(keyboardUp, 420)).toBe(true);
    expect(open(phone, 760)).toBe(false);
  });
  it("keeps the keyboard while focus moves between fields", () => {
    const [typing, setTyping] = createSignal(true);
    const open = createKeyboardDetector(typing);
    expect(open(phone, 760)).toBe(false);
    expect(open(keyboardUp, 420)).toBe(true);
    setTyping(false);
    expect(open(keyboardUp, 420)).toBe(true);
    setTyping(true);
    expect(open(keyboardUp, 420)).toBe(true);
    setTyping(false);
    expect(open(phone, 760)).toBe(false);
    expect(open({ width: 393, height: 380 }, 380)).toBe(false);
  });
  it("takes a rotation for a new height, not a keyboard", () => {
    const open = createKeyboardDetector(() => true);
    expect(open(phone, 760)).toBe(false);
    expect(open({ width: 852, height: 340 }, 340)).toBe(false);
  });
  it("takes a window made shorter, with nothing focused to type in, for a window", () => {
    const [typing, setTyping] = createSignal(false);
    const open = createKeyboardDetector(typing);
    expect(open(phone, 760)).toBe(false);
    expect(open({ width: 393, height: 380 }, 380)).toBe(false);
    setTyping(true);
    expect(open({ width: 393, height: 380 }, 380)).toBe(false);
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

describe("enterSends", () => {
  const enter = {
    key: "Enter",
    shiftKey: false,
    isComposing: false,
    metaKey: false,
    ctrlKey: false,
  };
  it.each([
    ["Enter with a fine pointer", enter, false, true],
    ["Shift+Enter with a fine pointer", { ...enter, shiftKey: true }, false, false],
    ["Enter while composing", { ...enter, isComposing: true }, false, false],
    ["another key", { ...enter, key: "a" }, false, false],
    ["Enter on a touch screen", enter, true, false],
    ["Cmd+Enter on a touch screen", { ...enter, metaKey: true }, true, true],
    ["Ctrl+Enter on a touch screen", { ...enter, ctrlKey: true }, true, true],
    ["Shift+Cmd+Enter on a touch screen", { ...enter, shiftKey: true, metaKey: true }, true, false],
  ])("%s", (_label, event, coarse, expected) => {
    expect(enterSends(event, coarse)).toBe(expected);
  });

  const shiftCtrl = { ...enter, ctrlKey: true, shiftKey: true };
  it.each([
    ["Enter when Ctrl+Enter always sends", enter, "mod-enter", "x", false, false],
    [
      "Ctrl+Enter when Ctrl+Enter always sends",
      { ...enter, ctrlKey: true },
      "mod-enter",
      "x",
      false,
      true,
    ],
    [
      "Shift+Ctrl+Enter during a turn when Ctrl+Enter always sends",
      shiftCtrl,
      "mod-enter",
      "x",
      true,
      true,
    ],
    [
      "Shift+Ctrl+Enter between turns when Ctrl+Enter always sends",
      shiftCtrl,
      "mod-enter",
      "x",
      false,
      false,
    ],
    ["Enter on one line, multiline mode", enter, "mod-enter-multiline", "x", false, true],
    ["Enter on two lines, multiline mode", enter, "mod-enter-multiline", "x\ny", false, false],
    [
      "Cmd+Enter on two lines, multiline mode",
      { ...enter, metaKey: true },
      "mod-enter-multiline",
      "x\ny",
      false,
      true,
    ],
  ] as const)("%s", (_label, event, shortcut, prompt, running, expected) => {
    const requiresModifier = composerRequiresModifier(shortcut, prompt);
    expect(enterSends(event, false, requiresModifier, running)).toBe(expected);
  });
});

describe("enterIsAlternate", () => {
  const enter = { key: "Enter", shiftKey: false, metaKey: false, ctrlKey: true };
  it.each([
    ["Ctrl+Enter", enter, false, true],
    ["Ctrl+Enter when a modifier sends", enter, true, false],
    ["Shift+Ctrl+Enter when a modifier sends", { ...enter, shiftKey: true }, true, true],
  ])("%s", (_label, event, requiresModifier, expected) => {
    expect(enterIsAlternate(event, requiresModifier, false)).toBe(expected);
  });
});
