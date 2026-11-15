import { useResource } from "treflex-solid";
import {
  createComputed,
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
  untrack,
} from "solid-js";

import { ProjectBadge } from "./brand";
import { Composer } from "./Composer";
import { DiffPanel } from "./DiffPanel";
import Environment from "./Environment";
import HistoryWindow from "./HistoryWindow";
import { ChevronDown, PanelBottom, PanelRight } from "./icons";
import OpenThread, { latestDiffTurn, runText } from "./OpenThread";
import { PendingApproval, RequestBanner } from "./RequestViews";
import { needsVisit, runStatus } from "./Shell";
import { TerminalPanel } from "./TerminalPanel";
import ThreadSession from "./ThreadSession";
import { TimelineRow } from "./TimelineRows";
import { firstAfterChange, grow, INITIAL_ROWS, trimToTail } from "./timelineWindow";

const LoadEarlier = HistoryWindow.provider(() => {
  const history = HistoryWindow.use();
  return (
    <>
      <Show when={history.state.HasMore}>
        <button
          class="button load-earlier"
          disabled={history.loadingEarlier()}
          onClick={() => history.loadEarlier()}
        >
          {history.loadingEarlier() ? "Loading…" : "Load earlier"}
        </button>
      </Show>
      <Show when={history.state.Error}>
        <p class="thread-notice">{history.state.Error}</p>
      </Show>
    </>
  );
});

function TimelineSentinel(props: { root: HTMLElement; onReach: () => void; onFocus: () => void }) {
  const [sentinel, setSentinel] = createSignal<HTMLButtonElement>();
  onMount(() => {
    const element = sentinel();
    if (element === undefined) return;
    const observer = new IntersectionObserver(
      (entries, held) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        props.onReach();
        // Observations report only changes, so one that leaves the sentinel in range re-observes it.
        if (!element.isConnected) return;
        held.unobserve(element);
        held.observe(element);
      },
      { root: props.root, rootMargin: "800px 0px 0px 0px" },
    );
    observer.observe(element);
    onCleanup(() => observer.disconnect());
  });
  return (
    <button
      ref={setSentinel}
      class="timeline-sentinel"
      aria-label="Show earlier messages"
      onFocus={() => props.onFocus()}
      onClick={() => props.onFocus()}
    />
  );
}

