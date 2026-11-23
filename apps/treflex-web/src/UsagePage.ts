// @effect-diagnostics globalDate:off -- View-only usage windows, outside any Effect runtime.
import { makeWindow } from "@t3tools/shared/usageFormat";
import { type IEntity, type IOpenGenerator, latest, open, workTag } from "treflex";
import { createComponentFeature } from "treflex-solid";
import { createSignal, onSettled } from "solid-js";

import {
  type IWireUsageInput,
  type IWireUsageSummary,
  refreshProvidersEffect,
  refreshUsageRatesEffect,
  usageSummaryEffect,
} from "./Infrastructure/settings";

export interface IUsagePage extends IEntity {
  Usage: { Key: string; Summary: IWireUsageSummary } | null;
}

export function getDefaultUsagePage(): Omit<IUsagePage, "$Id"> {
  return { Usage: null };
}

// Follows the provisional read in packages/client-runtime/src/state/server.ts (usage summary query).
export function* loadUsage(
  draft: IUsagePage,
  environmentId: string,
  key: string,
  input: IWireUsageInput,
): IOpenGenerator {
  const read = (extra: Partial<IWireUsageInput>) =>
    open(usageSummaryEffect({ EnvironmentId: environmentId, Input: { ...input, ...extra } }));
  let summary = yield* read({ provisional: true });
  draft.Usage = { Key: key, Summary: summary };
  if (!summary.sources.some((source) => source.refreshing === true)) return;
  summary = yield* read({ awaitRefresh: true });
  draft.Usage = { Key: key, Summary: summary };
}
latest(loadUsage);

/**
 * Limits ask the server to re-probe its providers, whose new limits arrive on the config stream;
 * anything else refreshes prices and reads the window again.
 */
export function* refreshUsage(
  draft: IUsagePage,
  environmentId: string,
  usage: { Key: string; Input: IWireUsageInput } | null,
): IOpenGenerator {
  if (usage === null) {
    yield* open(refreshProvidersEffect({ EnvironmentId: environmentId, Automatic: false }));
    return;
  }
  yield* open(refreshUsageRatesEffect({ EnvironmentId: environmentId }));
  yield* loadUsage(draft, environmentId, usage.Key, usage.Input);
}
export const RefreshingUsage = workTag("Usage/Refreshing");
RefreshingUsage.mark(refreshUsage, loadUsage);

// Follows the automatic refresh in apps/web/src/components/usage/UsagePage.tsx, which runs when
// the limits show and skips an environment refreshed in the last five minutes.
export function* autoRefreshLimits(_draft: IEntity, environmentId: string): IOpenGenerator {
  yield* open(refreshProvidersEffect({ EnvironmentId: environmentId, Automatic: true }));
}

const UsagePage = createComponentFeature<IUsagePage>("Settings/UsagePage")(
  { loadUsage, refreshUsage, autoRefreshLimits },
  {},
);
export default UsagePage;

export const windowInput = (days: number): IWireUsageInput =>
  makeWindow(days, new Date(), days === 1 ? "hour" : "day") as IWireUsageInput;

export function useUsagePage(environmentId: string, opening: { Days: number; Limits: boolean }) {
  const page = UsagePage.use();
  const [input, setInput] = createSignal(windowInput(opening.Days));
  const load = (days: number) => {
    const next = windowInput(days);
    setInput(next);
    void page.loadUsage(environmentId, String(days), next);
  };
  onSettled(() => {
    load(opening.Days);
    if (opening.Limits) void page.autoRefreshLimits(environmentId);
  });
  return { page, input, load };
}
