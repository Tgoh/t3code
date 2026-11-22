import type { ServerProvider } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { limitPools, limitPresentations, limitTone, weeklyLimit, weeklyLimitTip } from "./limits";

const NOW = Date.parse("2026-11-17T00:00:00.000Z");

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
  limitPools(limitPresentations("env", "Local", providers), NOW);

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
    expect(weeklyLimit(pools([claude([fable, weekly(40)])]), NOW)).toEqual({
      UsedPercent: 40,
      RemainingPercent: 60,
      Tone: "normal",
    });
  });

  it("shows a window that has reset as unused, from the clock alone", () => {
    const presentations = limitPresentations("env", "Local", [claude([weekly(95)])]);
    const after = Date.parse("2026-11-21T13:01:00.000Z");
    expect(weeklyLimit(limitPools(presentations, after), after)).toMatchObject({
      UsedPercent: 0,
      Tone: "normal",
    });
    expect(weeklyLimitTip(limitPools(presentations, after), after)).toBe(
      "Weekly limit: 100% left · resets now",
    );
  });

  it("is missing without a Claude weekly window or a config", () => {
    expect(weeklyLimit(pools([claude([fable])]), NOW)).toBeNull();
    expect(
      weeklyLimit(limitPools(limitPresentations("env", "Local", undefined), NOW), NOW),
    ).toBeNull();
  });

  it("tips the share left and the reset", () => {
    expect(weeklyLimitTip(pools([claude([weekly(40)])]), NOW)).toBe(
      "Weekly limit: 60% left · resets in 4d 13h",
    );
    expect(weeklyLimitTip(pools([]), NOW)).toBe("Weekly limit not reported");
  });
});
