import type { FileDiffMetadata } from "@pierre/diffs/types";
import { parsePatchFiles } from "@pierre/diffs/utils/parsePatchFiles";

// Follows apps/web/src/lib/diffRendering.ts.

const FNV_OFFSET_BASIS_32 = 0x811c9dc5;
const FNV_PRIME_32 = 0x01000193;
const SECONDARY_HASH_SEED = 0x9e3779b9;
const SECONDARY_HASH_MULTIPLIER = 0x85ebca6b;

export function fnv1a32(
  input: string,
  seed = FNV_OFFSET_BASIS_32,
  multiplier = FNV_PRIME_32,
): number {
  let hash = seed >>> 0;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, multiplier) >>> 0;
  }
  return hash >>> 0;
}

function buildPatchCacheKey(patch: string, scope: string): string {
  const primary = fnv1a32(patch, FNV_OFFSET_BASIS_32, FNV_PRIME_32).toString(36);
  const secondary = fnv1a32(patch, SECONDARY_HASH_SEED, SECONDARY_HASH_MULTIPLIER).toString(36);
  return `${scope}:${patch.length}:${primary}:${secondary}`;
}

export type IRenderablePatch =
  | { Kind: "files"; Files: FileDiffMetadata[] }
  | { Kind: "raw"; Text: string; Reason: string };

export function diffLineStat(files: readonly FileDiffMetadata[]): {
  additions: number;
  deletions: number;
} {
  let additions = 0;
  let deletions = 0;
  for (const file of files) {
    for (const hunk of file.hunks) {
      additions += hunk.additionLines;
      deletions += hunk.deletionLines;
    }
  }
  return { additions, deletions };
}

export function renderablePatch(
  patch: string | null | undefined,
  cacheScope: string,
): IRenderablePatch | null {
  if (!patch?.trim()) return null;
  try {
    const files = parsePatchFiles(patch, {
      cacheKeyPrefix: buildPatchCacheKey(patch, cacheScope),
    }).flatMap((parsed) => parsed.files);
    if (files.length > 0) return { Kind: "files", Files: files };
    return { Kind: "raw", Text: patch, Reason: "Unsupported diff format. Showing raw patch." };
  } catch {
    return { Kind: "raw", Text: patch, Reason: "Failed to parse patch. Showing raw patch." };
  }
}

export interface IDiffSection {
  Key: string;
  RelativePath: string;
  Diff: string;
}

/**
 * Several patches as one file list. Each file is named from the folder the patches share, so the
 * same path in two repositories stays two files.
 */
export function renderablePatchSections(
  sections: readonly IDiffSection[],
  cacheScope: string,
): IRenderablePatch | null {
  const files: FileDiffMetadata[] = [];
  for (const section of sections) {
    const patch = renderablePatch(section.Diff, `${cacheScope}:${section.Key}`);
    if (patch === null) continue;
    if (patch.Kind === "raw") {
      return { ...patch, Text: sections.map((entry) => entry.Diff).join("\n") };
    }
    const prefix = section.RelativePath === "" ? "" : `${section.RelativePath}/`;
    files.push(
      ...patch.Files.map((file) =>
        prefix === ""
          ? file
          : {
              ...file,
              name: `${prefix}${file.name}`,
              ...(file.prevName === undefined ? {} : { prevName: `${prefix}${file.prevName}` }),
            },
      ),
    );
  }
  return files.length === 0 ? null : { Kind: "files", Files: files };
}

export function fileDiffPath(fileDiff: FileDiffMetadata): string {
  return fileDiff.name ?? fileDiff.prevName ?? "";
}

function fileDiffIdentityKey(fileDiff: FileDiffMetadata): string {
  return `${fileDiff.prevName ?? fileDiff.name ?? ""}\u0000${fileDiffPath(fileDiff)}\u0000${fileDiff.type}`;
}

function hashFileDiffPart(hash: number, value: string | number | boolean | undefined): number {
  const serialized = value === undefined ? "undefined" : String(value);
  const withLength = fnv1a32(`${typeof value}:${serialized.length}:`, hash);
  return fnv1a32(serialized, withLength);
}

// Pierre's whole-patch cache key would repaint every file when one changes.
function fileDiffContentVersion(fileDiff: FileDiffMetadata): number {
  let hash = FNV_OFFSET_BASIS_32;
  const append = (value: string | number | boolean | undefined) => {
    hash = hashFileDiffPart(hash, value);
  };
  append(fileDiff.name);
  append(fileDiff.prevName);
  append(fileDiff.lang);
  append(fileDiff.newObjectId);
  append(fileDiff.prevObjectId);
  append(fileDiff.mode);
  append(fileDiff.prevMode);
  append(fileDiff.type);
  append(fileDiff.isPartial);
  append(fileDiff.splitLineCount);
  append(fileDiff.unifiedLineCount);
  for (const line of fileDiff.additionLines) append(line);
  for (const line of fileDiff.deletionLines) append(line);
  for (const hunk of fileDiff.hunks) {
    append(hunk.collapsedBefore);
    append(hunk.additionStart);
    append(hunk.additionCount);
    append(hunk.additionLines);
    append(hunk.additionLineIndex);
    append(hunk.deletionStart);
    append(hunk.deletionCount);
    append(hunk.deletionLines);
    append(hunk.deletionLineIndex);
    append(hunk.hunkContext);
    append(hunk.hunkSpecs);
    append(hunk.splitLineStart);
    append(hunk.splitLineCount);
    append(hunk.unifiedLineStart);
    append(hunk.unifiedLineCount);
    append(hunk.noEOFCRAdditions);
    append(hunk.noEOFCRDeletions);
    for (const content of hunk.hunkContent) {
      append(content.type);
      append(content.additionLineIndex);
      append(content.deletionLineIndex);
      append(content.type === "change" ? content.additions : content.lines);
      append(content.type === "change" ? content.deletions : undefined);
    }
  }
  return hash;
}

