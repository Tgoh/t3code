import { EnvironmentId, type ServerProvider } from "@t3tools/contracts";
import {
  collectLimitAccounts,
  collectLimitPools,
  formatResetsIn,
  type LimitPool,
  type LimitPresentations,
} from "@t3tools/shared/usageLimits";

export type ILimitTone = "normal" | "warning" | "danger";

export interface IWeeklyLimit {
  UsedPercent: number;
  RemainingPercent: number;
  Tone: ILimitTone;
}

/** The server's id for Claude's all-models weekly window, beside per-model ones such as `Weekly · Fable`. */
const CLAUDE_WEEKLY_ID = "seven_day";

export function limitPresentations(
  environmentId: string,
  label: string,
  providers: readonly unknown[] | undefined,
): LimitPresentations {
  return new Map([
    [
      EnvironmentId.make(environmentId),
      {
        entry: { target: { label } },
        serverConfig:
          providers === undefined ? null : { providers: providers as readonly ServerProvider[] },
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

const hasReset = (window: LimitPool["windows"][number], now: number) =>
  window.members.length > 0 &&
  window.members.every((member) => {
    const at = Date.parse(member.window.resetsAt ?? "");
    return Number.isFinite(at) && at <= now;
  });

/** A window past its reset reads as unused until the server reports it again, minutes later. */
export function weeklyLimit(pools: readonly LimitPool[], now: number): IWeeklyLimit | null {
  const window = claudeWeekly(pools);
  if (window === undefined) return null;
  const used = hasReset(window, now) ? 0 : Math.max(0, Math.min(100, window.usedPercent));
  return { UsedPercent: used, RemainingPercent: 100 - used, Tone: limitTone(used) };
}

export function weeklyLimitTip(pools: readonly LimitPool[], now: number): string {
  const window = claudeWeekly(pools);
  if (window === undefined) return "Weekly limit not reported";
  const resets =
    window.members[0] === undefined ? null : formatResetsIn(window.members[0].window, now);
  const remaining = hasReset(window, now) ? 100 : window.remainingPercent;
  const left = `Weekly limit: ${Math.max(0, Math.min(100, remaining))}% left`;
  return resets === null ? left : `${left} · ${resets}`;
}
