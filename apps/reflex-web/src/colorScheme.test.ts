// @effect-diagnostics-next-line nodeBuiltinImport:off -- reads source files, outside any Effect runtime.
import * as NodeFS from "node:fs";
import { describe, expect, it } from "vite-plus/test";

import { SCHEME_BACKGROUND, SYSTEM_DARK_QUERY } from "./colorScheme";
import { APPEARANCE_MODE_KEY } from "./Infrastructure/preferences";

describe("index.html's boot script", () => {
  const html = NodeFS.readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const styles = NodeFS.readFileSync(new URL("./styles.css", import.meta.url), "utf8");

  it("reads the appearance mode the app stores", () => {
    expect(html).toContain(`"${APPEARANCE_MODE_KEY}"`);
    expect(html).toContain(`matchMedia("${SYSTEM_DARK_QUERY}")`);
  });

  it("paints the backgrounds the app's tokens use", () => {
    for (const color of Object.values(SCHEME_BACKGROUND)) expect(html).toContain(color);
    expect(styles).toMatch(/\[data-theme="dark"\] \{[^}]*--background: #000;/);
    expect(styles).toContain("--background: var(--zinc-25);");
    expect(styles).toContain("--zinc-25: oklch(99.2% 0 0);");
  });
});