export interface IFileDiffEntry {
  FileDiff: FileDiffMetadata;
  Key: string;
  Version: number;
}

const entryCache = new WeakMap<FileDiffMetadata, IFileDiffEntry>();

/** Gives repeated blocks independent viewer state without tying identity to patch content. */
export function fileDiffEntries(files: readonly FileDiffMetadata[]): IFileDiffEntry[] {
  const occurrences = new Map<string, number>();
  return files.map((fileDiff) => {
    let entry = entryCache.get(fileDiff);
    if (entry === undefined) {
      entry = {
        FileDiff: fileDiff,
        Key: fileDiffIdentityKey(fileDiff),
        Version: fileDiffContentVersion(fileDiff),
      };
      entryCache.set(fileDiff, entry);
    }
    const occurrence = occurrences.get(entry.Key) ?? 0;
    occurrences.set(entry.Key, occurrence + 1);
    return occurrence === 0 ? entry : { ...entry, Key: `${entry.Key}\u0000${occurrence}` };
  });
}

// Pierre renders inside shadow roots, so its theme overrides go in as unsafeCSS. Follows
// DIFF_SURFACE_THEME_UNSAFE_CSS in apps/web/src/lib/diffRendering.ts and DIFF_VIEW_UNSAFE_CSS in
// apps/web/src/components/diffs/StyledDiffCodeView.tsx.
export const DIFF_SURFACE_THEME_UNSAFE_CSS = `
[data-diffs-header],
[data-diff],
[data-file],
[data-error-wrapper],
[data-virtualizer-buffer] {
  --diffs-header-font-family: var(--font-sans) !important;
  --diffs-font-family: var(--font-mono) !important;
  --diffs-bg: var(--code-background) !important;
  --diffs-light-bg: var(--code-background) !important;
  --diffs-dark-bg: var(--code-background) !important;
  --diffs-token-light-bg: transparent;
  --diffs-token-dark-bg: transparent;
  --diffs-bg-context-override: color-mix(in srgb, var(--code-background) 97%, var(--code-foreground));
  --diffs-bg-hover-override: color-mix(in srgb, var(--code-background) 94%, var(--code-foreground));
  --diffs-bg-separator-override: color-mix(in srgb, var(--code-background) 95%, var(--code-foreground));
  --diffs-bg-buffer-override: color-mix(in srgb, var(--code-background) 90%, var(--code-foreground));
  --diffs-bg-addition-override: light-dark(
    color-mix(in srgb, var(--code-background) calc(50% - var(--appearance-contrast-boost, 0%) / 4), var(--diff-addition)),
    color-mix(in srgb, var(--code-background) calc(70% - var(--appearance-contrast-boost, 0%) / 4), var(--diff-addition))
  );
  --diffs-bg-addition-number-override: light-dark(
    color-mix(in srgb, var(--code-background) calc(35% - var(--appearance-contrast-boost, 0%) / 4), var(--diff-addition)),
    color-mix(in srgb, var(--code-background) calc(60% - var(--appearance-contrast-boost, 0%) / 4), var(--diff-addition))
  );
  --diffs-bg-addition-hover-override: color-mix(in srgb, var(--code-background) 85%, var(--diff-addition));
  --diffs-bg-addition-emphasis: light-dark(
    rgb(from var(--diffs-addition-base) r g b / 15%),
    rgb(from var(--diffs-addition-base) r g b / calc(20% + var(--appearance-contrast-boost, 0%) / 4))
  );
  --diffs-bg-deletion-override: light-dark(
    color-mix(in srgb, var(--code-background) calc(50% - var(--appearance-contrast-boost, 0%) / 4), var(--diff-deletion)),
    color-mix(in srgb, var(--code-background) calc(70% - var(--appearance-contrast-boost, 0%) / 4), var(--diff-deletion))
  );
  --diffs-bg-deletion-number-override: light-dark(
    color-mix(in srgb, var(--code-background) calc(35% - var(--appearance-contrast-boost, 0%) / 4), var(--diff-deletion)),
    color-mix(in srgb, var(--code-background) calc(60% - var(--appearance-contrast-boost, 0%) / 4), var(--diff-deletion))
  );
  --diffs-bg-deletion-hover-override: color-mix(in srgb, var(--code-background) 85%, var(--diff-deletion));
  --diffs-bg-deletion-emphasis: light-dark(
    rgb(from var(--diffs-deletion-base) r g b / 15%),
    rgb(from var(--diffs-deletion-base) r g b / calc(20% + var(--appearance-contrast-boost, 0%) / 4))
  );
  background-color: var(--diffs-bg) !important;
  color: var(--code-foreground) !important;
}

[data-change-icon="new"] {
  color: var(--diff-added-icon, light-dark(var(--diff-addition-foreground), var(--diffs-addition-base))) !important;
}
[data-change-icon="deleted"] {
  color: light-dark(var(--diff-deletion-foreground), var(--diffs-deletion-base)) !important;
}
[data-change-icon="change"],
[data-change-icon="rename-pure"],
[data-change-icon="rename-changed"] {
  color: var(--diff-modified-icon, light-dark(var(--info-foreground), var(--diffs-modified-base))) !important;
}
`;

