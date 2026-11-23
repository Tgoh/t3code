import { filePreviewKind } from "@t3tools/shared/filePreview";
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
