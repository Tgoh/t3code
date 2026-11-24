import type { ServerProvider } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  instanceLimitPools,
  limitPresentations,
  limitTone,
  weeklyLimit,
  weeklyLimitTip,
  type ILimitSources,
} from "./limits";

const NOW_ISO = "2026-11-17T00:00:00.000Z";
const NOW = Date.parse(NOW_ISO);
const LABELS = { claudeAgent: "Claude Code" };

const claude = (windows: readonly object[], instance: object = { instanceId: "claudeAgent" }) =>
  ({
    instanceId: "claudeAgent",
    driver: "claudeAgent",
    enabled: true,
    installed: true,
    status: "ready",
    auth: { status: "authenticated", label: "Max" },
    models: [],
    usageLimits: { windows },
    ...instance,
  }) as unknown as ServerProvider;

const instances = (config: ILimitSources | null) =>
  instanceLimitPools(limitPresentations("env", "Local", config), NOW, LABELS);
const pools = (providers: readonly ServerProvider[]) => instances({ providers });

const DEFAULT_RESET = "2026-11-21T13:00:00.000Z";
const ALT_RESET = "2026-11-21T18:00:00.000Z";

const weekly = (usedPercent: number, resetsAt = DEFAULT_RESET) => ({
  id: "seven_day",
  kind: "weekly",
  label: "Weekly",
  usedPercent,
  windowDurationMins: 10080,
  resetsAt,
});

const fableAt = (usedPercent: number, resetsAt = DEFAULT_RESET) => ({
  id: "seven_day_fable",
  kind: "weekly",
  label: "Weekly · Fable",
  usedPercent,
  windowDurationMins: 10080,
  resetsAt,
});
const fable = fableAt(95);

const twoClaudes = () =>
  pools([
    claude([weekly(4, ALT_RESET), fableAt(20, ALT_RESET)], {
      instanceId: "claude_alt",
      displayName: "Claude Alt",
    }),
    claude([weekly(60), fable]),
  ]);

describe("weekly limit ring", () => {
  it.each([
    [0, "normal"],
    [74, "normal"],
    [75, "warning"],
    [89, "warning"],
    [90, "danger"],
    [100, "danger"],
  ] as const)("colours %i%% used as %s", (used, tone) => {
    expect(limitTone(used)).toBe(tone);
  });

  it("reads the overall weekly window, not a per-model one", () => {
    expect(weeklyLimit(pools([claude([fable, weekly(40)])]))).toEqual({
      UsedPercent: 40,
      RemainingPercent: 60,
      Tone: "normal",
    });
  });

  it("reads the Claude instance with the most weekly limit left", () => {
    expect(weeklyLimit(twoClaudes())).toEqual({
      UsedPercent: 4,
      RemainingPercent: 96,
      Tone: "normal",
    });
  });

  it("is missing without a Claude weekly window or a config", () => {
    expect(weeklyLimit(pools([claude([fable])]))).toBeNull();
    expect(weeklyLimit(instances(null))).toBeNull();
  });

  it("reads a usage-limit hub's accounts as well as the providers' own", () => {
    const hub = {
      id: "hub-1",
      kind: "cliproxy",
      label: "Hub",
      checkedAt: NOW_ISO,
      accounts: [
        {
          id: "max.json",
          driver: "claudeAgent",
          usageLimits: { checkedAt: NOW_ISO, windows: [weekly(30)] },
        },
      ],
    };
    const hubbed = instances({ providers: [], usageLimitSources: [hub] });
    expect(weeklyLimit(hubbed)).toMatchObject({ UsedPercent: 30 });
    expect(hubbed.map((instance) => instance.Label)).toEqual(["max · Hub"]);
  });

  it("tips the share left and the reset", () => {
    expect(weeklyLimitTip(pools([claude([weekly(40)])]), NOW)).toBe(
      "Weekly limit: 60% left · resets in 4d 13h",
    );
    expect(weeklyLimitTip(twoClaudes(), NOW)).toBe(
      "Claude Code: 40% left · resets in 4d 13h; Claude Alt: 96% left · resets in 4d 18h",
    );
    expect(weeklyLimitTip(pools([]), NOW)).toBe("Weekly limit not reported");
  });
});

describe("instance limit pools", () => {
  it("gives each provider instance its own labelled pool, in stock's account order", () => {
    expect(
      twoClaudes().map(({ Label, Pool }) => ({
        Label,
        Windows: Pool.windows.map((window) => ({
          Id: window.id,
          Left: window.remainingPercent,
          Resets: window.members.map((member) => member.window.resetsAt),
        })),
      })),
    ).toEqual([
      {
        Label: "Claude Code",
        Windows: [
          { Id: "seven_day", Left: 40, Resets: [DEFAULT_RESET] },
          { Id: "seven_day_fable", Left: 5, Resets: [DEFAULT_RESET] },
        ],
      },
      {
        Label: "Claude Alt",
        Windows: [
          { Id: "seven_day", Left: 96, Resets: [ALT_RESET] },
          { Id: "seven_day_fable", Left: 80, Resets: [ALT_RESET] },
        ],
      },
    ]);
  });
});
