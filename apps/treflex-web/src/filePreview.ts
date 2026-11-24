import {
  filePreviewKind,
  isWorkspaceAudioPreviewPath,
  isWorkspaceImagePreviewPath,
  isWorkspaceVideoPreviewPath,
} from "@t3tools/shared/filePreview";
import { resolvePathLinkTarget } from "@t3tools/shared/fileLinks";
import {
  isAbsolutePath,
  isHostPath,
  isWindowsAbsolutePath,
  normalizeProjectPathForComparison,
  workspaceRelativeFilePath,
} from "@t3tools/shared/path";

// Follows resolveFilePreviewPath, isMarkdownPreviewFile and filePreviewReadErrorMessage in
// apps/web/src/components/files/filePreviewMode.ts, fileBreadcrumbs in filePath.ts, clampFileLine
// and the copy and rendered-toggle rules in FilePreviewPanel.tsx and AttachmentFilePreview.tsx, and
// openFile's path normalization in apps/web/src/rightPanelStore.ts.

export function panelFilePath(requested: string): string {
  return /^[A-Za-z]:\/+$/.test(requested) ? requested : requested.replace(/\/+$/, "") || requested;
}

/** Null for the workspace folder itself, which stock shows in its folder browser. */
export function previewPath(path: string, cwd: string): string | null {
  return path === "." || workspaceRelativeFilePath(path, cwd) === "." ? null : path;
}

export const isMarkdownPreviewFile = (path: string): boolean =>
  /\.(?:md|mdx|markdown|mdown|mkd)$/i.test(path);

export function clampFileLine(contents: string, requestedLine: number): number {
  let lineCount = 1;
  for (let index = 0; index < contents.length; index += 1) {
    const character = contents.charCodeAt(index);
    if (character === 10) {
      lineCount += 1;
    } else if (character === 13) {
      lineCount += 1;
      if (contents.charCodeAt(index + 1) === 10) index += 1;
    }
  }
  return Math.min(Math.max(1, requestedLine), lineCount);
}

export interface IFileReadError {
  Message: string;
  Failure: string | null;
  Operation: string | null;
  AttemptedPath: string | null;
  Cwd: string | null;
}

export function readErrorMessage(error: IFileReadError): string {
  switch (error.Failure) {
    case "path_not_file":
      return "The path is a directory or special file, not a regular file.";
    case "binary_file":
      return "The file is binary and cannot be displayed as text.";
    case "workspace_path_outside_root":
      return "The requested path is outside the workspace.";
    case "resolved_path_outside_root":
      return "The path resolves to a location outside the workspace.";
    case "operation_failed":
      return error.Operation === "realpath-workspace-root"
        ? "The workspace folder could not be accessed."
        : "The file could not be accessed or read. It may be missing or inaccessible.";
    default:
      return error.Message;
  }
}

export interface IFileCrumb {
  Label: string;
  Path: string;
}

export function fileBreadcrumbs(projectName: string, relativePath: string): IFileCrumb[] {
  const hostPath = isHostPath(relativePath);
  const windowsPath = isWindowsAbsolutePath(relativePath);
  const separator = windowsPath ? "\\" : "/";
  const homePath = relativePath.startsWith("~\\") ? `~/${relativePath.slice(2)}` : relativePath;
  const parts = homePath.split(windowsPath ? /[\\/]/ : "/").filter(Boolean);
  const root = relativePath.startsWith("\\\\") ? "\\\\" : relativePath.startsWith("/") ? "/" : "";
  return [
    ...(hostPath ? [] : [{ Label: projectName, Path: "" }]),
    ...parts.map((part, index) => {
      const path = root + parts.slice(0, index + 1).join(separator);
      return {
        Label: part,
        Path: /^[A-Za-z]:$/.test(path) ? `${path}\\` : hostPath && path === "~" ? "~/" : path,
      };
    }),
  ];
}

export type IAttachmentPreviewKind = ReturnType<typeof filePreviewKind>;

/** The kinds whose text an attachment's preview shows; the rest load from the signed URL. */
export function attachmentNeedsText(kind: IAttachmentPreviewKind): boolean {
  return kind === "text" || kind === "markdown" || kind === "mermaid" || kind === "html";
}

export type ICopyLabel = "Copied" | "Copy preview" | "Copy contents";

export const attachmentCopyLabel = (copied: boolean, truncated: boolean): ICopyLabel =>
  copied ? "Copied" : truncated ? "Copy preview" : "Copy contents";

export const workspaceCopyable = (
  read: { Contents: string; Truncated: boolean } | null,
  media: boolean,
): string | null =>
  read !== null && !media && !read.Truncated && read.Contents.length > 0 ? read.Contents : null;

export const renderedToggleLabel = (rendered: boolean): string =>
  rendered ? "Show markdown source" : "Show rendered markdown";

// Follows resolveDiffPathForWorkspace in apps/web/src/diffFileActions.ts.
function relativeSegments(filePath: string, windowsRoot: boolean): ReadonlyArray<string> | null {
  if (filePath.startsWith("/") || isWindowsAbsolutePath(filePath) || /^[a-zA-Z]:/.test(filePath)) {
    return null;
  }
  // A tool call's patch can name files with either separator, so `..` is refused in both.
  const parts = filePath.split(/[\\/]/);
  if (parts.includes("..")) return null;
  const segments = (windowsRoot ? parts : filePath.split("/")).filter(
    (segment) => segment.length > 0 && segment !== ".",
  );
  return segments.length === 0 ? null : segments;
}

