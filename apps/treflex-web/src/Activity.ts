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
  transient,
} from "treflex";

import type { IEnvironment } from "./Environment";
import { type IDeviceActivity, reportActivityEffect } from "./Infrastructure/clientActivity";

declare module "treflex" {
  interface IResourceRegistry {
    "Device/Activity": { Type: "deviceActivity" };
  }
  interface ITimerRegistry {
    "Activity/Report": {};
  }
}

const deviceActivity = (draft: IEnvironment) =>
  transient<IDeviceActivity>(draft, "Activity/Device", {
    Visible: false,
    Focused: false,
    RecentlyInteracted: false,
  });

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

function scopes(draft: IEnvironment): BackgroundScope[] {
  const held: BackgroundScope[] = [{ type: "provider-status" }];
  for (const session of Object.values(draft.Local.ThreadSessions)) {
    const cwd = session.Details?.Cwd;
    if (cwd !== undefined) held.push({ type: "vcs-status", cwd });
  }
  return held;
}

export function* reportActivity(draft: IEnvironment): IOpenGenerator {
  const report = reportActivityEffect({
    EnvironmentId: draft.EnvironmentId,
    ...(yield* deviceActivity(draft)),
    Scopes: scopes(draft),
  });
  yield* open(report);
}

export const ActivityReceiver = receiver<IEnvironment>("ActivityReceiver")({
  "Activity/Report": reportActivity,
  *"Device/Activity"(draft, message) {
    if (isEnded(message)) return;
    Object.assign(yield* deviceActivity(draft), {
      Visible: message.Visible,
      Focused: message.Focused,
      RecentlyInteracted: message.RecentlyInteracted,
    });
    yield* start(reportActivity, draft);
  },
});
