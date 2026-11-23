import { CHECKPOINT_DIFF_TRUNCATED_MARKER } from "@t3tools/contracts";
import { type IActionGenerator, type IEntity, latest } from "treflex";

import { type IRepositoryDiff, threadDiffEffect } from "./Infrastructure/commandEffects";
import { serverError } from "./Infrastructure/serverError";
import { branchDiffEffect } from "./Infrastructure/sourceControlEffects";

/** Stock's diff scopes: a turn, the branch's changes ("Changes"), or what isn't committed. */
export type IDiffScope = "turn" | "branch" | "unstaged";

/** The open diff panel. Opening another scope replaces it, which stops its load. */
export interface IDiffPanel extends IEntity {
  Scope: IDiffScope;
  TurnCount: number | null;
  Latest: boolean;
  /** The repository section a turn diff shows, by key; null shows them all. */
  Repository: string | null;
  /** The tracked repository the branch and working tree scopes read; null is the thread's folder. */
  GitRepository: string | null;
  IgnoreWhitespace: boolean;
  /** Files collapsed or expanded by hand, by file key; the rest follow the setting. */
  Collapsed: Record<string, boolean>;
  Text: string | null;
  Repositories: IRepositoryDiff[];
  HeadRef?: string | null;
  BaseRef?: string | null;
  Truncated?: boolean;
  Error?: string;
}

export type IDiffRequest =
  | { Scope: "turn"; EnvironmentId: string; ThreadId: string; ToTurnCount: number }
  | { Scope: "branch" | "unstaged"; EnvironmentId: string; Cwd: string };

export function* loadDiff(draft: IDiffPanel, request: IDiffRequest): IActionGenerator {
  try {
    if (request.Scope === "turn") {
      const diff = yield* threadDiffEffect({
        EnvironmentId: request.EnvironmentId,
        ThreadId: request.ThreadId,
        FromTurnCount: Math.max(0, request.ToTurnCount - 1),
        ToTurnCount: request.ToTurnCount,
        IgnoreWhitespace: draft.IgnoreWhitespace,
      });
      draft.Text = diff.Diff;
      draft.Repositories = diff.Repositories;
      draft.Truncated = [diff.Diff, ...diff.Repositories.map((held) => held.diff)].some((patch) =>
        patch.endsWith(CHECKPOINT_DIFF_TRUNCATED_MARKER),
      );
    } else {
      const diff = yield* branchDiffEffect({
        EnvironmentId: request.EnvironmentId,
        Cwd: request.Cwd,
        Source: request.Scope === "branch" ? "branch-range" : "working-tree",
        IgnoreWhitespace: draft.IgnoreWhitespace,
      });
      draft.Text = diff.Diff;
      draft.HeadRef = diff.HeadRef;
      draft.BaseRef = diff.BaseRef;
      draft.Truncated = diff.Truncated;
    }
    delete draft.Error;
  } catch (error) {
    draft.Error = serverError(error).message;
  }
}
latest(loadDiff);
