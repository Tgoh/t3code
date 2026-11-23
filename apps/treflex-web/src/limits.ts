import {
  EnvironmentId,
  type ServerProvider,
  type UsageLimitSourceSnapshots,
} from "@t3tools/contracts";
import {
  collectLimitAccounts,
  collectLimitPools,
  type LimitPool,
  type LimitPresentations,
} from "@t3tools/shared/usageLimits";
import { formatResetsIn } from "@t3tools/shared/usageLimitsCopy";

export type ILimitTone = "normal" | "warning" | "danger";

export interface IWeeklyLimit {
  UsedPercent: number;
  RemainingPercent: number;
  Tone: ILimitTone;
}

/** The server's id for Claude's all-models weekly window, beside per-model ones such as `Weekly · Fable`. */
const CLAUDE_WEEKLY_ID = "seven_day";

/** The providers' own limits and the usage-limit hubs', as the server config holds them. */
export interface ILimitSources {
  providers: readonly unknown[];
  usageLimitSources?: readonly unknown[] | undefined;
}

export function limitPresentations(
  environmentId: string,
  label: string,
  config: ILimitSources | null,
): LimitPresentations {
  return new Map([
    [
      EnvironmentId.make(environmentId),
      {
        entry: { target: { label } },
        serverConfig:
          config === null
            ? null
            : {
                providers: config.providers as readonly ServerProvider[],
                usageLimitSources: config.usageLimitSources as
                  | UsageLimitSourceSnapshots
                  | undefined,
              },
      },
    ],
  ]);
}

export const limitPools = (presentations: LimitPresentations, now: number) =>
  collectLimitPools(collectLimitAccounts(presentations), now);

export function limitTone(usedPercent: number): ILimitTone {
  if (usedPercent >= 90) return "danger";
  if (usedPercent >= 75) return "warning";
  return "normal";
}

const claudeWeekly = (pools: readonly LimitPool[]) =>
  pools
    .find((pool) => pool.driver === "claudeAgent")
    ?.windows.find((window) => window.kind === "weekly" && window.id === CLAUDE_WEEKLY_ID);

export function weeklyLimit(pools: readonly LimitPool[]): IWeeklyLimit | null {
  const window = claudeWeekly(pools);
  if (window === undefined) return null;
  const used = Math.max(0, Math.min(100, window.usedPercent));
  return { UsedPercent: used, RemainingPercent: 100 - used, Tone: limitTone(used) };
}

export function weeklyLimitTip(pools: readonly LimitPool[], now: number): string {
  const window = claudeWeekly(pools);
  if (window === undefined) return "Weekly limit not reported";
  const resets =
    window.members[0] === undefined ? null : formatResetsIn(window.members[0].window, now);
  const left = `Weekly limit: ${Math.max(0, Math.min(100, window.remainingPercent))}% left`;
  return resets === null ? left : `${left} · ${resets}`;
}
