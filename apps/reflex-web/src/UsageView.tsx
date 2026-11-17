// @effect-diagnostics globalDate:off -- View-only usage windows, outside any Effect runtime.
import {
  EnvironmentId,
  type ServerProvider,
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
  makeWindow,
  usageSourceMessages,
} from "@t3tools/shared/usageFormat";
import {
  collectLimitAccounts,
  collectLimitNotices,
  collectLimitPools,
  displayLimitWindows,
  formatResetsIn,
  type LimitPace,
  type LimitPool,
} from "@t3tools/shared/usageLimits";
import {
  type DailyTotals,
  type HourlyTotals,
  isModelCostUnknown,
  type MergedUsage,
  mergeUsage,
} from "@t3tools/shared/usageMerge";
import { createMemo, createSignal, For, onMount, Show } from "solid-js";

import { ProviderIcon } from "./brand";
import Environment from "./Environment";
import { ChartNoAxesColumn, RefreshCw, X } from "./icons";
import type { IWireUsageInput } from "./Infrastructure/settings";
import { SidebarToggle } from "./Sidebar";
import { clockNow } from "./timestamps";
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

const shownMetric = (held: string): IMetric =>
  METRICS.find((entry) => entry.Value === held)?.Value ?? "limits";

const shownDays = (held: number): number =>
  WINDOWS.some((entry) => entry.Days === held) ? held : 30;

const metricField = (metric: "cost" | "tokens"): "costUsd" | "totalTokens" =>
  metric === "cost" ? "costUsd" : "totalTokens";

const windowInput = (days: number): IWireUsageInput =>
  makeWindow(days, new Date(), days === 1 ? "hour" : "day") as IWireUsageInput;

