import {
  EnvironmentId,
  USAGE_CONTRACT_VERSION,
  type UsageProviderKind,
  type UsageSummary,
} from "@t3tools/contracts";
import {
  enumerateDays,
  enumerateHourStarts,
  formatCount,
  formatDayShort,
  formatHourShort,
  formatPercent,
  formatTokens,
  formatUsd,
  usageSourceMessages,
} from "@t3tools/shared/usageFormat";
import { displayLimitWindows, type LimitPace, type LimitPool } from "@t3tools/shared/usageLimits";
import { collectLimitNotices, formatResetsIn } from "@t3tools/shared/usageLimitsCopy";
import {
  type DailyTotals,
  type HourlyTotals,
  isModelCostUnknown,
  type MergedUsage,
  mergeUsage,
} from "@t3tools/shared/usageMerge";
import { useInFlight } from "treflex-solid";
import { createMemo, createSignal, For, Show } from "solid-js";

import { ProviderIcon } from "./brand";
import Environment from "./Environment";
import { ChartNoAxesColumn, RefreshCw, X } from "./icons";
import type { IWireUsageInput } from "./Infrastructure/settings";
import { limitPools, limitPresentations } from "./limits";
import UsagePage, { getDefaultUsagePage, RefreshingUsage, useUsagePage } from "./UsagePage";
import { SidebarToggle } from "./Sidebar";
import { clockNow } from "./timestamps";
import { IconButton } from "./ui/IconButton";
import { BREADCRUMB, CRUMB_MUTED, CRUMB_SEPARATOR, CRUMB_TITLE, PageHeader } from "./ui/PageHeader";
import { Segment, Segmented } from "./ui/Segmented";
import {
  costTypeSegments,
  type IShareSegment,
  niceScale,
  smoothPath,
  speedCostSegments,
  tokenTypeSegments,
} from "./usageChart";

// Follows apps/web/src/components/usage/usageShortcuts.ts and usageProviders.ts.
type IMetric = "cost" | "tokens" | "limits";
const loading = "m-0 px-4 text-[13px] text-muted-foreground";
const MESSAGE =
  "m-0 rounded-lg border border-warning/40 px-3 py-2 text-[13px] text-warning-foreground";
const HEADING = "m-0 flex items-center gap-2 text-[14px] font-medium";
const TOTAL_TERM = "text-[12px] text-muted-foreground";
const TOTAL_VALUE = "mx-0 mt-0.5 mb-0 text-[18px] font-semibold tabular-nums";
const TABLE = "w-full border-collapse text-[14px]";
const HEAD_CELL =
  "border-b border-border py-2 pr-0 text-[12px] font-normal text-muted-foreground last:pr-2";
const HEAD_FIGURE = `${HEAD_CELL} pl-6 text-right`;
const HEAD_LEFT = `${HEAD_CELL} pl-2 text-left`;
const CELL = "border-b border-border/50 py-2.5 pr-0 tabular-nums last:pr-2";
const FIGURE = `${CELL} pl-6 text-right whitespace-nowrap text-muted-foreground`;
const STRONG_FIGURE = `${CELL} pl-6 text-right whitespace-nowrap text-foreground`;
const EMPTY_CELL = `${CELL} pl-6 text-center whitespace-nowrap text-muted-foreground`;

