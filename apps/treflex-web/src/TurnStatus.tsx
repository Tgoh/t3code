// @effect-diagnostics globalDate:off -- A view-only working timer, outside any Effect runtime.
import { waitingOnSubagentsLabel } from "@t3tools/client-runtime/state/subagentRuntime";
import { liveThoughtLine } from "@t3tools/client-runtime/work-log/presentation";
import { isOrchestrationV2WorkActive } from "@t3tools/contracts";
import { formatDuration } from "@t3tools/shared/orchestrationTiming";
import { useInFlight } from "treflex-solid";
import type { JSX } from "@solidjs/web";
import { type Accessor, createMemo, createSignal, For, onCleanup, Show, untrack } from "solid-js";

import { SECOND, useTick } from "./AgentElapsed";
import {
  activeStepIndex,
  CHECKLIST_ROWS,
  checklistWindow,
  currentTodoSteps,
  earlierCompletedSteps,
  type IChecklistStep,
  liveSteps,
} from "./checklist";
import { isAlternate, MOD_LABEL } from "./Composer";
import Environment from "./Environment";
import { ChevronUp, CornerUpRight, PenLine, Square, SquareCheck, X } from "./icons";
import OpenThread, { isRowVisible, runMessage, timelineItem } from "./OpenThread";
import { workingStartedAt } from "./Shell";
import ThreadSession, { queueAction } from "./ThreadSession";
import { QueuedMessage } from "./TimelineRows";
import { Button } from "./ui/Button";
import { PopoverPopup } from "./ui/Popover";
import { Presence } from "./ui/Presence";
import { BANNER_TITLE } from "./ui/notice";
import { Textarea } from "./ui/Textarea";
import { useWorkspaceRoot } from "./workspaceRoot";
import {
  liveWorkEntryLabel,
  workEntryIsActiveTurnActivity,
  workEntryIsVisibleInGroup,
  workLogEntry,
} from "./workLog";

const STATUS_SELECTOR = "[data-turn-status]";

const STEPS = "m-0 min-w-0 flex-1 list-none p-0";

const QUEUED_TOGGLE =
  "ml-auto inline-flex flex-none cursor-pointer items-center gap-1 rounded-md border-0 bg-transparent px-1 py-0 whitespace-nowrap hover:text-foreground aria-expanded:text-foreground [&_svg]:size-3.5 [&_svg]:transition-transform [&_svg]:duration-120 [&_svg]:ease-[ease] aria-expanded:[&_svg]:rotate-180";

// Reasoning past this length can't change the first line, so the preview reads no further.
const THOUGHT_PREVIEW_LENGTH = 8_192;

// Follows formatWorkingTimerNow in apps/web/src/components/chat/TimelineWorkGroupRows.logic.ts.
function workingTimer(since: string, now: number): string {
  const seconds = Math.max(0, Math.floor((now - Date.parse(since)) / SECOND));
  return seconds < 60 ? `${seconds}s` : formatDuration(seconds * SECOND);
}

/** How long the thread's turn has worked, ticking each second while mounted. */
export function useWorkingTimer(): Accessor<string | null> {
  const thread = OpenThread.use();
  const environment = Environment.use();
  const now = useTick(() => true);
  return () => {
    const row = environment.state.Replica.Shell.Threads[thread.state.ThreadId];
    const since = row === undefined ? null : workingStartedAt(row);
    return since === null ? null : workingTimer(since, now());
  };
}

