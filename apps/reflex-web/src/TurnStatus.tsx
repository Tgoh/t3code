// @effect-diagnostics globalDate:off globalTimers:off -- A view-only tick for the working timer, outside any Effect runtime.
import { liveThoughtLine } from "@t3tools/client-runtime/work-log/presentation";
import { formatDuration } from "@t3tools/shared/orchestrationTiming";
import { type Accessor, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";

import Environment from "./Environment";
import { ChevronUp, CornerUpRight, PenLine, X } from "./icons";
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
  const [popoverElement, setPopoverElement] = createSignal<HTMLDivElement>();
  onMount(() => {
    const popover = popoverElement();
    if (popover === undefined) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!popover.contains(target) && !props.toggle.contains(target)) props.onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) props.onClose();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    onCleanup(() => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
      // An emptied queue unmounts the popover, and the next queued message shouldn't reopen it.
      props.onClose();
    });
  });
  return (
    <div class="queued-popover" role="dialog" aria-label="Queued messages" ref={setPopoverElement}>
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
    </div>
  );
}

/**
 * One line above the composer for the running turn and the queue. It keeps its height whether or
 * not it has anything to say, so showing it never moves the timeline.
 */
export function TurnStatus(props: { state: "running" | "waiting" | null }) {
  const thread = OpenThread.use();
  const [open, setOpen] = createSignal(false);
  const [toggle, setToggle] = createSignal<HTMLButtonElement>();
  const queued = () => thread.queuedRunIds().length;
  return (
    <div class="turn-status" classList={{ idle: props.state === null && queued() === 0 }}>
      <Show when={props.state}>{(state) => <WorkingText waiting={state() === "waiting"} />}</Show>
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