const METRICS: Array<{ Value: IMetric; Label: string }> = [
  { Value: "cost", Label: "Cost" },
  { Value: "tokens", Label: "Tokens" },
  { Value: "limits", Label: "Limits" },
];
const WINDOWS = [
  { Days: 1, Label: "Past 24h" },
  { Days: 7, Label: "7 days" },
  { Days: 30, Label: "30 days" },
  { Days: 90, Label: "90 days" },
];
const PROVIDERS: Record<UsageProviderKind, { Label: string; Color: string; Driver: string }> = {
  codex: { Label: "Codex", Color: "var(--foreground)", Driver: "codex" },
  claude: { Label: "Claude Code", Color: "#d97757", Driver: "claudeAgent" },
  grok: {
    Label: "Grok Build",
    Color: "color-mix(in oklab, var(--foreground) 72%, var(--background))",
    Driver: "grok",
  },
  cursor: { Label: "Cursor", Color: "#8b8b8b", Driver: "cursor" },
  opencode: { Label: "OpenCode", Color: "#5b9bbd", Driver: "opencode" },
  antigravity: { Label: "Antigravity", Color: "#8c7bd1", Driver: "antigravity" },
  pi: { Label: "Pi", Color: "#4d9f8a", Driver: "pi" },
  muse: { Label: "Muse Code", Color: "#0866ff", Driver: "muse" },
};
const PROVIDER_ORDER = Object.keys(PROVIDERS) as UsageProviderKind[];
const PACE: Record<LimitPace, string> = {
  ahead: "Ahead of pace: spending faster than the window elapses",
  on: "On pace with the window",
  under: "Under pace: headroom left for the rest of the window",
};
const PACE_COLOR: Record<LimitPace, string> = {
  ahead: "bg-warning",
  on: "bg-muted-foreground",
  under: "bg-success",
};

const shownMetric = (held: string): IMetric =>
  METRICS.find((entry) => entry.Value === held)?.Value ?? "limits";

const shownDays = (held: number): number =>
  WINDOWS.some((entry) => entry.Days === held) ? held : 30;

const metricField = (metric: "cost" | "tokens"): "costUsd" | "totalTokens" =>
  metric === "cost" ? "costUsd" : "totalTokens";

export const UsageView = UsagePage.provider(() => {
  const environment = Environment.use();
  const environmentId = environment.state.EnvironmentId;
  const metric = () => shownMetric(environment.state.Local.Preferences.Usage.Metric);
  const days = () => shownDays(environment.state.Local.Preferences.Usage.Days);
  const { page, input, load } = useUsagePage(environmentId, {
    Days: days(),
    Limits: metric() === "limits",
  });
  const refreshing = useInFlight(RefreshingUsage, () => page.state);
  const choose = (nextMetric: IMetric, nextDays: number) => {
    const daysChanged = nextDays !== days();
    const limitsShown = nextMetric === "limits" && metric() !== "limits";
    void environment.setPreferences({ Usage: { Metric: nextMetric, Days: nextDays } });
    if (daysChanged) load(nextDays);
    if (limitsShown) void page.autoRefreshLimits(environmentId);
  };
  const shown = () => page.state.Usage;
  const merged = createMemo((): MergedUsage | null => {
    const held = shown();
    if (held === null) return null;
    return mergeUsage(
      [
        {
          environmentId: EnvironmentId.make(environment.state.EnvironmentId),
          label: environment.state.Label,
          summary: held.Summary as unknown as UsageSummary,
        },
      ],
      USAGE_CONTRACT_VERSION,
    );
  });
  const windowLabel = () => {
    const held = input();
    return held.resolution === "hour"
      ? "Past 24 hours"
      : `${formatDayShort(held.sinceDay)} to ${formatDayShort(held.untilDay)}`;
  };
  return (
    <div class="flex h-full min-h-0 flex-col">
      <PageHeader variant="page" class="max-md:h-auto max-md:flex-wrap max-md:py-2">
        <SidebarToggle />
        <div class={BREADCRUMB}>
          <h1 class={CRUMB_TITLE}>Usage</h1>
          <Show when={metric() !== "limits"}>
            <span class={CRUMB_SEPARATOR}>·</span>
            <span class={CRUMB_MUTED}>{windowLabel()}</span>
          </Show>
        </div>
        <div class="flex items-center gap-2">
          <Show when={metric() !== "limits"}>
            <Segmented variant="card" role="group" aria-label="Period">
              <For each={WINDOWS}>
                {(entry) => (
                  <Segment
                    aria-pressed={days() === entry.Days}
                    onClick={() => choose(metric(), entry.Days)}
                  >
                    {entry.Label}
                  </Segment>
                )}
              </For>
            </Segmented>
          </Show>
          <Segmented variant="card" role="group" aria-label="Metric">
            <For each={METRICS}>
              {(entry) => (
                <Segment
                  aria-pressed={metric() === entry.Value}
                  onClick={() => choose(entry.Value, days())}
                >
                  {entry.Label}
                </Segment>
              )}
            </For>
          </Segmented>
          <IconButton
            aria-label={metric() === "limits" ? "Refresh limits" : "Refresh usage"}
            data-tip={metric() === "limits" ? "Refresh limits" : "Refresh usage"}
            disabled={refreshing()}
            onClick={() =>
              void page.refreshUsage(
                environmentId,
                metric() === "limits" ? null : { Key: String(days()), Input: input() },
              )
            }
          >
            <RefreshCw classList={{ "animate-spin": refreshing() }} />
          </IconButton>
          <IconButton
            aria-label="Close usage"
            data-tip="Close"
            onClick={() => environment.openView(null)}
          >
            <X />
          </IconButton>
        </div>
      </PageHeader>
      <div class="min-w-0 flex-1 overflow-y-auto">
        <div class="mx-auto flex max-w-6xl flex-col gap-8 px-6 pt-6 pb-12">
          <Show
            when={metric() !== "limits"}
            fallback={<UsageLimits providers={environment.state.Replica.Config?.providers} />}
          >
            <Show when={merged()} fallback={<p class={loading}>Reading usage…</p>}>
              {(usage) => (
                <UsageOverview
                  usage={usage()}
                  metric={metric() === "cost" ? "cost" : "tokens"}
                  input={input()}
                  messages={usageSourceMessages(
                    (shown()?.Summary.sources ?? []) as unknown as UsageSummary["sources"],
                  )}
                  stale={shown()?.Key !== String(days())}
                />
              )}
            </Show>
          </Show>
        </div>
      </div>
    </div>
  );
}, getDefaultUsagePage);

