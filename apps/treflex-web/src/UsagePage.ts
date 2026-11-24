// @effect-diagnostics globalDate:off -- Usage windows from the clockNow effect, outside any Effect runtime.
import { makeWindow } from "@t3tools/shared/usageFormat";
import { type IEntity, type IOpenGenerator, latest, open, workTag } from "treflex";
import { createEntityFeature } from "treflex-solid";

import { clockNowEffect } from "./Infrastructure/preferences";
import {
  type IWireUsageInput,
  type IWireUsageSummary,
  refreshProvidersEffect,
  refreshUsageRatesEffect,
  usageSummaryEffect,
} from "./Infrastructure/settings";

// Follows apps/web/src/components/usage/usageShortcuts.ts and usageProviders.ts.
export type IUsageMetric = "cost" | "tokens" | "limits";
export const METRICS: readonly IUsageMetric[] = ["cost", "tokens", "limits"];
export const WINDOW_DAYS: readonly number[] = [1, 7, 30, 90];

export const usageMetric = (held: string): IUsageMetric =>
  METRICS.find((metric) => metric === held) ?? "limits";

export const usageDays = (held: number): number => (WINDOW_DAYS.includes(held) ? held : 30);

interface IUsageWindow {
  Days: number;
  Input: IWireUsageInput;
}

/** The Usage page's reads, which `showView` makes as the page opens and removes as it closes. */
export interface IUsagePage extends IEntity {
  EnvironmentId: string;
  /** The window last asked for; `Usage` holds an earlier one's until its read lands. */
  Window: IUsageWindow | null;
  Usage: (IUsageWindow & { Summary: IWireUsageSummary }) | null;
}

export function getDefaultUsagePage(environmentId: string): Omit<IUsagePage, "$Id"> {
  return { EnvironmentId: environmentId, Window: null, Usage: null };
}

// Follows the provisional read in packages/client-runtime/src/state/server.ts (usage summary query).
function* readWindow(draft: IUsagePage, window: IUsageWindow): IOpenGenerator {
  const asked = JSON.stringify(window);
  const current = () => draft.Window !== null && JSON.stringify(draft.Window) === asked;
  const read = (extra: Partial<IWireUsageInput>) =>
    open(
      usageSummaryEffect({
        EnvironmentId: draft.EnvironmentId,
        Input: { ...window.Input, ...extra },
      }),
    );
  let summary = yield* read({ provisional: true });
  if (!current()) return;
  draft.Usage = { Days: window.Days, Input: { ...window.Input }, Summary: summary };
  if (!summary.sources.some((source) => source.refreshing === true)) return;
  summary = yield* read({ awaitRefresh: true });
  if (!current()) return;
  draft.Usage = { Days: window.Days, Input: { ...window.Input }, Summary: summary };
}

export function* loadUsage(draft: IUsagePage, days: number): IOpenGenerator {
  const now = yield* clockNowEffect();
  const window = {
    Days: days,
    Input: makeWindow(days, new Date(now), days === 1 ? "hour" : "day") as IWireUsageInput,
  };
  draft.Window = window;
  yield* readWindow(draft, window);
}
latest(loadUsage);

/**
 * Limits ask the server to re-probe its providers, whose new limits arrive on the config stream;
 * anything else refreshes prices and reads the held window again.
 */
export function* refreshUsage(draft: IUsagePage, limits: boolean): IOpenGenerator {
  const environmentId = draft.EnvironmentId;
  if (limits) {
    yield* open(refreshProvidersEffect({ EnvironmentId: environmentId, Automatic: false }));
    return;
  }
  yield* open(refreshUsageRatesEffect({ EnvironmentId: environmentId }));
  const window = draft.Window;
  if (window !== null) yield* readWindow(draft, { Days: window.Days, Input: { ...window.Input } });
}
export const RefreshingUsage = workTag("Usage/Refreshing");
RefreshingUsage.mark(refreshUsage, loadUsage);

export default createEntityFeature<IUsagePage>("UsagePage")({ refreshUsage }, {});
