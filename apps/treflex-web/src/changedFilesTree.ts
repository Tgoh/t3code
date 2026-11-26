import {
  changedFileTotals,
  repositoryFilePath,
  type TurnChangesSource,
} from "@t3tools/client-runtime/state/thread-repositories";
import type {
  OrchestrationV2CheckpointFileSummary,
  OrchestrationV2CheckpointFileTotals,
} from "@t3tools/contracts";

/** One folder's share of a turn that changed tracked repositories. */
export interface IChangedFilesGroup {
  Key: string;
  Name: string;
  /** Paths relative to this group's folder. */
  Files: ReadonlyArray<
    Pick<OrchestrationV2CheckpointFileSummary, "path" | "additions" | "deletions">
  >;
  Totals: OrchestrationV2CheckpointFileTotals;
  /** The folder from the thread's folder; undefined when the diff can't be opened at a file. */
  RelativePath: string | undefined;
  /** Shown in place of the files when they can't be listed. */
  Note: string | null;
}

/**
 * Follows `AssistantChangedFilesSectionInner` in stock's TimelineAssistantRows.tsx: null for a turn
 * without repositories, which lists its own files as one tree.
 */
export function changedFilesGroups(
  turn: TurnChangesSource,
  rootName: string,
): IChangedFilesGroup[] | null {
  if (turn.repositories === undefined) return null;
  return [
    ...(turn.files.length === 0
      ? []
      : [
          {
            Key: ".",
            Name: rootName,
            Files: turn.files,
            Totals: changedFileTotals(turn),
            RelativePath: "",
            Note: null,
          },
        ]),
    ...turn.repositories.map((repository) => ({
      Key: repository.scopeId as string,
      Name: repository.name,
      Files: repository.files,
      Totals: changedFileTotals(repository),
      RelativePath: repository.relativePath,
      Note: repository.baselineMissing
        ? "This turn's changes in this repository cannot be listed."
        : null,
    })),
  ];
}

/** A group's file as the turn diff names it, from the thread's folder. */
export function groupDiffPath(group: IChangedFilesGroup, path: string): string | null {
  return group.RelativePath === undefined ? null : repositoryFilePath(group.RelativePath, path);
}

export interface IDiffStat {
  additions: number;
  deletions: number;
}

export interface IChangedDirectory {
  kind: "directory";
  name: string;
  path: string;
  stat: IDiffStat;
  children: IChangedNode[];
}

export interface IChangedFile {
  kind: "file";
  name: string;
  path: string;
  stat: IDiffStat;
}

export type IChangedNode = IChangedDirectory | IChangedFile;

export interface IChangedRow {
  node: IChangedNode;
  depth: number;
}

interface IMutableDirectory {
  name: string;
  path: string;
  stat: IDiffStat;
  directories: Map<string, IMutableDirectory>;
  files: IChangedFile[];
}

let collator: Intl.Collator | undefined;

function compareByName(a: { name: string }, b: { name: string }): number {
  collator ??= new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  return collator.compare(a.name, b.name);
}

function compact(node: IChangedDirectory): IChangedDirectory {
  let held = node;
  while (held.children.length === 1 && held.children[0]?.kind === "directory") {
    const only = held.children[0];
    held = { ...only, name: `${held.name}/${only.name}` };
  }
  return held;
}

function toNodes(directory: IMutableDirectory): IChangedNode[] {
  const directories = Array.from(directory.directories.values())
    .toSorted(compareByName)
    .map((child) =>
      compact({
        kind: "directory",
        name: child.name,
        path: child.path,
        stat: child.stat,
        children: toNodes(child),
      }),
    );
  return [...directories, ...directory.files.toSorted(compareByName)];
}

/** Follows `buildTurnDiffTree` in stock's apps/web/src/lib/turnDiffTree.ts. */
export function buildChangedFilesTree(
  files: ReadonlyArray<
    Pick<OrchestrationV2CheckpointFileSummary, "path" | "additions" | "deletions">
  >,
): IChangedNode[] {
  const root: IMutableDirectory = {
    name: "",
    path: "",
    stat: { additions: 0, deletions: 0 },
    directories: new Map(),
    files: [],
  };
  for (const file of files) {
    const segments = file.path.split("/").filter((segment) => segment.length > 0);
    const name = segments.at(-1);
    if (name === undefined) continue;
    const stat = { additions: file.additions, deletions: file.deletions };
    let current = root;
    for (const segment of segments.slice(0, -1)) {
      let next = current.directories.get(segment);
      if (next === undefined) {
        next = {
          name: segment,
          path: current.path ? `${current.path}/${segment}` : segment,
          stat: { additions: 0, deletions: 0 },
          directories: new Map(),
          files: [],
        };
        current.directories.set(segment, next);
      }
      current = next;
      current.stat.additions += stat.additions;
      current.stat.deletions += stat.deletions;
    }
    current.files.push({ kind: "file", name, path: segments.join("/"), stat });
  }
  return toNodes(root);
}

/**
 * Follows `collectExpandedRows` in stock's ChangedFilesTree.tsx: a folder's own toggle wins over
 * the card's all-folders state.
 */
export function visibleChangedRows(
  nodes: ReadonlyArray<IChangedNode>,
  overrides: Readonly<Record<string, boolean>>,
  allExpanded: boolean,
  depth = 0,
  rows: IChangedRow[] = [],
): IChangedRow[] {
  for (const node of nodes) {
    rows.push({ node, depth });
    if (node.kind === "directory" && (overrides[node.path] ?? allExpanded)) {
      visibleChangedRows(node.children, overrides, allExpanded, depth + 1, rows);
    }
  }
  return rows;
}