function UsageOverview(props: {
  usage: MergedUsage;
  metric: "cost" | "tokens";
  input: IWireUsageInput;
  messages: readonly string[];
  stale: boolean;
}) {
  const field = () => metricField(props.metric);
  const format = (value: number) =>
    props.metric === "cost" ? formatUsd(value) : formatTokens(value);
  const providers = createMemo(() =>
    PROVIDER_ORDER.filter((provider) =>
      props.usage.providers.some(
        (entry) => entry.provider === provider && (entry.totalTokens > 0 || entry.costUsd > 0),
      ),
    ),
  );
  const ranked = createMemo(() => {
    const value = (provider: UsageProviderKind) =>
      props.usage.providers.find((entry) => entry.provider === provider)?.[field()] ?? 0;
    return providers().toSorted((left, right) => value(right) - value(left));
  });
  const models = createMemo(() =>
    props.metric === "tokens"
      ? props.usage.models.toSorted(
          (left, right) => right.totalTokens - left.totalTokens || right.costUsd - left.costUsd,
        )
      : props.usage.models,
  );
  const peak = () => Math.max(0, ...models().map((model) => model[field()]));
  const hourly = () => props.input.resolution === "hour";
  const [breakdown, setBreakdown] = createSignal<"model" | "time">("model");
  const periods = createMemo((): ReadonlyArray<DailyTotals | HourlyTotals> =>
    (hourly() ? props.usage.hourly : props.usage.daily).toReversed(),
  );
  return (
    <div class="flex flex-col gap-8 data-stale:opacity-60" data-stale={props.stale || undefined}>
      <For each={props.messages}>{(message) => <p class={MESSAGE}>{message}</p>}</For>
      <section class="grid grid-cols-[minmax(0,18rem)_minmax(0,1fr)] gap-8 max-md:grid-cols-[minmax(0,1fr)]">
        <div class="flex flex-col gap-4">
          <p class="m-0 text-[36px] leading-[1.1] font-semibold tabular-nums">
            {props.metric === "cost"
              ? formatUsd(props.usage.costUsd)
              : formatTokens(props.usage.totalTokens)}
          </p>
          <p class="mx-0 mt-1 mb-0 text-[12px] text-muted-foreground">
            {formatCount(props.usage.sessions)} sessions
            {props.metric === "cost" ? " · API estimate" : ""}
            <Show when={props.metric === "cost" && props.usage.costQuality.unpricedShare > 0}>
              {` · excludes ${formatPercent(props.usage.costQuality.unpricedShare)} unpriced records`}
            </Show>
          </p>
          <For each={ranked()}>
            {(provider) => {
              const totals = () =>
                props.usage.providers.find((entry) => entry.provider === provider);
              const share = () =>
                props.metric === "cost" ? (totals()?.costShare ?? 0) : (totals()?.tokenShare ?? 0);
              return (
                <div class="flex flex-col gap-0.5">
                  <div class="flex items-center gap-2 text-[14px]">
                    <span
                      class="size-2 shrink-0 rounded-full"
                      style={{ "background-color": PROVIDERS[provider].Color }}
                    />
                    <ProviderIcon driver={PROVIDERS[provider].Driver} size={16} />
                    <span class="min-w-0 truncate">{PROVIDERS[provider].Label}</span>
                    <span class="flex-1 text-[11px] whitespace-nowrap text-muted-foreground">
                      {formatCount(totals()?.sessions ?? 0)}{" "}
                      {totals()?.sessions === 1 ? "session" : "sessions"}
                    </span>
                    <span class="font-medium tabular-nums">{format(totals()?.[field()] ?? 0)}</span>
                  </div>
                  <p class="m-0 text-[12px] text-muted-foreground">
                    {props.metric === "cost"
                      ? `${formatPercent(share())} of cost · ${formatTokens(totals()?.totalTokens ?? 0)} tokens`
                      : `${formatPercent(share())} of tokens · ${formatUsd(totals()?.costUsd ?? 0)}`}
                  </p>
                </div>
              );
            }}
          </For>
        </div>
        <div class="flex min-w-0 flex-col gap-3">
          <h2 class={HEADING}>
            {props.input.resolution === "hour" ? "Hourly" : "Daily"}{" "}
            {props.metric === "tokens" ? "processed tokens" : "cost"}
          </h2>
          <UsageChart
            usage={props.usage}
            providers={providers()}
            metric={props.metric}
            input={props.input}
          />
        </div>
      </section>
      <section class="flex flex-col gap-2">
        <h2 class={HEADING}>Totals</h2>
        <dl class="m-0 grid grid-cols-5 gap-x-6 gap-y-4 max-md:grid-cols-2">
          <div>
            <dt class={TOTAL_TERM}>Processed tokens</dt>
            <dd class={TOTAL_VALUE}>{formatTokens(props.usage.totalTokens)}</dd>
          </div>
          <div>
            <dt class={TOTAL_TERM}>Cached input</dt>
            <dd class={TOTAL_VALUE}>{formatTokens(props.usage.cachedInputTokens)}</dd>
          </div>
          <div>
            <dt class={TOTAL_TERM}>Uncached input</dt>
            <dd class={TOTAL_VALUE}>{formatTokens(props.usage.uncachedInputTokens)}</dd>
          </div>
          <div>
            <dt class={TOTAL_TERM}>Output</dt>
            <dd class={TOTAL_VALUE}>{formatTokens(props.usage.outputTokens)}</dd>
          </div>
          <div>
            <dt class={TOTAL_TERM}>Cache savings</dt>
            <dd class={TOTAL_VALUE}>{formatUsd(props.usage.costQuality.cacheSavingsUsd)}</dd>
          </div>
        </dl>
      </section>
      <Show when={props.usage.totalTokens > 0}>
        <section class="grid grid-cols-[repeat(auto-fit,minmax(18rem,1fr))] gap-x-12 gap-y-8">
          <Show
            when={props.metric === "cost"}
            fallback={
              <ShareBar
                label="Tokens by type"
                segments={tokenTypeSegments(props.usage)}
                format={formatTokens}
              />
            }
          >
            <ShareBar
              label="Cost by type"
              segments={costTypeSegments(props.usage.categoryCost)}
              format={formatUsd}
            />
            <Show when={props.usage.speedCost.fast + props.usage.speedCost.ultrafast > 0}>
              <ShareBar
                label="Cost by speed"
                segments={speedCostSegments(props.usage.speedCost)}
                format={formatUsd}
              />
            </Show>
          </Show>
        </section>
      </Show>
      <section class="flex flex-col gap-3">
        <div class="flex items-center justify-between">
          <h2 class={HEADING}>Breakdown</h2>
          <Segmented variant="card" role="group" aria-label="Usage breakdown">
            <Segment aria-pressed={breakdown() === "model"} onClick={() => setBreakdown("model")}>
              Model
            </Segment>
            <Segment aria-pressed={breakdown() === "time"} onClick={() => setBreakdown("time")}>
              {hourly() ? "Hour" : "Day"}
            </Segment>
          </Segmented>
        </div>
        <Show when={breakdown() === "time"}>
          <div
            class="overflow-x-auto"
            role="region"
            aria-label="Usage breakdown by time"
            tabindex="0"
          >
            <table class={TABLE}>
              <thead>
                <tr>
                  <th class={HEAD_LEFT}>{hourly() ? "Hour" : "Day"}</th>
                  <For each={providers()}>
                    {(provider) => <th class={HEAD_FIGURE}>{PROVIDERS[provider].Label}</th>}
                  </For>
                  <th class={HEAD_FIGURE}>Total</th>
                  <th class={HEAD_FIGURE}>Tokens</th>
                </tr>
              </thead>
              <tbody>
                <Show
                  when={periods().length > 0}
                  fallback={
                    <tr>
                      <td colSpan={providers().length + 3} class={EMPTY_CELL}>
                        No activity in this window.
                      </td>
                    </tr>
                  }
                >
                  <For each={periods()}>
                    {(period) => (
                      <tr>
                        <td class={`${CELL} pl-2 text-left whitespace-nowrap text-foreground`}>
                          {"hourStart" in period
                            ? formatHourShort(period.hourStart, props.input.timeZone)
                            : formatDayShort(period.day)}
                        </td>
                        <For each={providers()}>
                          {(provider) => (
                            <td class={FIGURE}>
                              {formatUsd(period.byProvider.get(provider)?.costUsd ?? 0)}
                            </td>
                          )}
                        </For>
                        <td class={STRONG_FIGURE}>{formatUsd(period.costUsd)}</td>
                        <td class={FIGURE}>{formatTokens(period.totalTokens)}</td>
                      </tr>
                    )}
                  </For>
                </Show>
              </tbody>
            </table>
          </div>
        </Show>
        <Show when={breakdown() === "model"}>
          <table class={TABLE}>
            <thead>
              <tr>
                <th class={HEAD_LEFT}>#</th>
                <th class={`${HEAD_CELL} w-full pl-3 text-left`}>Model</th>
                <th class={HEAD_FIGURE}>Cost</th>
                <th class={`${HEAD_FIGURE} max-md:hidden`}>Share</th>
                <th class={HEAD_FIGURE}>Tokens</th>
              </tr>
            </thead>
            <tbody>
              <Show
                when={models().length > 0}
                fallback={
                  <tr>
                    <td colSpan={5} class={EMPTY_CELL}>
                      No activity in this window.
                    </td>
                  </tr>
                }
              >
                <For each={models()}>
                  {(model, index) => {
                    const value = () => model[field()];
                    const share = () =>
                      props.metric === "tokens"
                        ? model.tokenShare
                        : isModelCostUnknown(model)
                          ? null
                          : model.costShare;
                    return (
                      <tr>
                        <td
                          class={`${CELL} pl-2 text-left text-[12px] whitespace-nowrap text-muted-foreground`}
                        >
                          {index() + 1}
                        </td>
                        <td class={`${CELL} w-full pl-3 text-left text-muted-foreground`}>
                          <span class="flex items-center gap-2 text-foreground">
                            <ProviderIcon driver={PROVIDERS[model.provider].Driver} size={14} />
                            {model.model}
                          </span>
                          <Show when={value() > 0 && peak() > 0}>
                            <span class="mt-1.5 block h-0.5 max-w-48">
                              <span
                                class="block h-full rounded-full"
                                style={{
                                  width: `max(0.5rem, ${(value() / peak()) * 100}%)`,
                                  "background-color": PROVIDERS[model.provider].Color,
                                }}
                              />
                            </span>
                          </Show>
                        </td>
                        <td class={STRONG_FIGURE}>
                          {isModelCostUnknown(model) ? (
                            <span class="text-muted-foreground">Unpriced</span>
                          ) : (
                            formatUsd(model.costUsd)
                          )}
                        </td>
                        <td class={`${FIGURE} max-md:hidden`}>
                          {share() === null ? "" : formatPercent(share()!)}
                        </td>
                        <td class={FIGURE}>{formatTokens(model.totalTokens)}</td>
                      </tr>
                    );
                  }}
                </For>
              </Show>
            </tbody>
          </table>
        </Show>
      </section>
    </div>
  );
}

