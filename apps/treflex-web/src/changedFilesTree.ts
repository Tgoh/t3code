import type { OrchestrationV2CheckpointFileSummary } from "@t3tools/contracts";

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
