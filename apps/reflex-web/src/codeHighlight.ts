import type { Tokens } from "marked";

// Follows extractFenceLanguage, highlighterLanguageOf, extractFenceTitle, createHighlightCacheKey
// and highlightedCodeCache in apps/web/src/components/chat/MarkdownCodeBlock.logic.ts and
// MarkdownCodeBlock.tsx.

export type Scheme = "light" | "dark";

export interface IFence {
  Language: string;
  Title: string | null;
}

const FENCE_TITLE_ATTR = /(?:^|\s)(?:title|file(?:name)?)=(?:"([^"]+)"|'([^']+)'|(\S+))/i;
const FENCE_FILENAME_TOKEN = /^[\w@][\w@./-]*\.[A-Za-z0-9]+$/;

export function fenceOf(info: string | undefined): IFence {
  const [first = "", ...rest] = (info ?? "").trim().split(/\s+/);
  const meta = rest.join(" ");
  const attr = FENCE_TITLE_ATTR.exec(meta);
  return {
    // Shiki doesn't bundle a gitignore grammar; ini is a close match.
    Language: first === "" ? "text" : first === "gitignore" ? "ini" : first,
    Title:
      attr?.[1] ??
      attr?.[2] ??
      attr?.[3] ??
      rest.find((candidate) => FENCE_FILENAME_TOKEN.test(candidate)) ??
      null,
  };
}

const PLAIN_LANGUAGES = new Set(["text", "txt", "plain", "plaintext"]);

export const isPlainLanguage = (language: string): boolean =>
  PLAIN_LANGUAGES.has(language.toLowerCase());

// A fence the stream hasn't closed yet still grows, so it isn't highlighted until it settles.
export function isSettled(token: Tokens.Code): boolean {
  if (token.codeBlockStyle === "indented") return true;
  const opening = /^[ \t]*(`{3,}|~{3,})/.exec(token.raw)?.[1];
  const closing = /\n[ \t]*(`{3,}|~{3,})[ \t]*\n*$/.exec(token.raw)?.[1];
  return (
    opening !== undefined &&
    closing !== undefined &&
    opening[0] === closing[0] &&
    closing.length >= opening.length
  );
}

const MAX_ENTRIES = 500;
const MAX_CHARACTERS = 25 * 1024 * 1024;

// The key holds the code itself, so two blocks never share highlighted HTML.
const cacheKey = (code: string, language: string, scheme: Scheme): string =>
  `${language.length}:${language}:${scheme}:${code}`;

const cache = new Map<string, string>();
let cachedCharacters = 0;

export function cachedHighlight(code: string, language: string, scheme: Scheme): string | null {
  const key = cacheKey(code, language, scheme);
  const held = cache.get(key);
  if (held === undefined) return null;
  cache.delete(key);
  cache.set(key, held);
  return held;
}

function remember(key: string, html: string): void {
  cache.set(key, html);
  cachedCharacters += key.length + html.length;
  for (const [oldest, value] of cache) {
    if (cache.size <= MAX_ENTRIES && cachedCharacters <= MAX_CHARACTERS) break;
    cache.delete(oldest);
    cachedCharacters -= oldest.length + value.length;
  }
}

export async function highlight(code: string, language: string, scheme: Scheme): Promise<string> {
  const held = cachedHighlight(code, language, scheme);
  if (held !== null) return held;
  const { highlightToHtml } = await import("./codeHighlighter");
  const html = await highlightToHtml(code, language, scheme);
  remember(cacheKey(code, language, scheme), html);
  return html;
}