// Follows UsageShareBar in apps/web/src/components/usage/UsageShareBar.tsx.
function ShareBar(props: {
  label: string;
  segments: IShareSegment[];
  format: (value: number) => string;
}) {
  const visible = () => props.segments.filter((segment) => segment.Value > 0);
  const total = () => visible().reduce((sum, segment) => sum + segment.Value, 0);
  return (
    <Show when={total() > 0}>
      <div class="flex min-w-0 flex-col gap-2.5">
        <h3 class={HEADING}>{props.label}</h3>
        <div class="flex h-2 gap-0.5" aria-hidden="true">
          <For each={visible()}>
            {(segment) => (
              <span
                class="h-full min-w-1 rounded-xs first:rounded-l-full last:rounded-r-full"
                style={{ flex: `${segment.Value} 1 0`, "background-color": segment.Color }}
                data-tip={`${segment.Label} · ${props.format(segment.Value)} · ${formatPercent(segment.Value / total())}`}
              />
            )}
          </For>
        </div>
        <ul
          class="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-[12px] tabular-nums"
          aria-label={props.label}
        >
          <For each={visible()}>
            {(segment) => (
              <li class="flex items-center gap-1.5">
                <span class="size-2 rounded-xs" style={{ "background-color": segment.Color }} />
                <span class="text-muted-foreground">{segment.Label}</span>
                <span>{props.format(segment.Value)}</span>
              </li>
            )}
          </For>
        </ul>
      </div>
    </Show>
  );
}