// What the turn is doing now: the latest tool or thought after the reply that's on screen.
function useActivity(): Accessor<string | null> {
  const thread = OpenThread.use();
  const workspaceRoot = useWorkspaceRoot();
  return createMemo(() => {
    const ids = thread.timelineIds();
    const runId = thread.latestRun()?.id;
    // Follows runningSubagentsAtRunTail: a run that has done nothing since launching children
    // that still run is waiting on them.
    let waitingOn = 0;
    let tail = true;
    for (let index = ids.length - 1; index >= 0; index -= 1) {
      const id = ids[index]!;
      const item = timelineItem(thread.state, id);
      if (item === undefined || !isRowVisible(thread.state, id)) continue;
      if (tail && item.type === "subagent" && item.runId === runId) {
        if (isOrchestrationV2WorkActive(item.status)) waitingOn += 1;
        continue;
      }
      if (tail && waitingOn > 0) return waitingOnSubagentsLabel(waitingOn);
      tail = false;
      switch (item.type) {
        case "user_message":
        case "notification":
        case "assistant_message":
          return null;
        case "reasoning":
          return liveThoughtLine(item.text.slice(0, THOUGHT_PREVIEW_LENGTH)) || "Thinking";
      }
      const entry = workLogEntry(item);
      if (!workEntryIsVisibleInGroup(entry, true)) continue;
      return liveWorkEntryLabel(entry, workspaceRoot(), workEntryIsActiveTurnActivity(entry));
    }
    return waitingOn > 0 ? waitingOnSubagentsLabel(waitingOn) : null;
  });
}

function WorkingText(props: { waiting: boolean }) {
  const activity = useActivity();
  return (
    <span class="min-w-0 flex-1 truncate">
      {props.waiting ? "Waiting" : (activity() ?? "Thinking")}
    </span>
  );
}

export interface IChecklist {
  Steps: readonly IChecklistStep[];
  Active: number;
  Done: number;
}

/** The running turn's to-do list, or null before it has one and once the turn ends. */
export function useChecklist(running: Accessor<boolean>): Accessor<IChecklist | null> {
  const thread = OpenThread.use();
  return createMemo(() => {
    const run = thread.latestRun();
    if (!running() || run === null) return null;
    const ids = thread.timelineIds();
    function* newestFirst() {
      for (let index = ids.length - 1; index >= 0; index -= 1)
        yield timelineItem(thread.state, ids[index]!);
    }
    const runOrdinal = (runId: string) => thread.state.Runs[runId]?.ordinal;
    const current = currentTodoSteps(newestFirst(), run, runOrdinal);
    if (current === null) return null;
    const earlier = earlierCompletedSteps(
      Object.values(thread.state.Plans).flatMap((plan) =>
        plan.kind === "todo_list" &&
        plan.runId !== null &&
        (runOrdinal(plan.runId) ?? Infinity) < run.ordinal
          ? [plan.steps]
          : [],
      ),
    );
    const steps = liveSteps(current, earlier);
    if (steps.length === 0) return null;
    return {
      Steps: steps,
      Active: activeStepIndex(steps),
      Done: steps.filter((step) => step.status === "completed").length,
    };
  });
}

export const checklistRows = (checklist: IChecklist | null): number =>
  checklist === null ? 0 : Math.min(checklist.Steps.length, CHECKLIST_ROWS);

function ChecklistStep(props: { step: IChecklistStep; active: boolean }) {
  return (
    <li
      class="group/step flex h-[var(--checklist-row-height,22px)] items-center gap-2 data-active:font-medium data-active:text-foreground [&_svg]:size-3.5 [&_svg]:flex-none"
      data-active={props.active ? "" : undefined}
      data-done={props.step.status === "completed" ? "" : undefined}
    >
      <Show when={props.step.status === "completed"} fallback={<Square />}>
        <SquareCheck />
      </Show>
      <span class="min-w-0 truncate group-data-done/step:line-through">{props.step.text}</span>
    </li>
  );
}

function ChecklistSteps(props: {
  checklist: IChecklist;
  start: number;
  end: number;
  class: string;
}) {
  const steps = () => props.checklist.Steps.slice(props.start, props.end);
  return (
    <ol class={props.class}>
      <For each={steps()} keyed={false}>
        {(step, index) => (
          <ChecklistStep step={step()} active={props.start + index === props.checklist.Active} />
        )}
      </For>
    </ol>
  );
}

function StatusPopover(props: {
  label: string;
  toggle: HTMLButtonElement;
  onClose: () => void;
  children: JSX.Element;
}) {
  return (
    <PopoverPopup
      anchor={props.toggle.closest<HTMLElement>(STATUS_SELECTOR) ?? props.toggle}
      trigger={props.toggle}
      side="top"
      align="end"
      padding="compact"
      class="w-(--anchor-width)"
      label={props.label}
      onClose={props.onClose}
    >
      <div class="max-h-[min(24rem,50dvh)] overflow-y-auto text-[14px] text-foreground">
        {props.children}
      </div>
    </PopoverPopup>
  );
}

