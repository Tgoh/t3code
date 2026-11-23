import { createRoot, flush } from "solid-js";
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

function mountStack() {
  return createRoot((dispose) => ({ stack: createOverlayStack(), dispose }));
}

describe("the overlay stack", () => {
  it("closes only the top one on Escape, and says when nothing was open", () => {
    const { stack, dispose } = mountStack();
    const closed: string[] = [];
    expect(stack.escape()).toBe(false);
    const releaseDialog = stack.push(overlay([], closed, "dialog", true));
    const releaseMenu = stack.push(overlay([], closed, "menu"));
    flush();
    expect(stack.escape()).toBe(true);
    expect(closed).toEqual(["menu:escape"]);
    releaseMenu();
    flush();
    stack.escape();
    expect(closed).toEqual(["menu:escape", "dialog:escape"]);
    releaseDialog();
    flush();
    expect(stack.open()).toBe(false);
    dispose();
  });

  it("closes what a press lands outside, down to the one holding it", () => {
    const { stack, dispose } = mountStack();
    const closed: string[] = [];
    const inPopover = node();
    stack.push(overlay([inPopover], closed, "popover"));
    stack.push(overlay([], closed, "menu"));
    flush();
    stack.press(inPopover);
    expect(closed).toEqual(["menu:outside"]);
    stack.press(node());
    expect(closed).toEqual(["menu:outside", "menu:outside", "popover:outside"]);
    const backdrop = node();
    stack.push({
      ...overlay([], closed, "modal menu"),
      backdrop: (target) => target === backdrop,
    });
    flush();
    stack.press(backdrop);
    expect(closed.slice(3)).toEqual(["modal menu:outside"]);
    dispose();
  });

  it("lets a press outside a dialog close nothing under it, and reports it as modal", () => {
    const { stack, dispose } = mountStack();
    const closed: string[] = [];
    stack.push(overlay([], closed, "popover"));
    flush();
    expect(stack.modal()).toBe(false);
    stack.push(overlay([], closed, "dialog", true));
    flush();
    expect(stack.modal()).toBe(true);
    stack.press(node());
    expect(closed).toEqual([]);
    dispose();
  });
});
