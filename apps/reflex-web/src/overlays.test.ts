import { createRoot } from "solid-js";
import { describe, expect, it } from "vite-plus/test";

import { createOverlayStack, type ICloseReason, type IOverlay } from "./overlays";

const node = () => ({}) as Node;

function overlay(owned: Node[], closed: string[], name: string, modal = false): IOverlay {
  return {
    modal,
    close: (reason: ICloseReason) => closed.push(`${name}:${reason}`),
    contains: (target) => owned.includes(target),
  };
}

describe("the overlay stack", () => {
  it("closes only the top one on Escape, and says when nothing was open", () => {
    createRoot((dispose) => {
      const stack = createOverlayStack();
      const closed: string[] = [];
      expect(stack.escape()).toBe(false);
      const releaseDialog = stack.push(overlay([], closed, "dialog", true));
      const releaseMenu = stack.push(overlay([], closed, "menu"));
      expect(stack.escape()).toBe(true);
      expect(closed).toEqual(["menu:escape"]);
      releaseMenu();
      stack.escape();
      expect(closed).toEqual(["menu:escape", "dialog:escape"]);
      releaseDialog();
      expect(stack.open()).toBe(false);
      dispose();
    });
  });

  it("closes what a press lands outside, down to the one holding it", () => {
    createRoot((dispose) => {
      const stack = createOverlayStack();
      const closed: string[] = [];
      const inPopover = node();
      stack.push(overlay([inPopover], closed, "popover"));
      stack.push(overlay([], closed, "menu"));
      stack.press(inPopover);
      expect(closed).toEqual(["menu:outside"]);
      stack.press(node());
      expect(closed).toEqual(["menu:outside", "menu:outside", "popover:outside"]);
      dispose();
    });
  });

  it("lets a press outside a dialog close nothing under it, and reports it as modal", () => {
    createRoot((dispose) => {
      const stack = createOverlayStack();
      const closed: string[] = [];
      stack.push(overlay([], closed, "popover"));
      expect(stack.modal()).toBe(false);
      stack.push(overlay([], closed, "dialog", true));
      expect(stack.modal()).toBe(true);
      stack.press(node());
      expect(closed).toEqual([]);
      dispose();
    });
  });
});
