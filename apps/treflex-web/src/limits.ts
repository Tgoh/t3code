import {
  normalizeProviderAccentColor,
  providerInstanceInitials,
} from "@t3tools/client-runtime/state/provider-instance-display";
import {
  EnvironmentId,
  type ServerProvider,
  type UsageLimitSourceSnapshots,
} from "@t3tools/contracts";
import {
  collectLimitAccounts,
  collectLimitPools,
  type LimitAccount,
  type LimitPool,
  type LimitPoolWindow,
  type LimitPresentations,
} from "@t3tools/shared/usageLimits";
import { formatResetsIn } from "@t3tools/shared/usageLimitsCopy";

import type { IInstanceBadge } from "./modelOptions";

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

export interface ILimitInstance {
  /** The instance's account key, stable while its figures change. */
  Key: string;
  Label: string;
  Pool: LimitPool;
  /** The bars' colour in place of the driver's. */
  Accent: string | undefined;
  Badge: IInstanceBadge | undefined;
}

// Follows AccountAvatar and PoolBar's segment colour in apps/web/src/components/usage/UsageLimitsPooled.tsx.
function instanceBranding(account: LimitAccount): Pick<ILimitInstance, "Accent" | "Badge"> {
  const accent = normalizeProviderAccentColor(account.accentColor);
  const badge =
    account.redeem === null || account.displayName === null
      ? undefined
      : {
          Name: account.displayName,
          Initials: providerInstanceInitials(account.displayName),
          ...(accent === undefined ? {} : { Accent: accent }),
        };
  return { Accent: accent, Badge: badge };
}

function instanceLabel(account: LimitAccount, driverLabels: Readonly<Record<string, string>>) {
  const name = account.displayName ?? driverLabels[account.driver] ?? String(account.driver);
  return account.environments.length === 0 && account.sourceLabel
    ? `${name} · ${account.sourceLabel}`
    : name;
}

/** One pool per provider instance, in stock's driver and account order. */
export function instanceLimitPools(
  presentations: LimitPresentations,
  now: number,
  driverLabels: Readonly<Record<string, string>>,
): readonly ILimitInstance[] {
  return collectLimitPools(collectLimitAccounts(presentations), now).flatMap((pool) =>
    pool.accounts.flatMap((account) =>
      collectLimitPools([account], now).map((own) => ({
        Key: account.key,
        Label: instanceLabel(account, driverLabels),
        Pool: own,
        ...instanceBranding(account),
      })),
    ),
  );
}

export function limitTone(usedPercent: number): ILimitTone {
  if (usedPercent >= 90) return "danger";
  if (usedPercent >= 75) return "warning";
  return "normal";
}

const claudeWeeklies = (instances: readonly ILimitInstance[]) =>
  instances.flatMap((instance) => {
    if (instance.Pool.driver !== "claudeAgent") return [];
    const window = instance.Pool.windows.find(
      (candidate) => candidate.kind === "weekly" && candidate.id === CLAUDE_WEEKLY_ID,
    );
    return window === undefined ? [] : [{ Label: instance.Label, Window: window }];
  });

const percent = (value: number) => Math.max(0, Math.min(100, value));

/** The Claude instance with the most weekly limit left. */
export function weeklyLimit(instances: readonly ILimitInstance[]): IWeeklyLimit | null {
  const most = claudeWeeklies(instances).reduce<LimitPoolWindow | null>(
    (best, { Window }) =>
      best === null || Window.remainingPercent > best.remainingPercent ? Window : best,
    null,
  );
  if (most === null) return null;
  const used = percent(most.usedPercent);
  return { UsedPercent: used, RemainingPercent: 100 - used, Tone: limitTone(used) };
}

export function weeklyLimitTip(instances: readonly ILimitInstance[], now: number): string {
  const weeklies = claudeWeeklies(instances);
  if (weeklies.length === 0) return "Weekly limit not reported";
  return weeklies
    .map(({ Label, Window }) => {
      const member = Window.members[0];
      const resets = member === undefined ? null : formatResetsIn(member.window, now);
      const left = `${weeklies.length === 1 ? "Weekly limit" : Label}: ${percent(Window.remainingPercent)}% left`;
      return resets === null ? left : `${left} · ${resets}`;
    })
    .join("; ");
}
