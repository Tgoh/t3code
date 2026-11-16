import type { UsageTokenTotals } from "@t3tools/contracts";
import type { CategoryCost, SpeedCost } from "@t3tools/shared/usageMerge";

// Follows apps/web/src/components/usage/UsageProviderChart.tsx and usageBreakdown.ts.

export interface IPoint {
  X: number;
  Y: number;
}

export function niceScale(peak: number, count: number): { Max: number; Ticks: number[] } {
  if (peak <= 0) return { Max: 0, Ticks: [0] };
  const rawStep = peak / count;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  const step = (normalized > 5 ? 10 : normalized > 2 ? 5 : normalized > 1 ? 2 : 1) * magnitude;
  const max = Math.ceil(peak / step) * step;
  const ticks: number[] = [];
  for (let value = 0; value <= max + step * 1e-6; value += step) ticks.push(value);
  return { Max: max, Ticks: ticks };
}

function monotoneTangents(points: readonly IPoint[]): number[] {
  const count = points.length;
  if (count < 2) return [0];
  const slopes: number[] = [];
  for (let index = 0; index < count - 1; index += 1) {
    const dx = points[index + 1]!.X - points[index]!.X;
    const dy = points[index + 1]!.Y - points[index]!.Y;
    slopes.push(dx === 0 ? 0 : dy / dx);
  }
  const tangents = Array.from({ length: count }, () => 0);
  tangents[0] = slopes[0] ?? 0;
  tangents[count - 1] = slopes[count - 2] ?? 0;
  for (let index = 1; index < count - 1; index += 1) {
    const previous = slopes[index - 1]!;
    const next = slopes[index]!;
    tangents[index] = previous * next <= 0 ? 0 : (previous + next) / 2;
  }
  // Fritsch–Carlson limit: keeps the curve from overshooting between points.
  for (let index = 0; index < count - 1; index += 1) {
    const slope = slopes[index]!;
    if (slope === 0) {
      tangents[index] = 0;
      tangents[index + 1] = 0;
      continue;
    }
    const a = tangents[index]! / slope;
    const b = tangents[index + 1]! / slope;
    const magnitude = a * a + b * b;
    if (magnitude > 9) {
      const scale = 3 / Math.sqrt(magnitude);
      tangents[index] = scale * a * slope;
      tangents[index + 1] = scale * b * slope;
    }
  }
  return tangents;
}

/** A monotone cubic path through `points`, so it never dips below zero between days. */
export function smoothPath(points: readonly IPoint[]): string {
  if (points.length === 0) return "";
  const at = (point: IPoint) => `${point.X.toFixed(2)},${point.Y.toFixed(2)}`;
  if (points.length === 1) return `M${at(points[0]!)}`;
  const tangents = monotoneTangents(points);
  let path = `M${at(points[0]!)}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index]!;
    const to = points[index + 1]!;
    const dx = to.X - from.X;
    const c1 = { X: from.X + dx / 3, Y: from.Y + (tangents[index]! * dx) / 3 };
    const c2 = { X: to.X - dx / 3, Y: to.Y - (tangents[index + 1]! * dx) / 3 };
    path += ` C${at(c1)} ${at(c2)} ${at(to)}`;
  }
  return path;
}

export interface IShareSegment {
  Label: string;
  Value: number;
  Color: string;
}

const ink = (percent: number) =>
  `color-mix(in oklab, var(--foreground) ${percent}%, var(--background))`;

const TYPE_COLORS = {
  Input: ink(60),
  CacheRead: ink(30),
  CacheWrite: ink(72),
  Output: ink(100),
  Other: ink(44),
};

export const costTypeSegments = (cost: CategoryCost): IShareSegment[] => [
  { Label: "Input", Value: cost.input, Color: TYPE_COLORS.Input },
  { Label: "Cache read", Value: cost.cacheRead, Color: TYPE_COLORS.CacheRead },
  { Label: "Cache write", Value: cost.cacheWrite, Color: TYPE_COLORS.CacheWrite },
  { Label: "Output", Value: cost.output, Color: TYPE_COLORS.Output },
  { Label: "Other", Value: cost.unsplit >= 0.005 ? cost.unsplit : 0, Color: TYPE_COLORS.Other },
];

export const tokenTypeSegments = (
  tokens: Omit<UsageTokenTotals, "reasoningTokens">,
): IShareSegment[] => [
  { Label: "Input", Value: tokens.uncachedInputTokens, Color: TYPE_COLORS.Input },
  { Label: "Cache read", Value: tokens.cachedInputTokens, Color: TYPE_COLORS.CacheRead },
  { Label: "Cache write", Value: tokens.cacheCreationTokens, Color: TYPE_COLORS.CacheWrite },
  { Label: "Output", Value: tokens.outputTokens, Color: TYPE_COLORS.Output },
];

export const speedCostSegments = (cost: SpeedCost): IShareSegment[] => [
  { Label: "Standard", Value: cost.standard, Color: ink(34) },
  { Label: "Fast", Value: cost.fast, Color: ink(66) },
  { Label: "Ultrafast", Value: cost.ultrafast, Color: ink(100) },
];