const CHART_WIDTH = 960;
const CHART_HEIGHT = 260;
const CHART_TOP = 8;
const CHART_TICKS = 4;

// Follows apps/web/src/components/usage/UsageProviderChart.tsx, without its hover tooltip.
function UsageChart(props: {
  usage: MergedUsage;
  providers: readonly UsageProviderKind[];
  metric: "cost" | "tokens";
  input: IWireUsageInput;
}) {
  const field = () => metricField(props.metric);
  const points = createMemo(() => {
    const hourly = props.input.resolution === "hour";
    const slots = hourly
      ? enumerateHourStarts(props.input.sinceTime ?? "", props.input.untilTime ?? "")
      : enumerateDays(props.input.sinceDay, props.input.untilDay);
    const rows = new Map<string, MergedUsage["daily"][number]>(
      hourly
        ? props.usage.hourly.map((row) => [row.hourStart, row])
        : props.usage.daily.map((row) => [row.day, row]),
    );
    return slots.map((slot) => ({ Slot: slot, Row: rows.get(slot) }));
  });
  const scale = createMemo(() =>
    niceScale(
      Math.max(
        0,
        ...points().flatMap((point) =>
          props.providers.map((provider) => point.Row?.byProvider.get(provider)?.[field()] ?? 0),
        ),
      ),
      CHART_TICKS,
    ),
  );
  const x = (index: number) =>
    points().length < 2 ? 0 : (index * CHART_WIDTH) / (points().length - 1);
  const y = (value: number) =>
    scale().Max === 0
      ? CHART_HEIGHT
      : CHART_HEIGHT - (value / scale().Max) * (CHART_HEIGHT - CHART_TOP);
  const line = (provider: UsageProviderKind) =>
    smoothPath(
      points().map((point, index) => ({
        X: x(index),
        Y: y(point.Row?.byProvider.get(provider)?.[field()] ?? 0),
      })),
    );
  const format = (value: number) =>
    props.metric === "tokens" ? formatTokens(value) : formatUsd(value);
  const label = (slot: string) =>
    props.input.resolution === "hour"
      ? formatHourShort(slot, props.input.timeZone)
      : formatDayShort(slot);
  const ticks = () => {
    const count = points().length;
    if (count === 0) return [];
    return [...new Set([0, Math.floor(count / 2), count - 1])];
  };
  return (
    <Show
      when={props.providers.length > 0}
      fallback={
        <div class="flex h-[260px] flex-col items-center justify-center gap-2 text-[13px] text-muted-foreground">
          <ChartNoAxesColumn />
          No activity in this window.
        </div>
      }
    >
      <div class="flex h-56 gap-2">
        <div class="relative w-14 flex-none" aria-hidden="true">
          <For each={scale().Ticks}>
            {(tick) => (
              <span
                class="absolute right-0 -translate-y-1/2 text-[10px] text-muted-foreground tabular-nums"
                style={{ top: `${(y(tick) / CHART_HEIGHT) * 100}%` }}
              >
                {tick === 0 ? "0" : format(tick)}
              </span>
            )}
          </For>
        </div>
        <svg
          class="block h-full min-w-0 flex-1 overflow-visible"
          viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
          preserveAspectRatio="none"
          role="img"
          aria-label="Usage by provider over time"
        >
          <For each={scale().Ticks}>
            {(tick) => (
              <line
                class="stroke-border stroke-1"
                x1={0}
                x2={CHART_WIDTH}
                y1={y(tick)}
                y2={y(tick)}
                vector-effect="non-scaling-stroke"
              />
            )}
          </For>
          <For each={props.providers}>
            {(provider) => (
              <path
                d={`${line(provider)} L${CHART_WIDTH},${CHART_HEIGHT} L0,${CHART_HEIGHT} Z`}
                fill={PROVIDERS[provider].Color}
                fill-opacity="0.12"
              />
            )}
          </For>
          <For each={props.providers}>
            {(provider) => (
              <path
                d={line(provider)}
                fill="none"
                stroke={PROVIDERS[provider].Color}
                stroke-width="2"
                vector-effect="non-scaling-stroke"
              />
            )}
          </For>
        </svg>
      </div>
      <div class="flex justify-between pl-16 text-[10px] text-muted-foreground uppercase">
        <For each={ticks()}>{(index) => <span>{label(points()[index]?.Slot ?? "")}</span>}</For>
      </div>
    </Show>
  );
}

