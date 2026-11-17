// @effect-diagnostics globalDate:off globalTimers:off -- A view-only tick for the working timer, outside any Effect runtime.
import { liveThoughtLine } from "@t3tools/client-runtime/work-log/presentation";
import { isOrchestrationV2WorkActive } from "@t3tools/contracts";
import { deriveSubagentElapsedMs, formatDuration } from "@t3tools/shared/orchestrationTiming";
import { useInFlight } from "treflex-solid";
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  For,
  Index,
  onCleanup,
  Show,
} from "solid-js";

import { compactElapsed, type ILineageAgent } from "./lineage";

import {
  activeStepIndex,
  CHECKLIST_ROWS,
  checklistWindow,
  currentTodoSteps,
  earlierCompletedSteps,
  type IChecklistStep,
  liveSteps,
} from "./checklist";
import Environment from "./Environment";
import { ChevronUp, CornerUpRight, PenLine, Square, SquareCheck, X } from "./icons";
import OpenThread, { isRowVisible, runMessage, timelineItem } from "./OpenThread";
import { workingStartedAt } from "./Shell";
import ThreadSession, { queueAction } from "./ThreadSession";
import { QueuedMessage } from "./TimelineRows";
import { Button } from "./ui/Button";
import { IconButton } from "./ui/IconButton";
import { Popup } from "./ui/Menu";
import { BANNER_TITLE } from "./ui/notice";
import { useWorkspaceRoot } from "./workspaceRoot";
import {
  liveWorkEntryLabel,
  workEntryIsActiveTurnActivity,
  workEntryIsVisibleInGroup,
  workLogEntry,
} from "./workLog";

const SECOND = 1_000;

const POPOVER =
  "absolute right-0 bottom-[calc(100%+4px)] left-0 z-40 max-h-[min(24rem,50dvh)] overflow-y-auto rounded-xl border border-border bg-popover px-3.5 pt-2.5 pb-3 text-[14px] text-foreground shadow-[0_10px_25px_-5px_rgb(0_0_0/20%)]";

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

function useTick(live: Accessor<boolean>): Accessor<number> {
  const [now, setNow] = createSignal(Date.now());
  createEffect(() => {
    if (!live()) return;
    const tick = setInterval(() => setNow(Date.now()), SECOND);
    onCleanup(() => clearInterval(tick));
  });
  return now;
}

/** A subagent task's run time, ticking each second while it runs. */
export function AgentElapsed(props: { agent: ILineageAgent }) {
  const now = useTick(() => isOrchestrationV2WorkActive(props.agent.Status as never));
  return (
    <>
      {compactElapsed(
        deriveSubagentElapsedMs(
          {
            status: props.agent.Status as never,
            startedAt: props.agent.StartedAt,
            completedAt: props.agent.CompletedAt,
          },
          now(),
        ) ?? 0,
      )}
    </>
  );
}

// What the turn is doing now: the latest tool or thought after the reply that's on screen.
function useActivity(): Accessor<string | null> {
  const thread = OpenThread.use();
  const workspaceRoot = useWorkspaceRoot();
  return createMemo(() => {
    const ids = thread.timelineIds();
    for (let index = ids.length - 1; index >= 0; index -= 1) {
      const id = ids[index]!;
      const item = timelineItem(thread.state, id);
      if (item === undefined || !isRowVisible(thread.state, id)) continue;
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
    return null;
  });
}

// The fold above carries the timer, so this line says only what the turn is doing now.
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
      <Index each={steps()}>
        {(step, index) => (
          <ChecklistStep step={step()} active={props.start + index === props.checklist.Active} />
        )}
      </Index>
    </ol>
  );
}

function ChecklistPopover(props: {
  checklist: IChecklist;
  toggle: HTMLButtonElement;
  onClose: () => void;
}) {
  // An emptied list unmounts the popover, and the next one shouldn't reopen it.
  onCleanup(props.onClose);
  return (
    <Popup
      class={POPOVER}
      role="dialog"
      label="To-do list"
      anchor={props.toggle}
      onClose={props.onClose}
    >
      <ChecklistSteps
        checklist={props.checklist}
        start={0}
        end={props.checklist.Steps.length}
        class={`${STEPS} text-muted-foreground`}
      />
    </Popup>
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
          aria-expanded={open()}
          aria-label={`${count()} done, show all steps`}
          onClick={() => setOpen((held) => !held)}
        >
          {count()}
          <ChevronUp />
        </button>
        <Show when={open() && toggle()}>
          {(held) => (
            <ChecklistPopover
              checklist={props.checklist}
              toggle={held()}
              onClose={() => setOpen(false)}
            />
          )}
        </Show>
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
  const save = () => {
    const text = editing()?.trim() ?? "";
    if (text === "") return;
    session.queueAction({ Kind: "edit", RunId: props.runId, Text: text });
    setEditing(null);
  };
  return (
    <div class="mt-1.5 flex items-center gap-2 wrap-anywhere">
      <Show when={editing() !== null} fallback={<QueuedMessage runId={props.runId} />}>
        <form
          class="flex min-w-0 flex-1 flex-col gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <textarea
            class="resize-y rounded-[10px] border border-input bg-background px-2.5 py-1.5"
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
                save();
              }
            }}
          />
          <div class="flex justify-end gap-1.5">
            <Button onClick={() => setEditing(null)}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={queueing()}>
              Save
            </Button>
          </div>
        </form>
      </Show>
      <Show when={editing() === null}>
        <div class="flex flex-none gap-0.5 [&_svg]:size-3.5">
          <IconButton
            aria-label="Send now"
            data-tip="Send now"
            disabled={queueing() || !canSendNow()}
            onClick={() => session.queueAction({ Kind: "sendNow", RunId: props.runId })}
          >
            <CornerUpRight />
          </IconButton>
          <Show when={editable()}>
            <IconButton
              aria-label="Edit queued message"
              data-tip="Edit"
              disabled={queueing()}
              onClick={() => setEditing(message()?.text ?? "")}
            >
              <PenLine />
            </IconButton>
          </Show>
          <IconButton
            aria-label="Remove queued message"
            data-tip="Remove"
            disabled={queueing()}
            onClick={() => session.queueAction({ Kind: "cancel", RunId: props.runId })}
          >
            <X />
          </IconButton>
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
  onCleanup(props.onClose);
  return (
    <Popup
      class={POPOVER}
      role="dialog"
      label="Queued messages"
      anchor={props.toggle}
      onClose={props.onClose}
    >
      <div class={BANNER_TITLE}>
        <strong>Queued</strong>
        <Show when={!props.working}>
          <Button disabled={queueing()} onClick={() => session.queueAction({ Kind: "resume" })}>
            Resume
          </Button>
        </Show>
      </div>
      <For each={thread.queuedRunIds()}>{(runId) => <QueuedRow runId={runId} />}</For>
    </Popup>
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
          aria-expanded={open()}
          onClick={() => setOpen((held) => !held)}
        >
          <Show when={props.state !== null}>
            <span class="mr-0.5">·</span>
          </Show>
          {queued()} queued
          <ChevronUp />
        </button>
        <Show when={open() && toggle()}>
          {(held) => (
            <QueuedPopover
              working={props.state !== null}
              toggle={held()}
              onClose={() => setOpen(false)}
            />
          )}
        </Show>
      </Show>
    </div>
  );
}
