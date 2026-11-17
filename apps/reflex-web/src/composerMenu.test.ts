import type { ServerProviderSkill, ServerProviderSlashCommand } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  applyMenuItem,
  fileItems,
  type IMenuTrigger,
  menuTrigger,
  skillItems,
  slashItems,
} from "./composerMenu";

const skill = (name: string, extra: Partial<ServerProviderSkill> = {}) =>
  ({ name, path: `/skills/${name}`, enabled: true, ...extra }) as ServerProviderSkill;
const command = (name: string, description?: string) =>
  ({ name, ...(description === undefined ? {} : { description }) }) as ServerProviderSlashCommand;

describe("menu triggers", () => {
  it("opens @, / and $ at the caret's word, and leaves #, paths and money alone", () => {
    expect(menuTrigger("look at @src/ma", 15)).toEqual({
      kind: "path",
      query: "src/ma",
      rangeStart: 8,
      rangeEnd: 15,
    });
    expect(menuTrigger("/rev", 4)?.kind).toBe("slash-command");
    expect(menuTrigger("use $deb", 8)).toMatchObject({ kind: "skill", query: "deb" });
    expect(menuTrigger("costs $5", 8)).toBeNull();
    expect(menuTrigger("see /usr/bin", 12)).toBeNull();
    expect(menuTrigger("fix #12", 7)).toBeNull();
    expect(menuTrigger("@a b", 4)).toBeNull();
  });
});

describe("menu items", () => {
  it("lists provider commands only at the start, skills anywhere, best match first", () => {
    const commands = [command("review", "Review the diff"), command("compact")];
    const skills = [skill("debug"), skill("off", { enabled: false })];
    expect(slashItems(commands, skills, "", true).map((item) => item.Label)).toEqual([
      "/review",
      "/compact",
      "/skill:debug",
    ]);
    expect(slashItems(commands, skills, "", false).map((item) => item.Label)).toEqual([
      "/skill:debug",
    ]);
    expect(slashItems(commands, skills, "diff", true).map((item) => item.Label)).toEqual([
      "/review",
    ]);
    expect(slashItems(commands, skills, "skill:deb", true).map((item) => item.Insert)).toEqual([
      "$debug ",
    ]);
  });

  it("drops a provider command a skill of the same name shadows", () => {
    expect(
      slashItems([command("debug")], [skill("debug")], "", true).map((item) => item.Label),
    ).toEqual(["/skill:debug"]);
  });

  it("ranks skills by name before description and hides ones the user can't invoke", () => {
    const skills = [
      skill("writer", { description: "Helps debug prose" }),
      skill("debug"),
      skill("agent-only", { userInvocable: false }),
    ];
    expect(skillItems(skills, "deb").map((item) => item.Insert)).toEqual(["$debug ", "$writer "]);
    expect(skillItems(skills, "").map((item) => item.Insert)).toEqual(["$writer ", "$debug "]);
  });

  it("shows a file by name under its folder and inserts a markdown link", () => {
    expect(fileItems([{ path: "src/a (1).ts", kind: "file" }])).toEqual([
      {
        Id: "path:file:src/a (1).ts",
        Kind: "file",
        Label: "a (1).ts",
        Description: "src",
        Insert: "[a (1).ts](src/a%20%281%29.ts) ",
      },
    ]);
  });
});

describe("inserting a pick", () => {
  it("replaces the token, swallows one following space, and puts the caret after", () => {
    const text = "see @ma rest";
    const trigger = menuTrigger(text, 7) as IMenuTrigger;
    expect(applyMenuItem(text, trigger, "[main.ts](main.ts) ")).toEqual({
      Text: "see [main.ts](main.ts) rest",
      Cursor: 23,
    });
    const slash = menuTrigger("/re", 3) as IMenuTrigger;
    expect(applyMenuItem("/re", slash, "/review ")).toEqual({ Text: "/review ", Cursor: 8 });
  });
});