function workspaceInRepository(
  workspaceRoot: string | undefined,
  repositoryRoot: string | undefined,
): ReadonlyArray<string> | null {
  if (!workspaceRoot || !repositoryRoot) return null;
  const workspace = normalizeProjectPathForComparison(workspaceRoot);
  const repository = normalizeProjectPathForComparison(repositoryRoot);
  if (workspace === repository) return [];
  const separator = isWindowsAbsolutePath(repository) ? "\\" : "/";
  const prefix = repository.endsWith(separator) ? repository : `${repository}${separator}`;
  if (!workspace.startsWith(prefix)) return null;
  return workspace.slice(prefix.length).split(separator).filter(Boolean);
}

/** A diff's file as a workspace-relative path the Files preview opens, or null outside it. */
export function diffPathForWorkspace(input: {
  filePath: string;
  workspaceRoot: string | undefined;
  repositoryRoot: string | undefined;
}): string | null {
  const windowsRoot = [input.workspaceRoot, input.repositoryRoot].some(
    (root) => root !== undefined && isWindowsAbsolutePath(root),
  );
  if (isAbsolutePath(input.filePath)) {
    const relative = workspaceRelativeFilePath(input.filePath, input.workspaceRoot);
    const segments = relative === null ? null : relativeSegments(relative, windowsRoot);
    return segments ? segments.join("/") : null;
  }
  const fileSegments = relativeSegments(input.filePath, windowsRoot);
  if (!fileSegments) return null;
  const workspaceSegments = workspaceInRepository(input.workspaceRoot, input.repositoryRoot);
  if (!workspaceSegments || workspaceSegments.length === 0) return fileSegments.join("/");
  const caseInsensitive = input.repositoryRoot
    ? isWindowsAbsolutePath(input.repositoryRoot)
    : false;
  const inWorkspace = workspaceSegments.every((segment, index) => {
    const candidate = fileSegments[index];
    if (candidate === undefined) return false;
    return caseInsensitive ? candidate.toLowerCase() === segment : candidate === segment;
  });
  if (!inWorkspace) return null;
  const rest = fileSegments.slice(workspaceSegments.length);
  return rest.length > 0 ? rest.join("/") : null;
}

export type IWorkspaceMediaKind = "image" | "video" | "audio";

export function workspaceMediaKind(path: string): IWorkspaceMediaKind | null {
  if (isWorkspaceVideoPreviewPath(path)) return "video";
  if (isWorkspaceAudioPreviewPath(path)) return "audio";
  return isWorkspaceImagePreviewPath(path) ? "image" : null;
}

export const isWorkspaceMediaPath = (path: string): boolean => workspaceMediaKind(path) !== null;

// Follows the revision suffix in WorkspaceImagePreview, WorkspaceVideoPreview and
// WorkspaceAudioPreview in apps/web/src/components/files/FilePreviewPanel.tsx. Two mints in the
// same millisecond sign identical URLs, so the revision also goes in the URL.
export function revisionedUrl(
  url: string,
  fileRevision: string | null,
  workspaceRevision: number,
): string {
  if (fileRevision === null && workspaceRevision === 0) return url;
  const [name, value] =
    fileRevision === null ? ["workspace", String(workspaceRevision)] : ["file", fileRevision];
  return `${url}${url.includes("?") ? "&" : "?"}${name}-revision=${encodeURIComponent(value)}`;
}

// Follows `imageBaseDir` in apps/web/src/components/files/FileMarkdownPreview.tsx.
export function markdownBaseDir(relativePath: string, cwd: string): string {
  const separator = Math.max(relativePath.lastIndexOf("/"), relativePath.lastIndexOf("\\"));
  return separator >= 0 ? resolvePathLinkTarget(relativePath.slice(0, separator), cwd) : cwd;
}

// Follows MediaVideoPlayer in apps/web/src/components/media/MediaVideoPlayer.tsx and
// StandardAudioPreview in apps/web/src/components/files/AudioPreview.tsx: a loaded player keeps
// its source through a re-sign, and a changed file loads once playback pauses.
export interface IPlaybackSource {
  Src: string;
  Revision: string | null;
}

/** The source a player shows: the one it loaded, else the latest signed URL. */
export const playerSource = (held: IPlaybackSource | null, latest: string | null): string | null =>
  held?.Src ?? latest;

/** What a held source becomes when the file's revision may have moved; `held` when it stays. */
export function followRevision(input: {
  held: IPlaybackSource | null;
  latest: string | null;
  revision: string | null;
  sourceFailed: boolean;
  playing: boolean;
}): IPlaybackSource | null {
  const { held, latest, revision } = input;
  if (held === null || held.Revision === revision || input.playing) return held;
  if (latest === null && !input.sourceFailed) return held;
  return revision !== null && latest !== null ? { Src: latest, Revision: revision } : null;
}

/** A video fails only on its own source, or with no source when signing failed. */
export const videoFailed = (src: string | null, failedSrc: string | null, sourceFailed: boolean) =>
  src !== null ? failedSrc === src : sourceFailed;

/** A load error on a stale source falls through to the latest URL rather than failing. */
export const playerErrorFails = (src: string, latest: string | null): boolean =>
  latest === null || src === latest;
