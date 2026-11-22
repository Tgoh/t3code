import { marked, type Tokens } from "marked";
import { describe, expect, it } from "vite-plus/test";

import { fenceOf, isSettled } from "./codeHighlight";

const codeToken = (markdown: string): Tokens.Code => {
  const token = marked.lexer(markdown).find((held) => held.type === "code");
  if (token === undefined) throw new Error("no code block");
  return token as Tokens.Code;
};

describe("fenceOf", () => {
  it.each([
    [undefined, { Language: "text", Title: null }],
    ["ts", { Language: "ts", Title: null }],
    ["gitignore", { Language: "ini", Title: null }],
    ["ts title=src/a.ts", { Language: "ts", Title: "src/a.ts" }],
    ['tsx filename="App.tsx"', { Language: "tsx", Title: "App.tsx" }],
    ["json package.json", { Language: "json", Title: "package.json" }],
    ["sh {1,3}", { Language: "sh", Title: null }],
  ])("reads %s", (info, expected) => {
    expect(fenceOf(info)).toEqual(expected);
  });
});

describe("isSettled", () => {
  it.each([
    ["```ts\nlet a = 1;\n```\n", true],
    ["```ts\nlet a = 1;\n```", true],
    ["~~~\nx\n~~~", true],
    ["````md\n```ts\nx\n```\n````", true],
    ["```ts\nlet a = 1;\n", false],
    ["```ts\nlet a", false],
    ["```", false],
    ["````md\n```ts\nx\n```", false],
    ["    indented code\n", true],
  ])("%j → %s", (markdown, settled) => {
    expect(isSettled(codeToken(markdown))).toBe(settled);
  });
});
