import { describe, expect, it } from "vite-plus/test";

import { keybindingsWarnings } from "./keybindingsWarning";

const issues = (messages: readonly string[]) =>
  messages.map((message, index) => ({ kind: "keybindings.invalid-entry", message, index }));

describe("invalid keybindings warning", () => {
  it("warns once when a save and the file watcher report the same issue", () => {
    let now = 0;
    const warn = keybindingsWarnings(() => now);

    expect(warn(issues(["unknown command"]))).toBe("unknown command");
    now = 100;
    expect(warn(issues(["unknown command"]))).toBeNull();

    now = 200;
    expect(warn(issues(["bad shortcut"]))).toBe("bad shortcut");

    now = 5_000;
    expect(warn(issues(["bad shortcut"]))).toBe("bad shortcut");
    now = 5_100;
    expect(warn(issues([]))).toBeNull();
    now = 5_200;
    expect(warn(issues(["bad shortcut"]))).toBe("bad shortcut");
  });

  it("ignores issues that aren't the keybindings'", () => {
    const warn = keybindingsWarnings(() => 0);
    expect(warn([{ kind: "settings.malformed-config", message: "bad settings" }])).toBeNull();
  });
});
