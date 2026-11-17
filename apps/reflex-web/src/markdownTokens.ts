import { Marked, type Token } from "marked";

const escapeHtml = (text: string): string =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

// The HTML parser reads everything after one of these as its content, so a mention in prose would
// swallow the rest of the message.
const RAW_TEXT_TAG =
  /<\/?(?:style|script|title|textarea|xmp|iframe|noembed|noframes|noscript|plaintext)\b/i;

const assistantParser = new Marked({
  renderer: {
    html: ({ text }) => (RAW_TEXT_TAG.test(text) ? escapeHtml(text) : text),
  },
});
const userParser = new Marked({ breaks: true });

const FENCE = /^ {0,3}(```|~~~)/;
const ORDERED_ITEM = /^ {0,3}\d{1,9}[.)][ \t]+\S/;
const LIST_ITEM = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/;

/**
 * CommonMark only lets a list that starts at 1 interrupt a paragraph, so a one-line label followed
 * by `2. …` lexes as one run-on paragraph. Agents write sections that way, continuing the count.
 */
function separateListsFromLabels(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let fenced = false;
  for (const [index, line] of lines.entries()) {
    if (FENCE.test(line)) fenced = !fenced;
    const label = lines[index - 1];
    const beforeLabel = lines[index - 2];
    if (
      !fenced &&
      label !== undefined &&
      ORDERED_ITEM.test(line) &&
      label.trim() !== "" &&
      !LIST_ITEM.test(label) &&
      (beforeLabel === undefined || beforeLabel.trim() === "")
    ) {
      out.push("");
    }
    out.push(line);
  }
  return out.join("\n");
}

export function containsHtml(token: Token): boolean {
  if (token.type === "html") return true;
  const held = token as {
    tokens?: Token[];
    items?: Token[];
    header?: Array<{ tokens: Token[] }>;
    rows?: Array<Array<{ tokens: Token[] }>>;
  };
  const cells = [...(held.header ?? []), ...(held.rows ?? []).flat()];
  return (
    (held.tokens ?? []).some(containsHtml) ||
    (held.items ?? []).some(containsHtml) ||
    cells.some((cell) => cell.tokens.some(containsHtml))
  );
}

// A loose list item lexes its paragraphs as bare text tokens, which marked's own parser wraps in <p>.
export function blockTokens(tokens: Token[], loose = false): Token[] {
  return tokens
    .filter((token) => token.type !== "space" && token.type !== "def")
    .map((token): Token =>
      loose && token.type === "text"
        ? {
            type: "paragraph",
            raw: token.raw,
            text: token.text,
            tokens: token.tokens ?? [{ type: "text", raw: token.raw, text: token.text }],
          }
        : token,
    );
}

export const assistantHtml = (tokens: Token[]): string => assistantParser.parser(tokens);

export interface ILexedMarkdown {
  Blocks: Token[];
  // Set when raw HTML can span blocks, as <details> around markdown does, so the blocks can't be
  // rendered one by one.
  WholeHtml: Token[] | null;
}

// Reuses the token of a block whose source didn't change, so a delta only touches the last block.
export function createMarkdownLexer(fromUser: boolean): (text: string) => ILexedMarkdown {
  let held = new Map<string, Token>();
  return (text) => {
    const next = new Map<string, Token>();
    const blocks = blockTokens(
      (fromUser ? userParser : assistantParser).lexer(separateListsFromLabels(text)),
    ).map((token) => {
      const reused = held.get(token.raw) ?? token;
      next.set(token.raw, reused);
      return reused;
    });
    held = next;
    return {
      Blocks: blocks,
      WholeHtml: !fromUser && blocks.some((token) => token.type === "html") ? blocks : null,
    };
  };
}