const LIMIT_DRIVER_LABELS: Record<string, string> = Object.fromEntries(
  Object.values(PROVIDERS).map((entry) => [entry.Driver, entry.Label]),
);

function UsageLimits(props: { providers: readonly unknown[] | undefined }) {
  const environment = Environment.use();
  const now = clockNow();
  const presentations = () =>
    limitPresentations(environment.state.EnvironmentId, environment.state.Label, props.providers);
  const pools = createMemo(() => limitPools(presentations(), now));
  const notices = createMemo(() => collectLimitNotices(presentations()));
  return (
    <Show when={props.providers} fallback={<p class={loading}>Reading limits…</p>}>
      <div class="flex flex-col gap-8">
        <Show when={pools().length === 0 && notices().length === 0}>
          <p class={loading}>
            No provider on the selected environments reports subscription limits.
          </p>
        </Show>
        <For each={pools()}>{(pool) => <LimitPoolSection pool={pool} now={now} />}</For>
        <For each={notices()}>{(notice) => <p class={MESSAGE}>{notice}</p>}</For>
      </div>
    </Show>
  );
}

const poolLabel = (pool: LimitPool) => LIMIT_DRIVER_LABELS[pool.driver] ?? String(pool.driver);
const poolColor = (pool: LimitPool) =>
  Object.values(PROVIDERS).find((entry) => entry.Driver === pool.driver)?.Color ?? "var(--primary)";

