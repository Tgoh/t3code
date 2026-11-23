import {
  formatSubagentDisplayTitle,
  subagentCardDetail,
  subagentGroupSummary,
  summarizeSubagentStatuses,
} from "@t3tools/client-runtime/state/subagent-display";
import type { JSX } from "@solidjs/web";
import { createMemo, For, Show } from "solid-js";

import { ProviderIcon, hasProviderIcon } from "./brand";
import Environment from "./Environment";
import { Bot, ChevronDown, ChevronRight } from "./icons";
import type { IWireTurnItem } from "./Infrastructure/wire";
import type { ILineageAgent } from "./lineage";
import OpenThread, { timelineItem } from "./OpenThread";
import { createSideThreadTrigger } from "./sideThreadTrigger";
import {
  groupTiming,
  type INotificationItem,
  type IStatus,
  type ISubagent,
  type ISubagentEvent,
  type ISubagentItem,
  notificationEvent,
  notifiedChildThreadId,
  SETTLED,
} from "./subagents";
import ThreadSession from "./ThreadSession";
import { fullTimestamp, shortTimestamp } from "./timestamps";
import { AgentElapsed } from "./AgentElapsed";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "./ui/Collapsible";

// Follows STATUS_VISUALS in apps/web/src/components/chat/V2LifecycleRow.tsx.
const STATUS_VISUALS: Record<IStatus, { Dot: string; Label: string }> = {
  pending: { Dot: "bg-info", Label: "Queued" },
  running: { Dot: "bg-info", Label: "Running" },
  waiting: { Dot: "bg-info", Label: "Waiting" },
  idle: { Dot: "bg-muted-foreground/50", Label: "Idle · resumable" },
  completed: { Dot: "bg-success", Label: "Completed" },
  failed: { Dot: "bg-destructive", Label: "Failed" },
  cancelled: { Dot: "bg-muted-foreground/60", Label: "Stopped" },
  interrupted: { Dot: "bg-muted-foreground/60", Label: "Stopped" },
};

function SubagentAvatar(props: { driver: string | undefined; status?: IStatus | undefined }) {
  return (
    <span
      aria-hidden="true"
      class="relative inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-border/70 bg-muted ring-2 ring-background"
    >
      <Show
        when={hasProviderIcon(props.driver)}
        fallback={<Bot class="size-3.5 text-muted-foreground" />}
      >
        <ProviderIcon driver={props.driver} size={14} />
      </Show>
      <Show when={props.status}>
        {(status) => (
          <span
            class={`absolute -right-px -bottom-px size-2 rounded-full ring-2 ring-background ${STATUS_VISUALS[status()].Dot}`}
          />
        )}
      </Show>
    </span>
  );
}

interface ICardProps {
  item: ISubagentItem | ISubagent;
  childThreadId: string | null;
  /** A notification's outcome, which the card shows in place of the task's live status. */
  event?: ISubagentEvent | undefined;
}

const CARD =
  "group/subagent flex w-full min-w-0 items-center gap-2.5 rounded-md border-0 bg-transparent px-2 py-1.5 text-left";

// Follows SubagentTimelineLink in apps/web/src/components/chat/V2LifecycleRow.tsx.
function SubagentCard(props: ICardProps) {
  const thread = OpenThread.use();
  const environment = Environment.use();
  const subagentId = () => ("subagentId" in props.item ? props.item.subagentId : props.item.id);
  const live = () => thread.state.Subagents[subagentId()];
  const agent = () => live() ?? props.item;
  const remote = () => props.item.remoteChild ?? live()?.remoteChild;
  const title = () => formatSubagentDisplayTitle(props.item.title ?? "Subagent");
  const liveStatus = () => agent().status;
  const status = () => (props.event === undefined ? liveStatus() : props.event.Status);
  const statusLabel = () => props.event?.Label ?? STATUS_VISUALS[liveStatus()].Label;
  const detail = createMemo(() => {
    const result = agent().result?.trim();
    const progress = agent().progress?.trim();
    return subagentCardDetail(
      SETTLED.has(status() ?? liveStatus()) ? result || progress : progress || result,
    );
  });
  const failed = () => status() === "failed";
  const timing = (): ILineageAgent => ({
    Status: liveStatus(),
    StartedAt: agent().startedAt,
    CompletedAt: agent().completedAt,
  });
  const content = (): JSX.Element => (
    <>
      <SubagentAvatar
        driver={remote() === undefined ? props.item.driver : undefined}
        status={status() ?? undefined}
      />
      <span class="min-w-0 flex-1">
        <span class="flex items-baseline gap-2">
          <span class="min-w-0 truncate text-xs font-medium text-foreground">{title()}</span>
          <Show when={remote()}>
            {(held) => (
              <span class="shrink-0 text-xs text-muted-foreground">on {held().label}</span>
            )}
          </Show>
        </span>
        <span
          class="block truncate text-2xs leading-relaxed text-muted-foreground data-failed:text-destructive"
          data-failed={failed() ? "" : undefined}
        >
          {detail() ?? statusLabel()}
        </span>
      </span>
      <Show when={detail() !== null && (props.event !== undefined || status() !== "completed")}>
        <span
          class="shrink-0 text-xs text-muted-foreground data-failed:text-destructive"
          data-failed={failed() ? "" : undefined}
        >
          {statusLabel()}
        </span>
      </Show>
      <span class="shrink-0 text-xs text-muted-foreground tabular-nums">
        <Show when={props.event} fallback={<AgentElapsed agent={timing()} full />}>
          {(event) => (
            <span data-tip={fullTimestamp(event().At, environment.timestampFormat())}>
              {shortTimestamp(event().At, environment.timestampFormat())}
            </span>
          )}
        </Show>
      </span>
      <Show when={props.childThreadId !== null}>
        <ChevronRight class="size-3.5 shrink-0 text-muted-foreground/60 transition-colors group-hover/subagent:text-foreground" />
      </Show>
    </>
  );
  return (
    <Show
      when={props.childThreadId}
      fallback={
        <div class={CARD} data-subagent aria-description={statusLabel()}>
          {content()}
        </div>
      }
    >
      {(childThreadId) => {
        const trigger = createSideThreadTrigger((intent) =>
          remote() === undefined
            ? void environment.openSideThread(childThreadId(), intent)
            : void environment.selectThread(childThreadId()),
        );
        return (
          <>
            <button
              type="button"
              class={`${CARD} cursor-pointer transition-colors hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-inset`}
              data-subagent
              aria-label={`Open ${title()}`}
              aria-description={statusLabel()}
              {...trigger.handlers}
            >
              {content()}
            </button>
            {trigger.menu()}
          </>
        );
      }}
    </Show>
  );
}