export function UsageView() {
  const environment = Environment.use();
  const metric = () => shownMetric(environment.state.Local.Preferences.Usage.Metric);
  const days = () => shownDays(environment.state.Local.Preferences.Usage.Days);
  const [input, setInput] = createSignal(windowInput(days()));
  const load = (windowDays: number) => {
    const next = windowInput(windowDays);
    setInput(next);
    void environment.loadUsage(String(windowDays), next);
  };
  onMount(() => load(days()));
  const choose = (nextMetric: IMetric, nextDays: number) => {
    const daysChanged = nextDays !== days();
    void environment.setPreferences({ Usage: { Metric: nextMetric, Days: nextDays } });
    if (daysChanged) load(nextDays);
  };
  const shown = () => environment.state.Replica.Usage;
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
    <div class="usage-view">
      <header class="thread-header usage-header">
        <SidebarToggle />
        <div class="breadcrumb">
          <h1>Usage</h1>
          <Show when={metric() !== "limits"}>
            <span class="crumb-separator">·</span>
            <span class="crumb-project">{windowLabel()}</span>
          </Show>
        </div>
        <div class="usage-controls">
          <Show when={metric() !== "limits"}>
            <div class="segmented" role="group" aria-label="Period">
              <For each={WINDOWS}>
                {(entry) => (
                  <button
                    classList={{ active: days() === entry.Days }}
                    aria-pressed={days() === entry.Days}
                    onClick={() => choose(metric(), entry.Days)}
                  >
                    {entry.Label}
                  </button>
                )}
              </For>
            </div>
          </Show>
          <div class="segmented" role="group" aria-label="Metric">
            <For each={METRICS}>
              {(entry) => (
                <button
                  classList={{ active: metric() === entry.Value }}
                  aria-pressed={metric() === entry.Value}
                  onClick={() => choose(entry.Value, days())}
                >
                  {entry.Label}
                </button>
              )}
            </For>
          </div>
          <button
            class="icon-button"
            aria-label={metric() === "limits" ? "Refresh limits" : "Refresh usage"}
            data-tip={metric() === "limits" ? "Refresh limits" : "Refresh usage"}
            disabled={environment.refreshingUsage()}
            onClick={() =>
              void environment.refreshUsage(
                metric() === "limits" ? null : { Key: String(days()), Input: input() },
              )
            }
          >
            <RefreshCw classList={{ spinning: environment.refreshingUsage() }} />
          </button>
          <button
            class="icon-button"
            aria-label="Close usage"
            data-tip="Close"
            onClick={() => environment.openView(null)}
          >
            <X />
          </button>
        </div>
      </header>
      <div class="usage-content">
        <div class="usage-column">
          <Show
            when={metric() !== "limits"}
            fallback={<UsageLimits providers={environment.state.Replica.Config?.providers} />}
          >
            <Show when={merged()} fallback={<p class="settings-loading">Reading usage…</p>}>
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
}

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
    <div class="usage-overview" classList={{ stale: props.stale }}>
      <For each={props.messages}>{(message) => <p class="usage-message">{message}</p>}</For>
      <section class="usage-summary">
        <div class="usage-figures">
          <p class="usage-figure">
            {props.metric === "cost"
              ? formatUsd(props.usage.costUsd)
              : formatTokens(props.usage.totalTokens)}
          </p>
          <p class="usage-subline">
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
                <div class="usage-provider">
                  <div class="usage-provider-line">
                    <span
                      class="usage-dot"
                      style={{ "background-color": PROVIDERS[provider].Color }}
                    />
                    <ProviderIcon driver={PROVIDERS[provider].Driver} size={16} />
                    <span class="usage-provider-name">{PROVIDERS[provider].Label}</span>
                    <span class="usage-provider-sessions">
                      {formatCount(totals()?.sessions ?? 0)}{" "}
                      {totals()?.sessions === 1 ? "session" : "sessions"}
                    </span>
                    <span class="usage-provider-value">{format(totals()?.[field()] ?? 0)}</span>
                  </div>
                  <p class="usage-provider-share">
                    {props.metric === "cost"
                      ? `${formatPercent(share())} of cost · ${formatTokens(totals()?.totalTokens ?? 0)} tokens`
                      : `${formatPercent(share())} of tokens · ${formatUsd(totals()?.costUsd ?? 0)}`}
                  </p>
                </div>
              );
            }}
          </For>
        </div>
        <div class="usage-chart-column">
          <h2 class="usage-heading">
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
      <section class="usage-totals">
        <h2 class="usage-heading">Totals</h2>
        <dl>
          <div>
            <dt>Processed tokens</dt>
            <dd>{formatTokens(props.usage.totalTokens)}</dd>
          </div>
          <div>
            <dt>Cached input</dt>
            <dd>{formatTokens(props.usage.cachedInputTokens)}</dd>
          </div>
          <div>
            <dt>Uncached input</dt>
            <dd>{formatTokens(props.usage.uncachedInputTokens)}</dd>
          </div>
          <div>
            <dt>Output</dt>
            <dd>{formatTokens(props.usage.outputTokens)}</dd>
          </div>
          <div>
            <dt>Cache savings</dt>
            <dd>{formatUsd(props.usage.costQuality.cacheSavingsUsd)}</dd>
          </div>
        </dl>
      </section>
      <Show when={props.usage.totalTokens > 0}>
        <section class="usage-shares">
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
      <section class="usage-breakdown">
        <div class="usage-breakdown-head">
          <h2 class="usage-heading">Breakdown</h2>
          <div class="segmented" role="group" aria-label="Usage breakdown">
            <button
              classList={{ active: breakdown() === "model" }}
              aria-pressed={breakdown() === "model"}
              onClick={() => setBreakdown("model")}
            >
              Model
            </button>
            <button
              classList={{ active: breakdown() === "time" }}
              aria-pressed={breakdown() === "time"}
              onClick={() => setBreakdown("time")}
            >
              {hourly() ? "Hour" : "Day"}
            </button>
          </div>
        </div>
        <Show when={breakdown() === "time"}>
          <div
            class="usage-table-scroll"
            role="region"
            aria-label="Usage breakdown by time"
            tabindex="0"
          >
            <table>
              <thead>
                <tr>
                  <th class="left first">{hourly() ? "Hour" : "Day"}</th>
                  <For each={providers()}>{(provider) => <th>{PROVIDERS[provider].Label}</th>}</For>
                  <th>Total</th>
                  <th>Tokens</th>
                </tr>
              </thead>
              <tbody>
                <Show
                  when={periods().length > 0}
                  fallback={
                    <tr>
                      <td colSpan={providers().length + 3} class="usage-empty">
                        No activity in this window.
                      </td>
                    </tr>
                  }
                >
                  <For each={periods()}>
                    {(period) => (
                      <tr>
                        <td class="left first strong">
                          {"hourStart" in period
                            ? formatHourShort(period.hourStart, props.input.timeZone)
                            : formatDayShort(period.day)}
                        </td>
                        <For each={providers()}>
                          {(provider) => (
                            <td>{formatUsd(period.byProvider.get(provider)?.costUsd ?? 0)}</td>
                          )}
                        </For>
                        <td class="strong">{formatUsd(period.costUsd)}</td>
                        <td>{formatTokens(period.totalTokens)}</td>
                      </tr>
                    )}
                  </For>
                </Show>
              </tbody>
            </table>
          </div>
        </Show>
        <Show when={breakdown() === "model"}>
          <table>
            <thead>
              <tr>
                <th class="left">#</th>
                <th class="left wide">Model</th>
                <th>Cost</th>
                <th class="share">Share</th>
                <th>Tokens</th>
              </tr>
            </thead>
            <tbody>
              <Show
                when={models().length > 0}
                fallback={
                  <tr>
                    <td colSpan={5} class="usage-empty">
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
                        <td class="left index">{index() + 1}</td>
                        <td class="left wide">
                          <span class="usage-model">
                            <ProviderIcon driver={PROVIDERS[model.provider].Driver} size={14} />
                            {model.model}
                          </span>
                          <Show when={value() > 0 && peak() > 0}>
                            <span class="usage-bar">
                              <span
                                style={{
                                  width: `max(0.5rem, ${(value() / peak()) * 100}%)`,
                                  "background-color": PROVIDERS[model.provider].Color,
                                }}
                              />
                            </span>
                          </Show>
                        </td>
                        <td class="strong">
                          {isModelCostUnknown(model) ? (
                            <span class="muted">Unpriced</span>
                          ) : (
                            formatUsd(model.costUsd)
                          )}
                        </td>
                        <td class="share">{share() === null ? "" : formatPercent(share()!)}</td>
                        <td>{formatTokens(model.totalTokens)}</td>
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
      <div class="share-bar">
        <h3 class="usage-heading">{props.label}</h3>
        <div class="share-bar-track" aria-hidden="true">
          <For each={visible()}>
            {(segment) => (
              <span
                style={{ flex: `${segment.Value} 1 0`, "background-color": segment.Color }}
                data-tip={`${segment.Label} · ${props.format(segment.Value)} · ${formatPercent(segment.Value / total())}`}
              />
            )}
          </For>
        </div>
        <ul class="share-bar-legend" aria-label={props.label}>
          <For each={visible()}>
            {(segment) => (
              <li>
                <span class="share-bar-swatch" style={{ "background-color": segment.Color }} />
                <span class="muted">{segment.Label}</span>
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
        <div class="usage-chart-empty">
          <ChartNoAxesColumn />
          No activity in this window.
        </div>
      }
    >
      <div class="usage-chart-frame">
        <div class="usage-chart-axis-labels" aria-hidden="true">
          <For each={scale().Ticks}>
            {(tick) => (
              <span style={{ top: `${(y(tick) / CHART_HEIGHT) * 100}%` }}>
                {tick === 0 ? "0" : format(tick)}
              </span>
            )}
          </For>
        </div>
        <svg
          class="usage-chart"
          viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
          preserveAspectRatio="none"
          role="img"
          aria-label="Usage by provider over time"
        >
          <For each={scale().Ticks}>
            {(tick) => (
              <line
                class="usage-chart-grid"
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
      <div class="usage-chart-ticks">
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
    new Map([
      [
        EnvironmentId.make(environment.state.EnvironmentId),
        {
          entry: { target: { label: environment.state.Label } },
          serverConfig:
            props.providers === undefined
              ? null
              : { providers: props.providers as readonly ServerProvider[] },
        },
      ],
    ]);
  const pools = createMemo(() => collectLimitPools(collectLimitAccounts(presentations()), now));
  const notices = createMemo(() => collectLimitNotices(presentations()));
  return (
    <Show when={props.providers} fallback={<p class="settings-loading">Reading limits…</p>}>
      <div class="usage-limits">
        <Show when={pools().length === 0 && notices().length === 0}>
          <p class="settings-loading">
            No provider on the selected environments reports subscription limits.
          </p>
        </Show>
        <For each={pools()}>{(pool) => <LimitPoolSection pool={pool} now={now} />}</For>
        <For each={notices()}>{(notice) => <p class="usage-message">{notice}</p>}</For>
      </div>
    </Show>
  );
}

function LimitPoolSection(props: { pool: LimitPool; now: number }) {
  const label = () => LIMIT_DRIVER_LABELS[props.pool.driver] ?? String(props.pool.driver);
  const color = () =>
    Object.values(PROVIDERS).find((entry) => entry.Driver === props.pool.driver)?.Color ??
    "var(--primary)";
  return (
    <section class="limit-pool">
      <h2 class="usage-heading">
        <ProviderIcon driver={props.pool.driver} size={16} />
        {label()}
      </h2>
      <For each={displayLimitWindows(props.pool)}>
        {(window) => (
          <div class="limit-card">
            <div class="limit-card-figures">
              <span class="limit-card-label">{window.label}</span>
              <span class="limit-card-left">
                <span class="limit-card-percent">{window.remainingPercent}%</span>
                <span class="limit-card-word">left</span>
                <Show when={window.pace}>
                  {(pace) => <span class={`limit-pace ${pace()}`} data-tip={PACE[pace()]} />}
                </Show>
              </span>
            </div>
            <div class="limit-bars">
              <For each={window.members}>
                {(member) => (
                  <div class="limit-bar-cell">
                    <div class="limit-bar">
                      <span
                        style={{
                          width: `${Math.max(0, 100 - member.window.usedPercent)}%`,
                          "background-color": color(),
                        }}
                      />
                    </div>
                    <span class="limit-bar-reset">
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