/** The Limits tab's figures in one column, for a popover. */
export function LimitsSummary(props: { pools: readonly LimitPool[]; now: number }) {
  return (
    <Show
      when={props.pools.length > 0}
      fallback={<p class="m-0 text-[13px] text-muted-foreground">No limits reported.</p>}
    >
      <div class="flex flex-col gap-3">
        <For each={props.pools}>
          {(pool) => (
            <section class="flex flex-col gap-2">
              <h2 class="m-0 flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground">
                <ProviderIcon driver={pool.driver} size={12} />
                {poolLabel(pool)}
              </h2>
              <For each={displayLimitWindows(pool)}>
                {(window) => (
                  <div class="flex flex-col gap-1">
                    <span class="flex items-baseline gap-2 text-[13px]">
                      <span class="min-w-0 flex-1 truncate">{window.label}</span>
                      <span class="font-medium tabular-nums">{window.remainingPercent}% left</span>
                    </span>
                    <span class="block h-1.5 overflow-hidden rounded-full bg-muted">
                      <span
                        class="block h-full opacity-85"
                        style={{
                          width: `${Math.max(0, window.remainingPercent)}%`,
                          "background-color": poolColor(pool),
                        }}
                      />
                    </span>
                    <Show when={window.members[0]}>
                      {(member) => (
                        <span class="text-[11px] text-muted-foreground">
                          {formatResetsIn(member().window, props.now) ?? ""}
                        </span>
                      )}
                    </Show>
                  </div>
                )}
              </For>
            </section>
          )}
        </For>
      </div>
    </Show>
  );
}

