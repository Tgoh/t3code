import { formatFilePathForClipboard } from "@t3tools/client-runtime/media-actions";
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
  isRelativeFilePath,
  normalizeMarkdownLinkDestination,
  parseMarkdownFileLink,
  resolveMarkdownFileLinkTarget,
} from "@t3tools/shared/markdownLinks";
import { isHostPath, workspaceRelativeFilePath } from "@t3tools/shared/path";

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

/** `baseDir` is the folder a relative link is written from: a previewed file's own. */
function fileLinkFrom(
  source: string,
  cwd: string | undefined,
  baseDir: string | undefined,
): IFileLink | null {
  const targetPath = resolveMarkdownFileLinkTarget(source, cwd, baseDir);
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

export const fileLinkFromHref = (
  href: string,
  cwd: string | undefined,
  baseDir: string | undefined = cwd,
): IFileLink | null => fileLinkFrom(linkHrefKey(href), cwd, baseDir);

// Follows inlineCodePathNamesFromWorkspaceRoot in apps/web/src/markdown-links.ts: a code span
// naming a nested path is read from the workspace root, as agents write them.
function codeNamesFromRoot(
  candidate: string,
  cwd: string | undefined,
  baseDir: string | undefined,
): boolean {
  if (!cwd || !baseDir || !isRelativeFilePath(candidate)) return false;
  if (/^(?:~|\.{1,2})\//.test(candidate)) return false;
  if (!splitFilePathPosition(candidate).path.includes("/")) return false;
  return workspaceRelativeFilePath(baseDir, cwd) !== null;
}

export function fileLinkFromCode(
  code: string,
  cwd: string | undefined,
  baseDir: string | undefined = cwd,
): IFileLink | null {
  const candidate = inlineCodeFilePathCandidate(code);
  if (candidate === null) return null;
  return fileLinkFrom(candidate, cwd, codeNamesFromRoot(candidate, cwd, baseDir) ? cwd : baseDir);
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
export function fileLinkPathsKey(
  text: string,
  cwd: string | undefined,
  baseDir: string | undefined = cwd,
): string {
  const paths = new Set<string>();
  for (const href of extractMarkdownLinkHrefs(text)) {
    const link = fileLinkFromHref(href, cwd, baseDir);
    if (link !== null) paths.add(link.FilePath);
  }
  for (const span of extractInlineCodeSpans(text)) {
    const link = fileLinkFromCode(span, cwd, baseDir);
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

// Follows the chip's `onClick` and `handleOpenInFilePreview` in
// apps/web/src/components/chat/MarkdownFileLink.tsx and `panelPath` in ChatMarkdown.tsx's
// `fileLinkChip`.
export type IFileChipAction = "editor" | "panel" | "media" | "menu";

/** Where a workspace file opens in the Files preview: its relative path, or a host path. */
export function chipPanelPath(
  link: IFileLink,
  cwd: string | undefined,
  media: boolean,
): string | null {
  const relative = workspaceRelativeFilePath(link.FilePath, cwd);
  if (relative === ".") return null;
  return relative ?? (!media && isHostPath(link.FilePath) ? link.FilePath : null);
}

export function fileChipAction(input: {
  /** The editor opens on this client's machine. */
  Editor: boolean;
  /** The platform's open-in-editor modifier was held. */
  Modifier: boolean;
  PanelPath: string | null;
  Media: boolean;
}): IFileChipAction {
  if (!input.Editor && input.PanelPath === null && !input.Media) return "menu";
  if (input.Editor && input.Modifier) return "editor";
  if (input.PanelPath !== null) return "panel";
  if (input.Media) return "media";
  return "editor";
}

export type IFileChipMenuItem =
  | { Id: "preview-media" | "open" | "reveal"; Label: string }
  | { Id: "copy-relative" | "copy-full"; Label: string; Value: string };

// Follows showFileContextMenu and markdownFileCopyMenuItems in MarkdownFileLink.tsx and
// MarkdownFileLink.logic.ts, and markdownFileCopyPaths in apps/web/src/markdownFileHostPath.ts.
export function fileChipMenu(input: {
  Link: IFileLink;
  Cwd: string | undefined;
  Media: boolean;
  /** The open-in-editor label, present when the editor opens on this machine. */
  EditorLabel: string | null;
  /** The reveal label, present when the file manager opens on this machine. */
  RevealLabel: string | null;
}): IFileChipMenuItem[] {
  const { Link: link } = input;
  const relative = workspaceRelativeFilePath(link.FilePath, input.Cwd);
  const clipboard = (path: string) => formatFilePathForClipboard(path, link.TargetPath);
  const position = link.TargetPath.slice(link.FilePath.length);
  return [
    ...(input.Media ? [{ Id: "preview-media" as const, Label: "Preview media" }] : []),
    ...(input.EditorLabel === null ? [] : [{ Id: "open" as const, Label: input.EditorLabel }]),
    ...(input.RevealLabel === null ? [] : [{ Id: "reveal" as const, Label: input.RevealLabel }]),
    ...(relative === null
      ? []
      : [
          {
            Id: "copy-relative" as const,
            Label: "Copy relative path",
            Value: clipboard(`${relative}${position}`),
          },
        ]),
    { Id: "copy-full" as const, Label: "Copy full path", Value: clipboard(link.TargetPath) },
  ];
}
