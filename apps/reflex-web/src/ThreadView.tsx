import { useResource } from "treflex-solid";
import {
  createComputed,
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  onCleanup,
  onMount,
  Show,
  untrack,
} from "solid-js";

import { ProjectBadge } from "./brand";
import { Composer, FileDropSection } from "./Composer";
import { DiffPanel } from "./DiffPanel";
import Environment from "./Environment";
import HistoryWindow from "./HistoryWindow";
import { ChevronDown, PanelBottom, PanelRight, SquareMenu } from "./icons";
import { withShortcut } from "./keybindings";
import { useNavigation } from "./navigation";
import OpenThread, { latestDiffTurn, timelineItem } from "./OpenThread";
import { PendingApproval, PendingQuestion, UnansweredRequest } from "./RequestViews";
import { runStatus } from "./Shell";
import { SidebarToggle } from "./Sidebar";
import { SurfaceLauncher } from "./SurfaceLauncher";
import { type ISurfaceKind, surfaceActions } from "./surfaces";
import { TerminalPanel } from "./TerminalPanel";
import type { ICheckout } from "./ThreadDetails";
import { DetailsSurface, ThreadDetailsCard } from "./ThreadDetailsPanel";
import { detailsLayout } from "./threadDetailsLayout";
import ThreadSession from "./ThreadSession";
import { type IResponseSegments, segmentResponses, startsResponse } from "./timelineLayout";
import { TimelineResponse } from "./TimelineResponse";
import {
  firstAfterChange,
  followAfterScroll,
  grow,
  type IScrollPosition,
  INITIAL_ROWS,
  keepsWindow,
  trimToTail,
} from "./timelineWindow";

import { checklistRows, TurnStatus, useChecklist } from "./TurnStatus";
import { createMediaQuery, PANEL_SHEET_QUERY } from "./viewport";

const SCROLL_UP_KEYS = new Set(["ArrowUp", "PageUp", "Home"]);

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

const FOCUSABLE =
  "a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex='-1'])";

function isTabbable(element: Element): boolean {
  if (!element.matches(FOCUSABLE)) return false;
  const details = element.parentElement?.closest("details");
  return details == null || details.open || element.closest("summary") !== null;
}

function tabbableFrom(
  root: HTMLElement,
  start: Element | null,
  forward: boolean,
): HTMLElement | null {
  if (start === null || !start.isConnected) return null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  walker.currentNode = start;
  const step = () => (forward ? walker.nextNode() : walker.previousNode());
  for (let node = step(); node !== null; node = step()) {
    if (node !== root && isTabbable(node as Element)) return node as HTMLElement;
  }
  return null;
}

