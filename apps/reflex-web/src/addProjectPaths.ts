import {
  getAddProjectInitialQuery,
  getCloneDestinationBrowsePath,
  getCloneDestinationPath,
  getCloneDirectoryPath,
} from "@t3tools/client-runtime/operations/projects";
import {
  filterFilesystemBrowseEntries,
  getFilesystemBrowsePath,
} from "@t3tools/client-runtime/state/filesystem";
import {
  appendBrowsePathSegment,
  hasTrailingPathSeparator,
  isExplicitRelativeProjectPath,
  isWindowsPlatform,
} from "@t3tools/client-runtime/state/projects";

import type { IAddProjectSettings, IFolderListing } from "./Infrastructure/commandEffects";

type IFolderEntry = IFolderListing["Entries"][number];

// Follows getEnvironmentBrowsePlatform in apps/web/src/components/CommandPalette.logic.ts.
export function browsePlatform(os: string): string {
  if (os === "windows") return "Win32";
  if (os === "darwin") return "MacIntel";
  if (os === "linux") return "Linux";
  return typeof navigator === "undefined" ? "" : navigator.platform;
}

// Follows filterPinnedBrowseEntries in apps/web/src/components/CommandPalette.logic.ts.
export function filterPinnedBrowseEntries(input: {
  entries: ReadonlyArray<IFolderEntry>;
  filterQuery: string;
  pinnedName: string;
  caseSensitive: boolean;
}): { visibleEntries: IFolderEntry[]; exactEntry: IFolderEntry | null } {
  const namesMatch = (left: string, right: string) =>
    input.caseSensitive ? left === right : left.toLowerCase() === right.toLowerCase();
  const visibleFilterQuery = namesMatch(input.filterQuery, input.pinnedName)
    ? ""
    : input.filterQuery;
  const { visibleEntries } = filterFilesystemBrowseEntries(input.entries, visibleFilterQuery);
  const normalizedFilterQuery = input.filterQuery.normalize("NFC");
  const normalizedMatches = input.entries.filter((entry) =>
    namesMatch(entry.name.normalize("NFC"), normalizedFilterQuery),
  );
  const exactEntry =
    input.filterQuery.length > 0
      ? (input.entries.find((entry) => namesMatch(entry.name, input.filterQuery)) ??
        (normalizedMatches.length === 1 ? normalizedMatches[0]! : null))
      : null;
  return { visibleEntries, exactEntry };
}

// Follows hasBrowseTarget in apps/web/src/components/CommandPalette.tsx.
export function browseTarget(query: string, platform: string, cwd: string | null): string {
  const browse = getFilesystemBrowsePath(query, platform);
  if (!browse.isBrowsing) return "";
  if (cwd === null && isExplicitRelativeProjectPath(query.trim())) return "";
  return browse.directoryPath;
}

export function folderChoices(input: {
  query: string;
  platform: string;
  entries: ReadonlyArray<IFolderEntry>;
  cloneFolder: string;
}) {
  const browse = getFilesystemBrowsePath(input.query, input.platform);
  const { visibleEntries, exactEntry } =
    input.cloneFolder === ""
      ? filterFilesystemBrowseEntries(input.entries, browse.filterQuery)
      : filterPinnedBrowseEntries({
          entries: input.entries,
          filterQuery: browse.filterQuery,
          pinnedName: input.cloneFolder,
          caseSensitive: !isWindowsPlatform(input.platform),
        });
  return { browse, visibleEntries, exactEntry: exactEntry ?? null };
}

// Follows browseTo in apps/web/src/components/CommandPalette.tsx.
export function enterFolder(input: {
  query: string;
  directoryPath: string;
  name: string;
  cloneFolder: string;
  platform: string;
}): string {
  return input.cloneFolder === ""
    ? appendBrowsePathSegment(input.query, input.name)
    : getCloneDestinationBrowsePath({
        browseDirectoryPath: input.directoryPath,
        selectedDirectoryName: input.name,
        cloneDirectoryName: input.cloneFolder,
        caseSensitive: !isWindowsPlatform(input.platform),
      });
}

// Follows browseUp in apps/web/src/components/CommandPalette.tsx.
export function leaveFolder(parentPath: string, cloneFolder: string): string {
  return getCloneDestinationPath(parentPath, cloneFolder);
}

// Follows resolvedAddProjectPath in apps/web/src/components/CommandPalette.tsx.
export function chosenFolder(
  query: string,
  listing: IFolderListing | null,
  exactEntry: IFolderEntry | null,
): string {
  return hasTrailingPathSeparator(query)
    ? (listing?.ParentPath ?? query.trim())
    : (exactEntry?.fullPath ?? query.trim());
}

export function initialFolderQuery(settings: Pick<IAddProjectSettings, "BaseDirectory">): string {
  return getAddProjectInitialQuery(settings.BaseDirectory);
}

// Follows getDefaultCloneDestination in apps/web/src/components/CommandPalette.tsx.
export function defaultCloneDestination(
  settings: Pick<IAddProjectSettings, "BaseDirectory" | "GhqCloneLayout">,
  remoteUrl: string,
): string {
  return getCloneDestinationPath(
    initialFolderQuery(settings),
    getCloneDirectoryPath(remoteUrl, settings.GhqCloneLayout),
  );
}
