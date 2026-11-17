// @effect-diagnostics globalDate:off globalTimers:off -- A view-only tick for the working timer, outside any Effect runtime.
import { liveThoughtLine } from "@t3tools/client-runtime/work-log/presentation";
import { formatDuration } from "@t3tools/shared/orchestrationTiming";
import { type Accessor, createMemo, createSignal, For, Index, onCleanup, Show } from "solid-js";

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
import { Popup } from "./Menu";
import OpenThread, { isRowVisible, runMessage, timelineItem } from "./OpenThread";
import { workingStartedAt } from "./Shell";
import ThreadSession from "./ThreadSession";
import { QueuedMessage } from "./TimelineRows";
import { useWorkspaceRoot } from "./workspaceRoot";
import {
  liveWorkEntryLabel,
  workEntryIsActiveTurnActivity,
  workEntryIsVisibleInGroup,
  workLogEntry,
} from "./workLog";

const SECOND = 1_000;

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
  const [now, setNow] = createSignal(Date.now());
  const tick = setInterval(() => setNow(Date.now()), SECOND);
  onCleanup(() => clearInterval(tick));
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
    <span class="turn-status-text">{props.waiting ? "Waiting" : (activity() ?? "Thinking")}</span>
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
      class="checklist-step"
      classList={{ active: props.active, done: props.step.status === "completed" }}
    >
      <Show when={props.step.status === "completed"} fallback={<Square />}>
        <SquareCheck />
      </Show>
      <span>{props.step.text}</span>
    </li>
  );
}

function ChecklistSteps(props: { checklist: IChecklist; start: number; end: number }) {
  const steps = () => props.checklist.Steps.slice(props.start, props.end);
  return (
    <ol class="checklist-steps">
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
      class="queued-popover"
      role="dialog"
      label="To-do list"
      anchor={props.toggle}
      onClose={props.onClose}
    >
      <ChecklistSteps checklist={props.checklist} start={0} end={props.checklist.Steps.length} />
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
      <ChecklistSteps checklist={props.checklist} start={shown().start} end={shown().end} />
      <Show when={hidden()} fallback={<span class="checklist-count">{count()}</span>}>
        <button
          ref={setToggle}
          class="turn-status-queued checklist-count"
          aria-expanded={open()}
          aria-label={`${count()} done, show all steps`}
          onClick={() => setOpen((held) => !held)}
        >
          {count()}
          <ChevronUp classList={{ open: open() }} />
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
    <div class="queued">
      <Show when={editing() !== null} fallback={<QueuedMessage runId={props.runId} />}>
        <form
          class="queued-edit"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <textarea
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
          <div class="queued-edit-actions">
            <button type="button" class="button" onClick={() => setEditing(null)}>
              Cancel
            </button>
            <button type="submit" class="button primary" disabled={session.queueing()}>
              Save
            </button>
          </div>
        </form>
      </Show>
      <Show when={editing() === null}>
        <div class="queued-actions">
          <button
            class="icon-button"
            aria-label="Send now"
            data-tip="Send now"
            disabled={session.queueing() || !canSendNow()}
            onClick={() => session.queueAction({ Kind: "sendNow", RunId: props.runId })}
          >
            <CornerUpRight />
          </button>
          <Show when={editable()}>
            <button
              class="icon-button"
              aria-label="Edit queued message"
              data-tip="Edit"
              disabled={session.queueing()}
              onClick={() => setEditing(message()?.text ?? "")}
            >
              <PenLine />
            </button>
          </Show>
          <button
            class="icon-button"
            aria-label="Remove queued message"
            data-tip="Remove"
            disabled={session.queueing()}
            onClick={() => session.queueAction({ Kind: "cancel", RunId: props.runId })}
          >
            <X />
          </button>
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
  onCleanup(props.onClose);
  return (
    <Popup
      class="queued-popover"
      role="dialog"
      label="Queued messages"
      anchor={props.toggle}
      onClose={props.onClose}
    >
      <div class="banner-title">
        <strong>Queued</strong>
        <Show when={!props.working}>
          <button
            class="button"
            disabled={session.queueing()}
            onClick={() => session.queueAction({ Kind: "resume" })}
          >
            Resume
          </button>
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
      class="turn-status"
      classList={{
        idle: props.state === null && queued() === 0,
        checklist: props.checklist !== null,
      }}
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
          class="turn-status-queued"
          aria-expanded={open()}
          onClick={() => setOpen((held) => !held)}
        >
          <Show when={props.state !== null}>
            <span class="turn-status-dot">·</span>
          </Show>
          {queued()} queued
          <ChevronUp classList={{ open: open() }} />
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
