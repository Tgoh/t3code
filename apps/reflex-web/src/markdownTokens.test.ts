import type { Token, Tokens } from "marked";
import { describe, expect, it } from "vite-plus/test";

import { blockTokens, createMarkdownLexer } from "./markdownTokens";

const shape = (tokens: Token[]) => tokens.map((token) => [token.type, token.raw]);

describe("blockTokens", () => {
  it("renders a loose list item's blocks as paragraphs, like stock", () => {
    const [list] = createMarkdownLexer(false)("- a\n\n  b").Blocks as [Tokens.List];
    const item = list.items[0]!;
    expect(shape(blockTokens(item.tokens, item.loose))).toEqual([
      ["paragraph", "a"],
      ["paragraph", "b"],
    ]);
  });

  it("drops a reference definition inside a blockquote", () => {
    const [quote] = createMarkdownLexer(false)("> a\n>\n> [x]: /y").Blocks as [Tokens.Blockquote];
    expect(shape(blockTokens(quote.tokens))).toEqual([["paragraph", "a"]]);
  });

  it("keeps a tight list item's text inline", () => {
    const [list] = createMarkdownLexer(false)("- a\n- b").Blocks as [Tokens.List];
    const item = list.items[0]!;
    expect(shape(blockTokens(item.tokens, item.loose))).toEqual([["text", "a"]]);
  });
});
