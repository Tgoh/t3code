export type IAddProjectSourceId = "new" | "local" | "url";

export interface IAddProjectSource {
  Id: IAddProjectSourceId;
  Title: string;
  Description: string;
  Terms: string[];
}

// Follows buildAddProjectSourceGroups in apps/web/src/components/CommandPalette.tsx, without the
// hosting-provider sources, which need repository lookup this client doesn't have.
export function addProjectSources(hasNewProjectsRoot: boolean): IAddProjectSource[] {
  return [
    ...(hasNewProjectsRoot
      ? [
          {
            Id: "new" as const,
            Title: "New project",
            Description: "Start a new Git repository from a name",
            Terms: ["new project", "create", "empty", "repository", "git init"],
          },
        ]
      : []),
    {
      Id: "local",
      Title: "Local folder",
      Description: "Browse a folder on disk",
      Terms: ["local", "folder", "directory", "browse"],
    },
    {
      Id: "url",
      Title: "Git URL",
      Description: "Clone from a remote URL",
      Terms: ["clone", "remote", "repository", "repo", "git"],
    },
  ];
}

export function filterSources(
  sources: ReadonlyArray<IAddProjectSource>,
  query: string,
): IAddProjectSource[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [...sources];
  return sources.filter((source) =>
    [source.Title, ...source.Terms].some((term) => term.toLowerCase().includes(needle)),
  );
}

// Moves the highlight through `count` rows, wrapping at the ends. With nothing highlighted,
// down starts at the first row and up at the last.
export function stepHighlight(current: number | null, count: number, delta: 1 | -1): number | null {
  if (count === 0) return null;
  if (current === null) return delta === 1 ? 0 : count - 1;
  return (current + delta + count) % count;
}

// Follows willCreateProjectPath in apps/web/src/components/CommandPalette.tsx.
export function willCreateFolder(input: {
  query: string;
  pending: boolean;
  highlighted: boolean;
  trailingSeparator: boolean;
  listed: boolean;
  exactMatch: boolean;
}): boolean {
  if (input.pending || input.highlighted || input.query.trim() === "") return false;
  return input.trailingSeparator ? !input.listed : !input.exactMatch;
}

// Follows submitActionLabel in apps/web/src/components/CommandPalette.tsx.
export function browseSubmitLabel(clone: boolean, willCreate: boolean): string {
  if (clone) return willCreate ? "Create & Clone" : "Clone";
  return willCreate ? "Create & Add" : "Add";
}
