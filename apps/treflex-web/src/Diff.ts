import { type IActionGenerator, type IEntity } from "treflex";

import { threadDiffEffect } from "./Infrastructure/commandEffects";
import { serverError } from "./Infrastructure/serverError";
import { branchDiffEffect } from "./Infrastructure/sourceControlEffects";

export type IDiffScope = "turn" | "thread" | "branch";

/** The open diff panel. Opening another diff replaces it, which stops its load. */
export interface IDiffPanel extends IEntity {
  Scope: IDiffScope;
  ToTurnCount: number | null;
  Text: string | null;
  BaseRef?: string | null;
  Error?: string;
}

export type IDiffRequest =
  | { Scope: "turn" | "thread"; EnvironmentId: string; ThreadId: string; ToTurnCount: number }
  | { Scope: "branch"; EnvironmentId: string; Cwd: string };

export function* loadDiff(draft: IDiffPanel, request: IDiffRequest): IActionGenerator {
  try {
    if (request.Scope === "branch") {
      const diff = yield* branchDiffEffect({
        EnvironmentId: request.EnvironmentId,
        Cwd: request.Cwd,
      });
      draft.Text = diff.Diff;
      draft.BaseRef = diff.BaseRef;
    } else {
      draft.Text = yield* threadDiffEffect(request);
    }
  } catch (error) {
    draft.Error = serverError(error).message;
  }
}
