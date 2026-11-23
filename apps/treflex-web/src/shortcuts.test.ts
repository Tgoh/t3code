import type { KeybindingCommand } from "@t3tools/contracts";
import { createRoot, flush } from "solid-js";
import { describe, expect, it } from "vite-plus/test";

import { createOverlayStack } from "./overlays";
import { createKeyDispatcher } from "./shortcuts";

function key(name: string, repeat = false) {
  const event = {
    key: name,
    repeat,
    defaultPrevented: false,
    preventDefault: () => {
      event.defaultPrevented = true;
    },
    stopPropagation: () => {},
  };
  return event;
}

function setup(command: KeybindingCommand | null) {
  const overlays = createOverlayStack();
  const ran: string[] = [];
  const state = { palette: false, sheet: false, composer: true };
  const keys = createKeyDispatcher({
    overlays,
    paletteOpen: () => state.palette,
    resolve: () => command,
    run: (held) => {
      ran.push(held);
      return true;
    },
    closeSheet: () => {
      if (!state.sheet) return false;
      state.sheet = false;
      ran.push("sheet");
      return true;
    },
    typeIntoComposer: (event) => {
      if (!state.composer) return false;
      ran.push(`typed ${event.key}`);
      return true;
    },
  });
  const press = (name: string, repeat = false) => {
    const event = key(name, repeat);
    keys.onKeyDown(event as unknown as KeyboardEvent);
    return event.defaultPrevented;
  };
  return { overlays, ran, state, keys, press };
}

const dialog = { modal: true, close: () => {}, contains: () => false };
const menu = { close: () => {}, contains: () => false };

describe("the key dispatcher", () => {
  it("runs a bound shortcut, and holds it back while a dialog is open", () => {
    createRoot((dispose) => {
      const keys = setup("terminal.toggle");
      expect(keys.press("j")).toBe(true);
      const release = keys.overlays.push(dialog);
      flush();
      expect(keys.press("j")).toBe(false);
      release();
      keys.overlays.push(menu);
      flush();
      expect(keys.press("j")).toBe(true);
      expect(keys.press("j", true)).toBe(true);
      expect(keys.ran).toEqual(["terminal.toggle", "terminal.toggle"]);
      dispose();
    });
  });

  it("lets only the palette's own toggle through while the palette is open", () => {
    createRoot((dispose) => {
      const blocked = setup("terminal.toggle");
      blocked.state.palette = true;
      expect(blocked.press("j")).toBe(false);
      const toggle = setup("commandPalette.toggle");
      toggle.state.palette = true;
      expect(toggle.press("k")).toBe(true);
      dispose();
    });
  });

  it("closes the top overlay on Escape before any sheet", () => {
    createRoot((dispose) => {
      const keys = setup(null);
      keys.state.sheet = true;
      const closed: string[] = [];
      keys.overlays.push({ close: () => closed.push("menu"), contains: () => false });
      flush();
      expect(keys.press("Escape")).toBe(true);
      expect(closed).toEqual(["menu"]);
      expect(keys.state.sheet).toBe(true);
      dispose();
    });
  });

  it("hands plain keys to their taker, else the composer, only while nothing is open over it", () => {
    createRoot((dispose) => {
      const keys = setup(null);
      const taken: string[] = [];
      const release = keys.keys.takeLetters((event) => {
        if (event.key !== "t") return false;
        taken.push(event.key);
        return true;
      });
      expect(keys.press("t")).toBe(true);
      expect(keys.press("x")).toBe(true);
      const close = keys.overlays.push(menu);
      flush();
      expect(keys.press("d")).toBe(false);
      close();
      flush();
      keys.state.palette = true;
      expect(keys.press("d")).toBe(false);
      keys.state.palette = false;
      release();
      expect(keys.press("t")).toBe(true);
      keys.state.composer = false;
      expect(keys.press("d")).toBe(false);
      expect(taken).toEqual(["t"]);
      expect(keys.ran).toEqual(["typed x", "typed t"]);
      dispose();
    });
  });
});
