import type { BackgroundScope } from "@t3tools/contracts";
import {
  type IActionGenerator,
  type IOpenGenerator,
  isEnded,
  open,
  openResource,
  receiver,
  start,
  startTimer,
} from "treflex";

import type { IEnvironment } from "./Environment";
import { reportActivityEffect } from "./Infrastructure/clientActivity";

declare module "treflex" {
  interface IResourceRegistry {
    "Device/Activity": { Type: "deviceActivity" };
  }
  interface ITimerRegistry {
    "Activity/Report": {};
  }
}

/** Shorter than the server's 45 s lease, so a lease never lapses between reports. */
const REPORT_INTERVAL_MS = 25_000;

/**
 * Follows apps/web/src/lib/backgroundActivityReporter.ts: the server refreshes provider status
 * and git status in the background only for scopes a client holds a live lease on.
 */
export function* followActivity(draft: IEnvironment): IActionGenerator {
  yield* startTimer(draft, "Activity/Report", ActivityReceiver, REPORT_INTERVAL_MS);
  yield* openResource(draft, "Device/Activity", ActivityReceiver, { Type: "deviceActivity" });
}

// ThreadDetails holds the git status stream, and ThreadView mounts it under these same
// conditions: change both together.
function scopes(draft: IEnvironment): BackgroundScope[] {
  const held: BackgroundScope[] = [{ type: "provider-status" }];
  const id = draft.Local.SelectedThreadId;
  if (draft.Local.View !== null || id === null) return held;
  const thread = draft.Replica.OpenThreads[id]?.Thread;
  const project = thread == null ? undefined : draft.Replica.Shell.Projects[thread.projectId];
  if (thread == null || project === undefined) return held;
  return [...held, { type: "vcs-status", cwd: thread.worktreePath ?? project.workspaceRoot }];
}

function* reportActivity(draft: IEnvironment): IOpenGenerator {
  const report = reportActivityEffect({
    EnvironmentId: draft.EnvironmentId,
    ...draft.Local.Activity,
    Scopes: scopes(draft),
  });
  yield* open(report);
}

export const ActivityReceiver = receiver<IEnvironment>("ActivityReceiver")({
  "Activity/Report": reportActivity,
  *"Device/Activity"(draft, message) {
    if (isEnded(message)) return;
    draft.Local.Activity = {
      Visible: message.Visible,
      Focused: message.Focused,
      RecentlyInteracted: message.RecentlyInteracted,
    };
    yield* start(reportActivity, draft);
  },
});