function ChecklistPopover(props: {
  checklist: IChecklist;
  toggle: HTMLButtonElement;
  onClose: () => void;
}) {
  // An emptied list unmounts the popover, and the next one shouldn't reopen it.
  onCleanup(untrack(() => props.onClose));
  return (
    <StatusPopover label="To-do list" toggle={props.toggle} onClose={props.onClose}>
      <ChecklistSteps
        checklist={props.checklist}
        start={0}
        end={props.checklist.Steps.length}
        class={`${STEPS} text-muted-foreground`}
      />
    </StatusPopover>
  );
}

// Every row's height is fixed, so a step changing status never changes the list's height.
function Checklist(props: { checklist: IChecklist }) {
  const [open, setOpen] = createSignal(false);
  const [toggle, setToggle] = createSignal<HTMLButtonElement>();
  const shown = () => checklistWindow(props.checklist.Steps.length, props.checklist.Active);
  const hidden = () => props.checklist.Steps.length > CHECKLIST_ROWS;
  const count = () => `${props.checklist.Done}/${props.checklist.Steps.length}`;
  return (
    <>
      <ChecklistSteps
        checklist={props.checklist}
        start={shown().start}
        end={shown().end}
        class={STEPS}
      />
      <Show
        when={hidden()}
        fallback={
          <span class="ml-auto inline-flex h-(--checklist-row-height) flex-none items-center">
            {count()}
          </span>
        }
      >
        <button
          ref={setToggle}
          class={`${QUEUED_TOGGLE} h-(--checklist-row-height)`}
          aria-haspopup="dialog"
          aria-expanded={open() ? "true" : "false"}
          aria-label={`${count()} done, show all steps`}
          onClick={() => setOpen((held) => !held)}
        >
          {count()}
          <ChevronUp />
        </button>
        <Presence when={open() && toggle()}>
          {(held) => (
            <ChecklistPopover
              checklist={props.checklist}
              toggle={held()}
              onClose={() => setOpen(false)}
            />
          )}
        </Presence>
      </Show>
    </>
  );
}

// Follows QueuedMessage's actions in apps/web/src/components/chat/QueuedRunsControl.tsx.
function QueuedRow(props: { runId: string }) {
  const thread = OpenThread.use();
  const session = ThreadSession.use();
  const queueing = useInFlight(queueAction, () => session.state);
  const [editing, setEditing] = createSignal<string | null>(null);
  const message = () => runMessage(thread.state, props.runId);
  const editable = () => message()?.context?.guest === undefined;
  const workflow = () => session.queueWorkflow();
  const canSendNow = () => workflow().CanSendNow || workflow().CanSteer;
  const save = (alternate: boolean) => {
    const text = editing()?.trim() ?? "";
    if (text === "") return;
    session.queueAction({ Kind: "edit", RunId: props.runId, Text: text, Alternate: alternate });
    setEditing(null);
  };
  return (
    <div class="mt-1.5 flex items-center gap-2 wrap-anywhere">
      <Show when={editing() !== null} fallback={<QueuedMessage runId={props.runId} />}>
        <div class="flex min-w-0 flex-1 flex-col gap-1.5">
          <Textarea
            aria-label="Edit queued message"
            rows={3}
            value={editing() ?? ""}
            ref={(element) => queueMicrotask(() => element.focus())}
            onInput={(event) => setEditing(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setEditing(null);
              } else if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
                event.preventDefault();
                save(isAlternate(event));
              }
            }}
          />
          <div class="flex justify-end gap-1.5">
            <Button size="xs" variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              size="xs"
              disabled={queueing()}
              data-tip={
                workflow().CanSteer && session.followUpBehavior() === "queue"
                  ? `${MOD_LABEL}-click or ${MOD_LABEL}+Enter to save and steer`
                  : undefined
              }
              onClick={(event) => save(isAlternate(event))}
            >
              Save
            </Button>
          </div>
        </div>
      </Show>
      <Show when={editing() === null}>
        <div class="flex flex-none gap-0.5">
          <Button
            variant="ghost-muted"
            size="icon-xs"
            aria-label="Send now"
            data-tip="Send now"
            disabled={queueing() || !canSendNow()}
            onClick={() => session.queueAction({ Kind: "sendNow", RunId: props.runId })}
          >
            <CornerUpRight />
          </Button>
          <Show when={editable()}>
            <Button
              variant="ghost-muted"
              size="icon-xs"
              aria-label="Edit queued message"
              data-tip="Edit"
              disabled={queueing()}
              onClick={() => setEditing(message()?.text ?? "")}
            >
              <PenLine />
            </Button>
          </Show>
          <Button
            variant="ghost-muted"
            size="icon-xs"
            aria-label="Remove queued message"
            data-tip="Remove"
            disabled={queueing()}
            onClick={() => session.queueAction({ Kind: "cancel", RunId: props.runId })}
          >
            <X />
          </Button>
        </div>
      </Show>
    </div>
  );
}