export const DIFF_VIEW_UNSAFE_CSS = `${DIFF_SURFACE_THEME_UNSAFE_CSS}
/* Keeps both split code columns the same width, so wrapping doesn't shift them as lines mount. */
[data-diff-type="split"][data-overflow="wrap"] {
  --diffs-code-grid: var(--diffs-grid-number-column-width) minmax(0, 1fr);
}

:host {
  --diffs-bg-search-match-override: light-dark(#ff963288, #ff963266);
  --diffs-bg-search-match-current-override: color-mix(
    in lab,
    var(--diffs-modified-base) 45%,
    transparent
  );
  --diffs-fg-search-match-override: currentColor;
}

[data-file-info] {
  background-color: var(--code-background) !important;
  border-block-color: transparent !important;
  color: var(--code-foreground) !important;
}

[data-diffs-header] {
  position: sticky !important;
  top: 0;
  z-index: 4;
  background-color: var(--code-background) !important;
  border-bottom-color: transparent !important;
  align-items: center !important;
  font-family: var(--font-sans) !important;
  font-size: 12px !important;
  line-height: 1 !important;
  /* Collapsed items are never remeasured: the painted header must match diffHeaderHeight. */
  height: 32px !important;
  min-height: 32px !important;
  padding-block: 0 !important;
  padding-inline: 8px 12px !important;
}

[data-diffs-header]:hover {
  background-color: var(--code-background) !important;
  box-shadow: inset 3px 0 color-mix(in srgb, var(--code-foreground) 24%, transparent);
}

/* Exact and margin-free: the virtualizer places rows from hunkSeparatorHeight. */
:is([data-separator="line-info"], [data-separator="line-info-basic"]) {
  height: 24px !important;
  margin-block: 0 !important;
  --diffs-bg-separator: color-mix(in srgb, var(--code-background) 97%, var(--code-foreground));
}

:is([data-separator="line-info"], [data-separator="line-info-basic"]) [data-separator-content] {
  color: color-mix(in srgb, var(--code-foreground) 50%, var(--code-background)) !important;
  font-family: var(--font-sans) !important;
  font-size: 11px !important;
  text-decoration: none !important;
}

:is([data-separator="line-info"], [data-separator="line-info-basic"]) [data-expand-button] {
  color: color-mix(in srgb, var(--code-foreground) 50%, var(--code-background)) !important;
}

:is([data-separator="line-info"], [data-separator="line-info-basic"])[data-expand-index]
  :is([data-separator-content], [data-expand-button]):hover {
  color: var(--code-foreground) !important;
  background-color: color-mix(in srgb, var(--code-background) 92%, var(--code-foreground)) !important;
}

[data-diffs-header] [data-header-content] {
  align-items: center !important;
  line-height: 1 !important;
}

[data-diffs-header] :is([data-title], [data-prev-name]) {
  line-height: 16px !important;
}

[data-diffs-header] [data-metadata] {
  align-items: center !important;
  line-height: 1 !important;
  font-variant-numeric: tabular-nums;
}

[data-diffs-header] [data-additions-count],
[data-diffs-header] [data-deletions-count] {
  font-family: var(--font-mono) !important;
  font-size: 11px !important;
  font-variant-numeric: tabular-nums;
  line-height: 1 !important;
}

[data-diffs-header] [data-change-icon],
[data-diffs-header] [data-rename-icon] {
  display: block;
  flex-shrink: 0;
}

[data-title] {
  cursor: pointer;
  transition: color 120ms ease;
  font-family: var(--font-sans) !important;
}

[data-title]:hover {
  color: color-mix(in srgb, var(--code-foreground) 84%, var(--primary)) !important;
}

[data-diff],
[data-file] {
  transition: opacity 200ms ease-out;
}

@starting-style {
  [data-diff],
  [data-file] {
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  [data-diff],
  [data-file] {
    transition: none;
  }
}

[data-indicators="bars"] [data-line][data-line-type="change-deletion"]::before {
  content: "" / "Removed";
}
[data-indicators="bars"] [data-line][data-line-type="change-addition"]::before {
  content: "" / "Added";
}
`;