function TimelineSentinel(props: {
  root: HTMLElement;
  onReach: () => void;
  onFocus: (forward: boolean) => void;
}) {
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
      onFocus={(event) => {
        const from = event.relatedTarget;
        props.onFocus(
          !(from instanceof Node) ||
            (from.compareDocumentPosition(event.currentTarget) &
              Node.DOCUMENT_POSITION_FOLLOWING) !==
              0,
        );
      }}
      onClick={() => props.onFocus(true)}
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
  const turnState = () => {
    const run = thread.latestRun();
    const status = run === null ? null : runStatus(run.status);
    return status === "running" || status === "waiting" ? status : null;
  };
  const checklist = useChecklist(() => turnState() !== null);
  const terminalOpen = () => session.state.Terminal.Open;
  const diffOpen = () => session.state.Panels.Diff.Open;
  const launcherOpen = () => session.state.Panels.Launcher.Open && !diffOpen();
  const rightPanelOpen = () => diffOpen() || launcherOpen();
  const panelSheet = createMediaQuery(PANEL_SHEET_QUERY);
  const closeTopSheet = () =>
    rightPanelOpen() ? session.closeRightPanel() : session.closeTerminal();
  const [stageSize, setStageSize] = createSignal({ Width: 0, Height: 0 });
  const details = () => session.state.Panels.Details;
  const layout = createMemo(() =>
    detailsLayout({
      ...stageSize(),
      Padding: 48,
      MaxChatWidth: 736,
      Open: details().Open,
    }),
  );
  // The session toggles the card by whether it fits, which only this view can measure.
  createEffect(() => {
    const fits = layout().Inline;
    if (untrack(() => details().Fits) !== fits) void session.fitDetails(fits);
  });
  onCleanup(() => void session.closeDetailsPopover());
  const detailsInline = () => layout().Inline && details().Open;
  const detailsShown = () => detailsInline() || details().Popover;
  const navigation = useNavigation();
  const checkout = createMemo<ICheckout | null>((previous) => {
    const held = thread.state.Thread;
    const project =
      held == null ? undefined : environment.state.Replica.Shell.Projects[held.projectId];
    if (held == null || project === undefined) return null;
    const next = {
      EnvironmentId: environment.state.EnvironmentId,
      ThreadId: held.id,
      ProjectId: held.projectId,
      Cwd: held.worktreePath ?? project.workspaceRoot,
      ProjectRoot: project.workspaceRoot,
      WorktreePath: held.worktreePath,
    };
    return previous !== null && JSON.stringify(previous) === JSON.stringify(next) ? previous : next;
  }, null);
  const projectScripts = () => {
    const projectId = thread.state.Thread?.projectId;
    return projectId === undefined
      ? []
      : (environment.state.Replica.Shell.Projects[projectId]?.scripts ?? []);
  };
  const launcher = () =>
    surfaceActions({
      TerminalAvailable: thread.state.Thread !== null,
      DiffAvailable: checkout() !== null,
    });
  const openSurface = (kind: ISurfaceKind) => {
    if (kind === "terminal") {
      void session.closeLauncher();
      void session.openTerminal();
    } else if (kind === "diff") {
      void session.openDiff(latestDiffTurn(thread.state) === null ? "branch" : "thread", null);
    }
  };
  let scroller!: HTMLDivElement;
  let content!: HTMLDivElement;
  let head!: HTMLDivElement;
  let stage!: HTMLDivElement;
  let lane!: HTMLDivElement;
  let detailsToggle: HTMLButtonElement | undefined;
  const [stuck, setStuck] = createSignal(true);
  const position = (): IScrollPosition => ({
    Top: scroller.scrollTop,
    Height: scroller.scrollHeight,
    ClientHeight: scroller.clientHeight,
  });
  let lastPosition: IScrollPosition = { Top: 0, Height: 0, ClientHeight: 0 };
  let touching = false;
  let dragging = false;
  const scrollToEnd = () => {
    scroller.scrollTop = scroller.scrollHeight;
  };
  const statusRows = createMemo(() => checklistRows(checklist()));
  // The status band sits outside the lane's box, so the lane's observer misses its resize.
  createEffect(
    on(
      statusRows,
      () => {
        if (untrack(stuck)) scrollToEnd();
      },
      { defer: true },
    ),
  );
  const onComposerSend = () => {
    setStuck(true);
    scrollToEnd();
  };

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
  let correcting = false;
  const keepStill = () => {
    if (correcting) return;
    const anchor = firstVisible();
    if (anchor === null) return;
    const before = anchor.getBoundingClientRect().top;
    correcting = true;
    // Measured after the patch, so native anchoring has applied; the difference is 0 where it did.
    queueMicrotask(() => {
      correcting = false;
      if (anchor.isConnected) scroller.scrollBy(0, anchor.getBoundingClientRect().top - before);
    });
  };

  const startsAt = (id: string) => {
    const item = untrack(() => timelineItem(thread.state, id));
    return item !== undefined && startsResponse(item);
  };
  // A response lays out as a whole, so the window starts at a prompt.
  const snap = (ids: readonly string[], first: number) => {
    let at = first;
    while (at > 0 && !startsAt(ids[at]!)) at -= 1;
    return at;
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
    const isStuck = untrack(stuck);
    const first = snap(ids, isStuck ? trimToTail(ids.length, moved, held.Floor) : moved);
    if (!isStuck && !keepsWindow(held.Ids, held.First, ids, first)) keepStill();
    // A retained thread has rows before the scroller mounts, and there's no scroll to keep then.
    const trimmed = held.Ids.length > 0 && first !== moved;
    const before = trimmed ? scroller.scrollTop : 0;
    setTimeline({ ...held, Ids: ids, First: first });
    // Only the trim's own shift, so the scroll event it causes isn't read as the user scrolling up
    // and a scroll-up in the same frame still is.
    if (trimmed)
      queueMicrotask(() => {
        lastPosition = { ...lastPosition, Top: lastPosition.Top + scroller.scrollTop - before };
      });
  });
  const windowIds = createMemo(() => {
    const held = timeline();
    return held.Ids.slice(held.First);
  });
  const responses = createMemo<IResponseSegments | undefined>((previous) =>
    segmentResponses(previous, windowIds(), startsAt),
  );
  const lastStart = () => responses()?.Starts.at(-1);
  const reachedTop = () => timeline().First === 0;
  const growTo = (target: number) => {
    if (!stuck()) keepStill();
    setTimeline((held) => ({
      ...held,
      First: snap(held.Ids, target),
      Floor: stuck() ? Math.max(held.Floor, held.Ids.length - target) : held.Floor,
    }));
  };
  const showAll = (forward: boolean) => {
    const boundary = head.nextElementSibling;
    setStuck(false);
    growTo(0);
    queueMicrotask(() => {
      const target = forward
        ? tabbableFrom(content, head, true)
        : tabbableFrom(content, boundary, false);
      (target ?? scroller).focus();
    });
  };
  onMount(() => {
    const observer = new ResizeObserver(() => {
      if (stuck()) scrollToEnd();
    });
    observer.observe(content);
    const laneObserver = new ResizeObserver(() => {
      stage.style.setProperty("--composer-height", `${lane.offsetHeight}px`);
      if (stuck()) scrollToEnd();
    });
    // Border box: the keyboard changes only the lane's bottom padding.
    laneObserver.observe(lane, { box: "border-box" });
    // The stage shrinks under an opening keyboard with no change to the content or the lane.
    const stageObserver = new ResizeObserver(() => {
      setStageSize({ Width: stage.clientWidth, Height: stage.clientHeight });
      if (stuck()) scrollToEnd();
    });
    stageObserver.observe(stage);
    onCleanup(() => {
      observer.disconnect();
      laneObserver.disconnect();
      stageObserver.disconnect();
    });
  });
  return (
    <div class="thread-layout" classList={{ "panel-sheet": panelSheet() }}>
      <FileDropSection>
        <header class="thread-header">
          <SidebarToggle />
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
                    <ProjectBadge
                      project={environment.state.Replica.Shell.Projects[session.projectId() ?? ""]}
                      size={14}
                    />
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
            <Show when={checkout() !== null}>
              <button
                ref={detailsToggle}
                class="icon-button toggle"
                classList={{ pressed: detailsShown() }}
                aria-label="Toggle thread details panel"
                data-tip={withShortcut(
                  "Toggle thread details",
                  navigation.shortcut("threadPanel.toggle"),
                )}
                aria-pressed={detailsShown()}
                onClick={() => session.toggleDetails()}
              >
                <SquareMenu />
              </button>
            </Show>
            <Show when={thread.state.Thread !== null}>
              <button
                class="icon-button toggle"
                classList={{ pressed: terminalOpen() }}
                aria-label="Toggle terminal drawer"
                data-tip={withShortcut(
                  "Toggle terminal drawer",
                  navigation.shortcut("terminal.toggle"),
                )}
                aria-pressed={terminalOpen()}
                onClick={() => session.toggleTerminal()}
              >
                <PanelBottom />
              </button>
            </Show>
            <button
              class="icon-button toggle"
              classList={{ pressed: rightPanelOpen() }}
              aria-label="Toggle right panel"
              data-tip={withShortcut(
                "Toggle right panel",
                navigation.shortcut("rightPanel.toggle"),
              )}
              aria-pressed={rightPanelOpen()}
              onClick={() => session.toggleRightPanel()}
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
          class="chat-stage"
          classList={{ "has-checklist": checklist() !== null, "with-details": detailsInline() }}
          ref={stage}
          style={{
            "--checklist-rows": statusRows(),
            "--details-shift": `${layout().Shift}px`,
            "--details-lane": layout().LaneWidth === null ? undefined : `${layout().LaneWidth}px`,
          }}
        >
          <Show when={checkout()} keyed>
            {(held) => (
              <Show when={detailsShown()}>
                <DetailsSurface
                  inline={detailsInline()}
                  anchor={detailsToggle}
                  onDismiss={() => session.closeDetailsPopover()}
                >
                  <ThreadDetailsCard
                    state={session.state.Git}
                    checkout={held}
                    scripts={projectScripts()}
                    running={turnState() !== null}
                  />
                </DetailsSurface>
              </Show>
            )}
          </Show>
          <div
            class="timeline"
            ref={scroller}
            tabIndex={-1}
            onScroll={() => {
              const next = position();
              const follow = followAfterScroll(lastPosition, next, touching || dragging);
              if (follow === "stick") setStuck(true);
              else if (follow === "detach") setStuck(false);
              lastPosition = next;
            }}
            onWheel={(event) => {
              if (event.deltaY < 0 && scroller.scrollTop > 0) setStuck(false);
            }}
            onKeyDown={(event) => {
              if (SCROLL_UP_KEYS.has(event.key) && scroller.scrollTop > 0) setStuck(false);
            }}
            onTouchStart={() => (touching = true)}
            onTouchEnd={() => (touching = false)}
            onTouchCancel={() => (touching = false)}
            onPointerDown={(event) => {
              // A press on the scroller itself, not on a row, is its scrollbar.
              if (event.target !== scroller) return;
              dragging = true;
              document.addEventListener("pointerup", () => (dragging = false), { once: true });
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
              <For each={responses()?.Starts}>
                {(start) => (
                  <TimelineResponse
                    ids={responses()?.Segments[start] ?? []}
                    latest={start === lastStart()}
                  />
                )}
              </For>
              <For each={thread.pendingApprovalIds()}>
                {(id) => <PendingApproval state={thread.state.RuntimeRequests[id]!} />}
              </For>
              <Show when={thread.state.Thread !== null && thread.state.Timeline.length === 0}>
                <p class="empty">Nothing here yet.</p>
              </Show>
            </div>
          </div>
          <div class="composer-lane" ref={lane}>
            <Show when={!stuck()}>
              <button class="scroll-to-end" onClick={scrollToEnd}>
                <ChevronDown />
                Scroll to end
              </button>
            </Show>
            <TurnStatus state={turnState()} checklist={checklist()} />
            <For each={thread.pendingOtherIds()}>
              {(id) => <UnansweredRequest state={thread.state.RuntimeRequests[id]!} />}
            </For>
            <Show
              when={thread.pendingQuestionIds()[0]}
              keyed
              fallback={<Composer active={turnState() !== null} onSend={onComposerSend} />}
            >
              {(id) => (
                <PendingQuestion
                  state={thread.state.RuntimeRequests[id]!}
                  composer={(answering) => (
                    <Composer
                      active={turnState() !== null}
                      onSend={onComposerSend}
                      question={answering}
                    />
                  )}
                />
              )}
            </Show>
          </div>
        </div>
        <Show when={terminalOpen()}>
          <TerminalPanel />
        </Show>
      </FileDropSection>
      <Show when={panelSheet() && (rightPanelOpen() || terminalOpen())}>
        <div class="panel-backdrop" aria-hidden="true" onClick={closeTopSheet} />
      </Show>
      <Show when={diffOpen()}>
        <DiffPanel />
      </Show>
      <Show when={launcherOpen()}>
        <SurfaceLauncher
          actions={launcher()}
          onRun={openSurface}
          onClose={() => session.closeLauncher()}
        />
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