const ThreadBody = ThreadSession.provider(() => {
  const thread = OpenThread.use();
  const session = ThreadSession.use();
  const environment = Environment.use();
  const stream = useResource(() => thread.state, "Thread/Stream");
  const retrying = () => {
    const status = stream.status();
    return status.State === "live" && status.Detail === "retrying";
  };
  const endedReason = () => {
    const status = stream.status();
    return status.State === "ended" ? status.Reason : null;
  };
  const runState = () => {
    const run = thread.latestRun();
    return run === null ? null : runStatus(run.status);
  };
  // Once per completion, so a thread marked unread while open stays unread until the next one.
  let visitedCompletion: string | null | undefined;
  createEffect(() => {
    const row = environment.state.Replica.Shell.Threads[thread.state.ThreadId];
    if (row === undefined || !needsVisit(row)) return;
    if (visitedCompletion === row.latestRunCompletedAt) return;
    visitedCompletion = row.latestRunCompletedAt;
    environment.threadCommand(row.id, { Kind: "visit", VisitedAt: row.updatedAt });
  });
  const terminalOpen = () => session.state.Terminal.Open;
  const diffOpen = () => session.state.Panels.Diff.Open;
  let scroller!: HTMLDivElement;
  let content!: HTMLDivElement;
  let head!: HTMLDivElement;
  const [stuck, setStuck] = createSignal(true);
  let lastTop = 0;
  const scrollToEnd = () => {
    scroller.scrollTop = scroller.scrollHeight;
  };

  const [timeline, setTimeline] = createSignal({
    Ids: [] as readonly string[],
    First: 0,
    Floor: INITIAL_ROWS,
  });
  createComputed(() => {
    const ids = thread.timelineIds();
    const held = untrack(timeline);
    const moved = firstAfterChange(held.Ids, ids, held.First);
    const first = untrack(stuck) ? trimToTail(ids.length, moved, held.Floor) : moved;
    setTimeline({ ...held, Ids: ids, First: first });
    // In this task, so the scroll event the trim causes isn't read as the user scrolling up.
    if (first !== moved)
      queueMicrotask(() => {
        scrollToEnd();
        lastTop = scroller.scrollTop;
      });
  });
  const windowIds = createMemo(() => {
    const held = timeline();
    return held.Ids.slice(held.First);
  });
  const reachedTop = () => timeline().First === 0;
  const growTo = (first: number) =>
    setTimeline((held) => ({
      ...held,
      First: first,
      Floor: stuck() ? Math.max(held.Floor, held.Ids.length - first) : held.Floor,
    }));
  const showAll = () => {
    growTo(0);
    scroller.focus({ preventScroll: true });
  };

  let anchor: Element | null = null;
  let anchorOffset = 0;
  const offsetOf = (element: Element) =>
    element.getBoundingClientRect().top - content.getBoundingClientRect().top;
  const firstVisible = (): Element | null => {
    const children = content.children;
    const top = scroller.getBoundingClientRect().top;
    let low = 0;
    let high = children.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (children[middle]!.getBoundingClientRect().bottom > top) high = middle;
      else low = middle + 1;
    }
    const found = children[low] ?? null;
    return found === head ? head.nextElementSibling : found;
  };
  const recordAnchor = () => {
    anchor = firstVisible();
    anchorOffset = anchor === null ? 0 : offsetOf(anchor);
  };
  onMount(() => {
    const observer = new ResizeObserver(() => {
      if (stuck()) {
        scrollToEnd();
        return;
      }
      if (anchor?.isConnected) {
        const shift = offsetOf(anchor) - anchorOffset;
        if (shift !== 0) scroller.scrollBy(0, shift);
      }
      recordAnchor();
    });
    observer.observe(content);
    onCleanup(() => observer.disconnect());
  });
  return (
    <div class="thread-layout">
      <section class="thread">
        <header class="thread-header">
          <div class="breadcrumb">
            <Show when={session.projectName()}>
              {(name) => (
                <>
                  <button
                    class="crumb-link"
                    aria-label={`New thread in ${name()}`}
                    data-tip={`New thread in ${name()}`}
                    onClick={() => {
                      const projectId = thread.state.Thread?.projectId;
                      if (projectId !== undefined) environment.newThread(projectId);
                    }}
                  >
                    <ProjectBadge name={name()} size={14} />
                    <span class="crumb-project">{name()}</span>
                  </button>
                  <span class="crumb-separator">/</span>
                </>
              )}
            </Show>
            <h1 data-tip={thread.state.Thread?.title}>
              {thread.state.Thread?.title ?? "Loading thread…"}
            </h1>
            <Show when={!thread.threadSynchronized()}>
              <span class="crumb-note">syncing</span>
            </Show>
          </div>
          <div class="panel-controls">
            <Show when={thread.state.Thread !== null}>
              <button
                class="icon-button toggle"
                classList={{ pressed: terminalOpen() }}
                aria-label="Toggle terminal drawer"
                data-tip="Toggle terminal drawer"
                aria-pressed={terminalOpen()}
                onClick={() => (terminalOpen() ? session.closeTerminal() : session.openTerminal())}
              >
                <PanelBottom />
              </button>
            </Show>
            <button
              class="icon-button toggle"
              classList={{ pressed: diffOpen() }}
              aria-label="Toggle thread diff"
              data-tip="Toggle thread diff"
              aria-pressed={diffOpen()}
              disabled={!diffOpen() && latestDiffTurn(thread.state) === null}
              onClick={() => (diffOpen() ? session.closeDiff() : session.openDiff("thread", null))}
            >
              <PanelRight />
            </button>
          </div>
        </header>
        <Show when={endedReason()}>
          {(reason) => <p class="thread-notice">This thread's stream ended: {reason()}</p>}
        </Show>
        <Show when={retrying()}>
          <p class="thread-notice">Can't load this thread right now. Retrying.</p>
        </Show>
        <div
          class="timeline"
          ref={scroller}
          tabIndex={-1}
          onScroll={() => {
            const top = scroller.scrollTop;
            if (scroller.scrollHeight - top - scroller.clientHeight < 40) setStuck(true);
            // Only an upward scroll detaches: the scroll event can land after more content
            // arrived, which leaves a follow-up scroll looking far from the end.
            else if (top < lastTop) setStuck(false);
            lastTop = top;
            if (!stuck()) recordAnchor();
          }}
        >
          <div class="timeline-lane" ref={content}>
            <div ref={head}>
              <Show
                when={reachedTop()}
                fallback={
                  <TimelineSentinel
                    root={scroller}
                    onReach={() => growTo(grow(timeline().First))}
                    onFocus={showAll}
                  />
                }
              >
                <Show when={thread.state.History} keyed>
                  {(history) => <LoadEarlier state={history} />}
                </Show>
              </Show>
            </div>
            <For each={windowIds()}>{(id) => <TimelineRow id={id} />}</For>
            <For each={thread.pendingApprovalIds()}>
              {(id) => <PendingApproval state={thread.state.RuntimeRequests[id]!} />}
            </For>
            <Show when={thread.state.Thread !== null && thread.state.Timeline.length === 0}>
              <p class="empty">Nothing here yet.</p>
            </Show>
          </div>
        </div>
        <div class="composer-lane">
          <Show when={!stuck()}>
            <button class="scroll-to-end" onClick={scrollToEnd}>
              <ChevronDown />
              Scroll to end
            </button>
          </Show>
          <For each={thread.pendingQuestionIds()}>
            {(id) => <RequestBanner state={thread.state.RuntimeRequests[id]!} />}
          </For>
          <Show when={thread.queuedRunIds().length > 0}>
            <div class="composer-banner">
              <div class="banner-title">
                <strong>Queued</strong>
                <Show when={runState() !== "running" && runState() !== "waiting"}>
                  <button
                    class="button"
                    disabled={session.queueing()}
                    onClick={() => session.queueAction(null)}
                  >
                    Resume
                  </button>
                </Show>
              </div>
              <For each={thread.queuedRunIds()}>
                {(runId) => (
                  <p class="queued">
                    <button
                      class="button"
                      disabled={session.queueing()}
                      onClick={() => session.queueAction(runId)}
                    >
                      Cancel
                    </button>
                    <span>{runText(thread.state, runId)}</span>
                  </p>
                )}
              </For>
            </div>
          </Show>
          <Composer active={runState() === "running" || runState() === "waiting"} />
        </div>
        <Show when={terminalOpen()}>
          <TerminalPanel />
        </Show>
      </section>
      <Show when={diffOpen()}>
        <DiffPanel />
      </Show>
    </div>
  );
});

export const ThreadView = OpenThread.provider(() => {
  const thread = OpenThread.use();
  const environment = Environment.use();
  return (
    <Show when={environment.state.Local.ThreadSessions[thread.state.ThreadId]} keyed>
      {(session) => <ThreadBody state={session} />}
    </Show>
  );
});
