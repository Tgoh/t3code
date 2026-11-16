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
import { isModelCostUnknown, type MergedUsage, mergeUsage } from "@t3tools/shared/usageMerge";
import { createMemo, createSignal, For, onMount, Show } from "solid-js";

import { ProviderIcon } from "./brand";
import Environment from "./Environment";
import { ChartNoAxesColumn, RefreshCw, X } from "./icons";
import type { IWireUsageInput } from "./Infrastructure/settings";
import { SidebarToggle } from "./Sidebar";
import { clockNow } from "./timestamps";

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

// Stock's key and shape (apps/web/src/components/usage/usagePagePreferences.ts).
const PREFERENCES_KEY = "t3code:usage-page-preferences:v1";

function readPreferences(): { Metric: IMetric; Days: number } {
  try {
    const held = JSON.parse(localStorage.getItem(PREFERENCES_KEY) ?? "{}") as {
      metric?: unknown;
      windowDays?: unknown;
    };
    return {
      Metric: METRICS.some((entry) => entry.Value === held.metric)
        ? (held.metric as IMetric)
        : "limits",
      Days: WINDOWS.some((entry) => entry.Days === held.windowDays)
        ? (held.windowDays as number)
        : 30,
    };
  } catch {
    return { Metric: "limits", Days: 30 };
  }
}

function writePreferences(metric: IMetric, days: number) {
  try {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ metric, windowDays: days }));
  } catch {
    // A preference that can't be saved still applies to this page.
  }
}

const metricField = (metric: "cost" | "tokens"): "costUsd" | "totalTokens" =>
  metric === "cost" ? "costUsd" : "totalTokens";

const windowInput = (days: number): IWireUsageInput =>
  makeWindow(days, new Date(), days === 1 ? "hour" : "day") as IWireUsageInput;

export function UsageView() {
  const environment = Environment.use();
  const initial = readPreferences();
  const [metric, setMetric] = createSignal<IMetric>(initial.Metric);
  const [days, setDays] = createSignal(initial.Days);
  const [input, setInput] = createSignal(windowInput(initial.Days));
  const load = () => {
    const next = windowInput(days());
    setInput(next);
    void environment.loadUsage(String(days()), next);
  };
  onMount(load);
  const choose = (nextMetric: IMetric, nextDays: number) => {
    const daysChanged = nextDays !== days();
    setMetric(nextMetric);
    setDays(nextDays);
    writePreferences(nextMetric, nextDays);
    if (daysChanged) load();
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
    props.usage.models.toSorted(
      (left, right) => right.totalTokens - left.totalTokens || right.costUsd - left.costUsd,
    ),
  );
  const peak = () => Math.max(0, ...models().map((model) => model[field()]));
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
      <section class="usage-breakdown">
        <h2 class="usage-heading">Breakdown</h2>
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
      </section>
    </div>
  );
}

const CHART_WIDTH = 960;
const CHART_HEIGHT = 260;
const CHART_PAD = { Top: 12, Right: 8, Bottom: 24, Left: 8 };

// A simpler cut of apps/web/src/components/usage/UsageProviderChart.tsx: straight segments, no hover.
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
  const peak = createMemo(() =>
    Math.max(
      0,
      ...points().flatMap((point) =>
        props.providers.map((provider) => point.Row?.byProvider.get(provider)?.[field()] ?? 0),
      ),
    ),
  );
  const x = (index: number) =>
    CHART_PAD.Left +
    (points().length <= 1
      ? 0
      : (index / (points().length - 1)) * (CHART_WIDTH - CHART_PAD.Left - CHART_PAD.Right));
  const y = (value: number) =>
    CHART_HEIGHT -
    CHART_PAD.Bottom -
    (peak() === 0 ? 0 : (value / peak()) * (CHART_HEIGHT - CHART_PAD.Top - CHART_PAD.Bottom));
  const path = (provider: UsageProviderKind) =>
    points()
      .map(
        (point, index) =>
          `${index === 0 ? "M" : "L"}${x(index).toFixed(1)},${y(point.Row?.byProvider.get(provider)?.[field()] ?? 0).toFixed(1)}`,
      )
      .join(" ");
  const label = (slot: string) =>
    props.input.resolution === "hour"
      ? formatHourShort(slot, props.input.timeZone)
      : formatDayShort(slot);
  const ticks = () => {
    const count = points().length;
    if (count === 0) return [];
    return [...new Set([0, Math.floor((count - 1) / 2), count - 1])];
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
      <svg
        class="usage-chart"
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="Usage by provider over time"
      >
        <line
          class="usage-chart-axis"
          x1={CHART_PAD.Left}
          x2={CHART_WIDTH - CHART_PAD.Right}
          y1={CHART_HEIGHT - CHART_PAD.Bottom}
          y2={CHART_HEIGHT - CHART_PAD.Bottom}
        />
        <For each={props.providers}>
          {(provider) => (
            <>
              <path
                d={`${path(provider)} L${x(points().length - 1)},${y(0)} L${x(0)},${y(0)} Z`}
                fill={PROVIDERS[provider].Color}
                opacity="0.08"
              />
              <path
                d={path(provider)}
                fill="none"
                stroke={PROVIDERS[provider].Color}
                stroke-width="2"
                vector-effect="non-scaling-stroke"
              />
            </>
          )}
        </For>
      </svg>
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
