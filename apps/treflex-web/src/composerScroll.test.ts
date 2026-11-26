import { describe, expect, it } from "vite-plus/test";

import { composerScrollKey, type IComposerEditor, type IComposerKey } from "./composerScroll";

const press = (Key: string, modifiers: Partial<IComposerKey> = {}): IComposerKey => ({
  Key,
  Alt: false,
  Ctrl: false,
  Meta: false,
  Shift: false,
  Composing: false,
  KeyCode: 0,
  DefaultPrevented: false,
  ...modifiers,
});

const editor = (overrides: Partial<IComposerEditor> = {}): IComposerEditor => ({
  Text: "hello",
  SelectionStart: 5,
  SelectionEnd: 5,
  ScrollTop: 0,
  ScrollHeight: 60,
  ClientHeight: 60,
  ...overrides,
});

describe("composerScrollKey", () => {
  it("passes Page keys through when the editor can't scroll that way", () => {
    expect(composerScrollKey(press("PageUp"), editor())).toBe("PageUp");
    expect(composerScrollKey(press("PageDown"), editor())).toBe("PageDown");
    const overflowing = { ScrollHeight: 300, ClientHeight: 100 };
    expect(composerScrollKey(press("PageUp"), editor({ ...overflowing, ScrollTop: 0 }))).toBe(
      "PageUp",
    );
    expect(composerScrollKey(press("PageDown"), editor({ ...overflowing, ScrollTop: 0 }))).toBe(
      null,
    );
    expect(composerScrollKey(press("PageUp"), editor({ ...overflowing, ScrollTop: 50 }))).toBe(
      null,
    );
    expect(composerScrollKey(press("PageDown"), editor({ ...overflowing, ScrollTop: 199.5 }))).toBe(
      "PageDown",
    );
  });

  it("leaves modified, composing and handled Page keys to the editor", () => {
    for (const modifiers of [
      { Alt: true },
      { Ctrl: true },
      { Meta: true },
      { Shift: true },
      { Composing: true },
      { KeyCode: 229 },
      { DefaultPrevented: true },
    ]) {
      expect(composerScrollKey(press("PageDown", modifiers), editor())).toBe(null);
    }
  });

  it("jumps on Ctrl+Home and Ctrl+End only from that edge of the text with no selection", () => {
    expect(composerScrollKey(press("End", { Ctrl: true }), editor())).toBe("End");
    expect(composerScrollKey(press("Home", { Ctrl: true }), editor())).toBe(null);
    const atStart = editor({ SelectionStart: 0, SelectionEnd: 0 });
    expect(composerScrollKey(press("Home", { Ctrl: true }), atStart)).toBe("Home");
    expect(composerScrollKey(press("End", { Ctrl: true }), atStart)).toBe(null);
    const selected = editor({ SelectionStart: 0, SelectionEnd: 5 });
    expect(composerScrollKey(press("Home", { Ctrl: true }), selected)).toBe(null);
    expect(composerScrollKey(press("End", { Ctrl: true }), selected)).toBe(null);
    const empty = editor({ Text: "", SelectionStart: 0, SelectionEnd: 0 });
    expect(composerScrollKey(press("Home", { Ctrl: true }), empty)).toBe("Home");
    expect(composerScrollKey(press("End", { Ctrl: true }), empty)).toBe("End");
  });

  it("leaves plain and other-modified Home and End to the editor", () => {
    expect(composerScrollKey(press("End"), editor())).toBe(null);
    expect(composerScrollKey(press("End", { Ctrl: true, Shift: true }), editor())).toBe(null);
    expect(composerScrollKey(press("End", { Ctrl: true, Alt: true }), editor())).toBe(null);
    expect(composerScrollKey(press("ArrowDown"), editor())).toBe(null);
  });
});