function asSubagent(item: IWireTurnItem | undefined): ISubagentItem | null {
  return item?.type === "subagent" ? item : null;
}

export function SubagentRow(props: { id: string }) {
  const thread = OpenThread.use();
  return (
    <Show when={asSubagent(timelineItem(thread.state, props.id))}>
      {(item) => (
        <div class="pb-2">
          <SubagentCard item={item()} childThreadId={item().childThreadId} />
        </div>
      )}
    </Show>
  );
}

// Follows SimpleWorkEntryRow and SubagentNotificationLink in apps/web/src/components/chat.
export function SubagentNotification(props: { item: INotificationItem; agent: ISubagent }) {
  return (
    <div class="pb-2">
      <SubagentCard
        item={props.agent}
        childThreadId={notifiedChildThreadId(props.item)}
        event={notificationEvent(props.item, props.agent)}
      />
    </div>
  );
}

// Follows V2SubagentGroup in apps/web/src/components/chat/TimelineV2EventRow.tsx.
export function SubagentGroup(props: { rowKey: string; ids: string[]; expanded: boolean }) {
  const thread = OpenThread.use();
  const session = ThreadSession.use();
  const members = createMemo(() =>
    props.ids.flatMap((id) => asSubagent(timelineItem(thread.state, id)) ?? []),
  );
  const agents = createMemo(() =>
    members().map((item) => thread.state.Subagents[item.subagentId] ?? item),
  );
  const summary = createMemo(() => subagentGroupSummary(agents()));
  const statuses = createMemo(() => summarizeSubagentStatuses(agents().map((a) => a.status)));
  const label = () => `${members().length} ${members().length === 1 ? "subagent" : "subagents"}`;
  return (
    <Collapsible
      class="pb-2"
      open={props.expanded}
      onOpenChange={() => session.toggleRowExpanded(props.rowKey)}
    >
      <CollapsibleTrigger
        class="group/toggle flex w-full min-w-0 items-center gap-2.5 border-0 bg-transparent py-2 pr-3.25 pl-0 text-left text-muted-foreground opacity-55 transition-opacity hover:opacity-100 aria-expanded:text-foreground aria-expanded:opacity-100 data-active:text-foreground data-active:opacity-100"
        aria-label={label()}
        aria-description={statuses()}
        data-active={summary().active ? "" : undefined}
      >
        <span class="flex shrink-0 items-center -space-x-1.5" aria-hidden="true">
          <For each={members().slice(0, 3)}>
            {(item, index) => (
              <SubagentAvatar
                driver={item.remoteChild === undefined ? item.driver : undefined}
                status={agents().length === 1 ? agents()[index()]?.status : undefined}
              />
            )}
          </For>
          <Show when={members().length > 3}>
            <span class="relative inline-flex size-6 items-center justify-center rounded-full bg-muted text-3xs font-medium text-muted-foreground ring-2 ring-background">
              +{members().length - 3}
            </span>
          </Show>
        </span>
        <span class="min-w-0 flex-1">
          <span class="block text-xs font-semibold">{label()}</span>
          <span
            class="block truncate text-3xs text-muted-foreground data-active:text-info data-failed:text-destructive"
            data-active={summary().active ? "" : undefined}
            data-failed={!summary().active && summary().failed ? "" : undefined}
          >
            {statuses()}
          </span>
        </span>
        <span class="shrink-0 text-xs text-muted-foreground tabular-nums">
          <AgentElapsed agent={groupTiming(agents())} full />
        </span>
        <ChevronDown class="size-3.5 shrink-0 text-muted-foreground transition-transform group-aria-expanded/toggle:rotate-180" />
      </CollapsibleTrigger>
      <CollapsiblePanel animate={false}>
        <div class="mt-1 mb-1 rounded-lg border border-border/60 bg-card/30 p-1">
          <For each={members()}>
            {(item) => <SubagentCard item={item} childThreadId={item.childThreadId} />}
          </For>
        </div>
      </CollapsiblePanel>
    </Collapsible>
  );
}
