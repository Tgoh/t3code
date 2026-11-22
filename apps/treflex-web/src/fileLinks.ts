import { isLocalEditorFileUrl } from "@t3tools/contracts";
import {
  buildFileLinkParentSuffixByPath,
  fileLinkLabel,
  parseFileUrlHref,
  splitFilePathPosition,
} from "@t3tools/shared/fileLinks";
import {
  absoluteFilePathMatches,
  extractInlineCodeSpans,
  extractMarkdownLinkHrefs,
  inlineCodeFilePathCandidate,
  isMarkdownFileLinkLabel,
  normalizeMarkdownLinkDestination,
  parseMarkdownFileLink,
  resolveMarkdownFileLinkTarget,
} from "@t3tools/shared/markdownLinks";

// Follows resolveMarkdownFileLinkMeta, resolveInlineCodeFileLinkMeta and isLocalEditorFileHref in
// apps/web/src/markdown-links.ts, and fileLinkSourcesKey and normalizeMarkdownLinkHrefKey in
// apps/web/src/components/ChatMarkdown.tsx.

export interface IFileLink {
  FilePath: string;
  // The path with its `:line:column` position, as the editor opens it.
  TargetPath: string;
  Line?: number;
  Column?: number;
  EndLine?: number;
}

export type ProsePart = string | { Path: string };

const WINDOWS_DRIVE_PATH = /^[A-Za-z]:[\\/]/;

export function linkHrefKey(href: string): string {
  const normalized = normalizeMarkdownLinkDestination(href);
  const fileUrl = parseFileUrlHref(normalized);
  const rewritten = fileUrl === null ? normalized : `${fileUrl.path}${fileUrl.hash}`;
  return WINDOWS_DRIVE_PATH.test(rewritten) ? rewritten.replaceAll("\\", "/") : rewritten;
}

function fileLinkFrom(source: string, cwd: string | undefined): IFileLink | null {
  const targetPath = resolveMarkdownFileLinkTarget(source, cwd);
  if (targetPath === null) return null;
  const { path, line, column } = splitFilePathPosition(targetPath);
  const endLine = parseMarkdownFileLink(source)?.endLine;
  return {
    FilePath: path,
    TargetPath: targetPath,
    ...(line === undefined ? {} : { Line: line }),
    ...(column === undefined ? {} : { Column: column }),
    ...(endLine === undefined ? {} : { EndLine: endLine }),
  };
}

export const fileLinkFromHref = (href: string, cwd: string | undefined): IFileLink | null =>
  fileLinkFrom(linkHrefKey(href), cwd);

export function fileLinkFromCode(code: string, cwd: string | undefined): IFileLink | null {
  const candidate = inlineCodeFilePathCandidate(code);
  return candidate === null ? null : fileLinkFrom(candidate, cwd);
}

// A link's own text names the file, so the chip replaces it rather than following it.
export const labelNamesFile = (label: string, href: string): boolean =>
  isMarkdownFileLinkLabel(label, linkHrefKey(href));

export function isEditorLinkHref(href: string): boolean {
  try {
    return isLocalEditorFileUrl(new URL(href));
  } catch {
    return false;
  }
}

export function prosePathParts(text: string): ProsePart[] {
  const parts: ProsePart[] = [];
  let offset = 0;
  for (const { index, path } of absoluteFilePathMatches(text)) {
    if (index > offset) parts.push(text.slice(offset, index));
    parts.push({ Path: path });
    offset = index + path.length;
  }
  if (offset === 0) return [text];
  if (offset < text.length) parts.push(text.slice(offset));
  return parts;
}

// The paths a message links, as a string that stays equal while streamed text adds none.
export function fileLinkPathsKey(text: string, cwd: string | undefined): string {
  const paths = new Set<string>();
  for (const href of extractMarkdownLinkHrefs(text)) {
    const link = fileLinkFromHref(href, cwd);
    if (link !== null) paths.add(link.FilePath);
  }
  for (const span of extractInlineCodeSpans(text)) {
    const link = fileLinkFromCode(span, cwd);
    if (link !== null) paths.add(link.FilePath);
  }
  return JSON.stringify([...paths]);
}

export const parentSuffixes = (pathsKey: string): Map<string, string> =>
  buildFileLinkParentSuffixByPath(JSON.parse(pathsKey) as string[]);

export const chipLabel = (link: IFileLink, suffixes: ReadonlyMap<string, string>): string =>
  fileLinkLabel(
    {
      path: link.FilePath,
      ...(link.Line === undefined ? {} : { line: link.Line }),
      ...(link.Column === undefined ? {} : { column: link.Column }),
      ...(link.EndLine === undefined ? {} : { endLine: link.EndLine }),
    },
    suffixes,
  );