function QueuedPopover(props: {
  working: boolean;
  toggle: HTMLButtonElement;
  onClose: () => void;
}) {
  const thread = OpenThread.use();
  const session = ThreadSession.use();
  const queueing = useInFlight(queueAction, () => session.state);
  onCleanup(untrack(() => props.onClose));
  return (
    <StatusPopover label="Queued messages" toggle={props.toggle} onClose={props.onClose}>
      <div class={BANNER_TITLE}>
        <strong>Queued</strong>
        <Show when={!props.working}>
          <Button
            size="xs"
            variant="ghost-muted"
            disabled={queueing()}
            onClick={() => session.queueAction({ Kind: "resume" })}
          >
            Resume
          </Button>
        </Show>
      </div>
      <For each={thread.queuedRunIds()}>{(runId) => <QueuedRow runId={runId} />}</For>
    </StatusPopover>
  );
}

/**
 * One line above the composer for the running turn and the queue, or the turn's to-do list once it
 * has one. The line keeps its height whether or not it has anything to say, so showing it never
 * moves the timeline.
 */
export function TurnStatus(props: {
  state: "running" | "waiting" | null;
  checklist: IChecklist | null;
}) {
  const thread = OpenThread.use();
  const [open, setOpen] = createSignal(false);
  const [toggle, setToggle] = createSignal<HTMLButtonElement>();
  const queued = () => thread.queuedRunIds().length;
  return (
    <div
      class="group/status absolute right-(--gutter) bottom-full left-(--gutter) flex h-(--turn-status-height) items-center gap-1 rounded-lg bg-[color-mix(in_srgb,var(--background)_var(--glass-opacity),transparent)] px-3.5 text-[13px] text-muted-foreground tabular-nums backdrop-blur-(--glass-blur) backdrop-saturate-(--glass-saturation) data-checklist:items-start data-checklist:py-1 data-idle:invisible"
      data-turn-status
      data-idle={props.state === null && queued() === 0 ? "" : undefined}
      data-checklist={props.checklist !== null ? "" : undefined}
    >
      <Show
        when={props.checklist}
        fallback={
          <Show when={props.state}>
            {(state) => <WorkingText waiting={state() === "waiting"} />}
          </Show>
        }
      >
        {(checklist) => <Checklist checklist={checklist()} />}
      </Show>
      <Show when={queued() > 0}>
        <button
          ref={setToggle}
          class={`${QUEUED_TOGGLE} group-data-checklist/status:h-(--checklist-row-height)`}
          aria-haspopup="dialog"
          aria-expanded={open() ? "true" : "false"}
          onClick={() => setOpen((held) => !held)}
        >
          <Show when={props.state !== null}>
            <span class="mr-0.5">·</span>
          </Show>
          {queued()} queued
          <ChevronUp />
        </button>
        <Presence when={open() && toggle()}>
          {(held) => (
            <QueuedPopover
              working={props.state !== null}
              toggle={held()}
              onClose={() => setOpen(false)}
            />
          )}
        </Presence>
      </Show>
    </div>
  );
}
