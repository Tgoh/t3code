import "@t3tools/client-runtime/assembly-highlighting";
import {
  type DiffsHighlighter,
  type DiffsTheme,
  getResolvedOrResolveTheme,
  getSharedHighlighter,
  registerCustomTheme,
  setCustomExtension,
  type SupportedLanguages,
} from "@pierre/diffs";

// Follows apps/web/src/lib/syntaxHighlighting.ts, readableSyntaxTheme.ts and diffRendering.ts
// (DIFF_THEME_NAMES), and UncachedShikiCodeBlock in
// apps/web/src/components/chat/MarkdownCodeBlock.tsx. Loaded on the first settled code block.

const READABLE_LIGHT_THEME_NAME = "t3-light";
export const THEME_NAMES = { light: READABLE_LIGHT_THEME_NAME, dark: "pierre-dark" } as const;

setCustomExtension("luau", "lua");
setCustomExtension("xsl", "xml");
setCustomExtension("xslt", "xml");

const MIN_CONTRAST = 4.5;
// The darkest light code surface stock draws syntax on, rounded down for margin.
const DARKEST_SURFACE_LUMINANCE = 0.69;
const FURTHER_COLORS = new Set(["#1ca1c7", "#636363", "#1a85d4"]);
const FURTHER_MIN_CONTRAST = 6;

function channelLuminance(channel: number): number {
  const value = channel / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function contrastOnLightCode(rgb: readonly [number, number, number]): number {
  const [r, g, b] = rgb.map(channelLuminance) as [number, number, number];
  return (DARKEST_SURFACE_LUMINANCE + 0.05) / (0.2126 * r + 0.7152 * g + 0.0722 * b + 0.05);
}

function readableSyntaxColor(color: string): string {
  const minContrast = FURTHER_COLORS.has(color.toLowerCase()) ? FURTHER_MIN_CONTRAST : MIN_CONTRAST;
  const match = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(color);
  if (!match) return color;
  let rgb = [0, 2, 4].map((start) => Number.parseInt(match[1]!.slice(start, start + 2), 16)) as [
    number,
    number,
    number,
  ];
  if (contrastOnLightCode(rgb) >= minContrast) return color;
  while (contrastOnLightCode(rgb) < minContrast) {
    rgb = rgb.map((channel) => Math.floor(channel * 0.96)) as [number, number, number];
  }
  return `#${rgb.map((channel) => channel.toString(16).padStart(2, "0")).join("")}${match[2] ?? ""}`;
}

type ZedTheme = NonNullable<DiffsTheme["zed"]>;

function withReadableSyntax(theme: ZedTheme): ZedTheme {
  const syntax = Object.fromEntries(
    Object.entries(theme.style.syntax ?? {}).map(([scope, style]) => [
      scope,
      typeof style === "string"
        ? readableSyntaxColor(style)
        : style.color
          ? { ...style, color: readableSyntaxColor(style.color) }
          : style,
    ]),
  );
  return { ...theme, name: READABLE_LIGHT_THEME_NAME, style: { ...theme.style, syntax } };
}

registerCustomTheme(
  READABLE_LIGHT_THEME_NAME,
  async () => {
    const base = await getResolvedOrResolveTheme("pierre-light", "highlights");
    if (!base.zed) throw new Error("pierre-light has no Highlights palette");
    return withReadableSyntax(base.zed);
  },
  "zed",
);

const highlighters = new Map<string, Promise<DiffsHighlighter>>();

function highlighterFor(language: string): Promise<DiffsHighlighter> {
  const held = highlighters.get(language);
  if (held) return held;
  const loading = getSharedHighlighter({
    themes: Object.values(THEME_NAMES),
    langs: [language as SupportedLanguages],
    // Highlights' WASM lexers are much faster than Shiki's regex engine and never backtrack.
    preferredHighlighter: "highlights",
  }).catch((error: unknown) => {
    if (language === "text") {
      highlighters.delete(language);
      throw error;
    }
    return highlighterFor("text");
  });
  highlighters.set(language, loading);
  return loading;
}

export async function highlightToHtml(
  code: string,
  language: string,
  scheme: "light" | "dark",
): Promise<string> {
  const highlighter = await highlighterFor(language);
  const theme = THEME_NAMES[scheme];
  try {
    return highlighter.codeToHtml(code, { lang: language, theme });
  } catch {
    return highlighter.codeToHtml(code, { lang: "text", theme });
  }
}