function LimitPoolSection(props: { pool: LimitPool; now: number }) {
  const label = () => poolLabel(props.pool);
  const color = () => poolColor(props.pool);
  return (
    <section class="flex flex-col gap-3">
      <h2 class={HEADING}>
        <ProviderIcon driver={props.pool.driver} size={16} />
        {label()}
      </h2>
      <For each={displayLimitWindows(props.pool)}>
        {(window) => (
          <div class="grid grid-cols-[11rem_minmax(0,1fr)] items-center gap-x-6 gap-y-3 rounded-[10px] border border-border/60 p-4 max-md:grid-cols-[minmax(0,1fr)]">
            <div class="flex flex-col gap-1">
              <span class="text-[14px] font-medium">{window.label}</span>
              <span class="flex items-baseline gap-2">
                <span class="text-[30px] font-semibold tabular-nums">
                  {window.remainingPercent}%
                </span>
                <span class="text-[14px] text-muted-foreground">left</span>
                <Show when={window.pace}>
                  {(pace) => (
                    <span
                      class={`size-2 rounded-full ${PACE_COLOR[pace()]}`}
                      data-tip={PACE[pace()]}
                    />
                  )}
                </Show>
              </span>
            </div>
            <div class="grid auto-cols-[minmax(0,1fr)] grid-flow-col gap-1">
              <For each={window.members}>
                {(member) => (
                  <div class="flex flex-col gap-1">
                    <div class="h-5 overflow-hidden rounded-[6px] border border-border bg-muted">
                      <span
                        class="block h-full opacity-85"
                        style={{
                          width: `${Math.max(0, 100 - member.window.usedPercent)}%`,
                          "background-color": color(),
                        }}
                      />
                    </div>
                    <span class="text-[11px] text-muted-foreground">
                      {formatResetsIn(member.window, props.now) ?? ""}
                    </span>
                  </div>
                )}
              </For>
            </div>
          </div>
        )}
      </For>
    </section>
  );
}
