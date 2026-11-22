import { describe, expect, it } from "vite-plus/test";

import { dragSidebarWidth, shownSidebarWidth } from "./sidebarWidth";

describe("the sidebar's width", () => {
  it("shows the stored width or the default, within the bounds the viewport leaves", () => {
    expect(shownSidebarWidth(null, 1600)).toBe(256);
    expect(shownSidebarWidth(400, 1600)).toBe(400);
    expect(shownSidebarWidth(100, 1600)).toBe(208);
    expect(shownSidebarWidth(900, 1200)).toBe(560);
    expect(shownSidebarWidth(null, 800)).toBe(208);
  });

  it("drags within the bounds, and refuses a step that squeezes the main content", () => {
    const drag = (Current: number, Next: number, LayoutWidth = 1600) =>
      dragSidebarWidth({ Current, Next, ViewportWidth: 1600, LayoutWidth });
    expect(drag(256, 300)).toBe(300);
    expect(drag(256, 120)).toBe(208);
    expect(drag(256, 2000)).toBe(960);
    expect(drag(300, 500, 1000)).toBe(300);
    expect(drag(500, 400, 1000)).toBe(400);
  });
});
