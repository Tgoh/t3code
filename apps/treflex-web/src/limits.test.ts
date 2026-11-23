import type { ServerProvider } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { limitPools, limitPresentations, limitTone, weeklyLimit, weeklyLimitTip } from "./limits";

const NOW_ISO = "2026-11-17T00:00:00.000Z";
const NOW = Date.parse(NOW_ISO);

const claude = (windows: readonly object[]) =>
  ({
    instanceId: "claudeAgent",
    driver: "claudeAgent",
    enabled: true,
    installed: true,
    status: "ready",
    auth: { status: "authenticated", label: "Max" },
    models: [],
    usageLimits: { windows },
  }) as unknown as ServerProvider;

const pools = (providers: readonly ServerProvider[]) =>
  limitPools(limitPresentations("env", "Local", { providers }), NOW);

const weekly = (usedPercent: number) => ({
  id: "seven_day",
  kind: "weekly",
  label: "Weekly",
  usedPercent,
  windowDurationMins: 10080,
  resetsAt: "2026-11-21T13:00:00.000Z",
});

const fable = {
  id: "seven_day_fable",
  kind: "weekly",
  label: "Weekly · Fable",
  usedPercent: 95,
  windowDurationMins: 10080,
  resetsAt: "2026-11-21T13:00:00.000Z",
};

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

  it("is missing without a Claude weekly window or a config", () => {
    expect(weeklyLimit(pools([claude([fable])]))).toBeNull();
    expect(weeklyLimit(limitPools(limitPresentations("env", "Local", null), NOW))).toBeNull();
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
    const presentations = limitPresentations("env", "Local", {
      providers: [],
      usageLimitSources: [hub],
    });
    expect(weeklyLimit(limitPools(presentations, NOW))).toMatchObject({ UsedPercent: 30 });
  });

  it("tips the share left and the reset", () => {
    expect(weeklyLimitTip(pools([claude([weekly(40)])]), NOW)).toBe(
      "Weekly limit: 60% left · resets in 4d 13h",
    );
    expect(weeklyLimitTip(pools([]), NOW)).toBe("Weekly limit not reported");
  });
});
