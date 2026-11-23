import { useDispatch, useInFlight, useResource } from "treflex-solid";
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
import { Composer, COMPOSER_LANE, FileDropSection } from "./Composer";
import { DiffPanel } from "./DiffPanel";
import Environment from "./Environment";
import HistoryWindow, { loadEarlier } from "./HistoryWindow";
import { type IThreadMenuItem, ThreadMenu, UsageRing } from "./HeaderActions";
import { ChevronDown } from "./icons";
import { useNavigation } from "./navigation";
import OpenThread, { latestDiffTurn, timelineItem } from "./OpenThread";
import { PendingApproval, PendingQuestion, UnansweredRequest } from "./RequestViews";
import { runStatus } from "./Shell";
import { SidebarToggle } from "./Sidebar";
import { SurfaceLauncher } from "./SurfaceLauncher";
import { type ISurfaceKind, surfaceActions } from "./surfaces";
import { closeTerminal, openTerminal, toggleTerminal } from "./Terminal";
import { TerminalPanel } from "./TerminalPanel";
import { DetailsSurface, ThreadDetailsCard } from "./ThreadDetailsPanel";
import { ThreadErrorBanner } from "./ThreadErrorBanner";
import { detailsLayout } from "./threadDetailsLayout";
import ThreadSession, { type IThreadSession } from "./ThreadSession";
import { type IResponseSegments, segmentResponses, startsResponse } from "./timelineLayout";
import { TimelineResponse } from "./TimelineResponse";
import { RewindDialog } from "./TimelineRows";
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
import { Button } from "./ui/Button";
import { BREADCRUMB, CRUMB_MUTED, CRUMB_SEPARATOR, CRUMB_TITLE, PageHeader } from "./ui/PageHeader";
import { SheetBackdrop, sheetPopupVariants } from "./ui/Sheet";
import { createMediaQuery, enterPanel, PANEL_SHEET_QUERY } from "./viewport";

const SCROLL_UP_KEYS = new Set(["ArrowUp", "PageUp", "Home"]);

/** `chat-stage` and `with-details` have no rule: the timeline and the composer lane key on them. */
export const CHAT_STAGE =
  "chat-stage relative flex min-h-0 flex-1 flex-col [--turn-status-height:24px] data-checklist:[--checklist-row-height:22px] data-checklist:[--turn-status-height:calc(var(--checklist-rows)*var(--checklist-row-height)+8px)]";

const CONTENT_COLUMN =
  "mx-auto w-full max-w-(--chat-content-max-width) min-w-0 in-[.chat-stage.with-details]:max-w-[min(var(--chat-content-max-width),var(--details-lane,100%))] in-[.chat-stage.with-details]:translate-x-(--details-shift)";

const NOTICE =
  "mx-auto my-0 w-full max-w-(--chat-content-max-width) py-1 text-[14px] text-warning-foreground";

const RIGHT_PANEL_COLUMN =
  "flex h-full min-w-0 flex-[0_0_min(42rem,53%)] flex-col border-l border-border bg-background transition-[translate,opacity] duration-200 ease-in-out data-starting-style:translate-x-8 data-starting-style:opacity-0";

const RIGHT_PANEL_SHEET = `${sheetPopupVariants({ side: "right", surface: "right-panel" })} pr-[env(safe-area-inset-right)]`;

const CRUMB_LINK =
  "group/crumb inline-flex flex-none cursor-pointer items-center gap-1.5 rounded-xs border-0 bg-transparent p-0 text-muted-foreground hover:text-foreground";

const LoadEarlier = HistoryWindow.provider(() => {
  const history = HistoryWindow.use();
  const loading = useInFlight(loadEarlier, () => history.state);
  return (
    <>
      <Show when={history.state.HasMore}>
        <button
          type="button"
          class="mb-4 flex w-full cursor-pointer items-center gap-3 py-1.5 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-default"
          disabled={loading()}
          onClick={() => history.loadEarlier()}
        >
          <span aria-hidden="true" class="h-px flex-1 bg-border/70" />
          <span class="shrink-0">{loading() ? "Loading…" : "Load earlier"}</span>
          <span aria-hidden="true" class="h-px flex-1 bg-border/70" />
        </button>
      </Show>
      <Show when={history.state.Error}>
        <p class={NOTICE}>{history.state.Error}</p>
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
      class="block h-px w-full border-0 bg-transparent p-0"
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
  const dispatch = useDispatch();
  const onTerminal = (action: typeof openTerminal) =>
    void dispatch(action, session.state.Terminal.$Id);
  const terminalOpen = () => session.state.Terminal.Open;
  const diffOpen = () => session.state.Panels.Diff !== null;
  const launcherOpen = () => session.state.Panels.Launcher.Open && !diffOpen();
  const rightPanelOpen = () => diffOpen() || launcherOpen();
  const panelSheet = createMediaQuery(PANEL_SHEET_QUERY);
  const [panelMotion, setPanelMotion] = createSignal(false);
  // Late, so panels already open on a thread switch don't slide in again.
  onMount(() => requestAnimationFrame(() => requestAnimationFrame(() => setPanelMotion(true))));
  const closeTopSheet = () =>
    rightPanelOpen() ? void session.closeRightPanel() : onTerminal(closeTerminal);
  const [stageSize, setStageSize] = createSignal({ Width: 0, Height: 0 });
  const details = () => session.state.Panels.Details;
  const layout = createMemo(() =>
    detailsLayout({
      ...stageSize(),
      Padding: 48,
      MaxChatWidth: 736,
      Open: environment.state.Local.Preferences.DetailsOpen,
    }),
  );
  // The session toggles the card by whether it fits, which only this view can measure.
  const measureStage = (size: { Width: number; Height: number }) => {
    setStageSize(size);
    if (layout().Inline !== details().Fits) void session.fitDetails(layout().Inline);
  };
  const detailsInline = () => layout().Inline && environment.state.Local.Preferences.DetailsOpen;
  const detailsShown = () => detailsInline() || details().Popover;
  const navigation = useNavigation();
  const projectScripts = () => {
    const projectId = thread.state.Thread?.projectId;
    return projectId === undefined
      ? []
      : (environment.state.Replica.Shell.Projects[projectId]?.scripts ?? []);
  };
  const launcher = () =>
    surfaceActions({
      TerminalAvailable: session.panels().Terminal,
      DiffAvailable: session.panels().Details,
    });
  const openSurface = (kind: ISurfaceKind) => {
    if (kind === "terminal") {
      void session.closeLauncher();
      onTerminal(openTerminal);
    } else if (kind === "diff") {
      void session.openDiff(latestDiffTurn(thread.state) === null ? "branch" : "thread", null);
    }
  };
  let scroller!: HTMLDivElement;
  let content!: HTMLDivElement;
  let head!: HTMLDivElement;
  let stage!: HTMLDivElement;
  let lane!: HTMLDivElement;
  let menuButton: HTMLButtonElement | undefined;
  const menuItems = (): IThreadMenuItem[] => [
    ...(!session.panels().Details
      ? []
      : [
          {
            Label: "Details",
            On: detailsShown(),
            Shortcut: navigation.shortcut("threadPanel.toggle"),
            Run: () => void session.toggleDetails(),
          },
        ]),
    ...(!session.panels().Terminal
      ? []
      : [
          {
            Label: "Terminal",
            On: terminalOpen(),
            Shortcut: navigation.shortcut("terminal.toggle"),
            Run: () => onTerminal(toggleTerminal),
          },
        ]),
    {
      Label: "Diff",
      On: rightPanelOpen(),
      Shortcut: navigation.shortcut("rightPanel.toggle"),
      Run: () => void session.toggleRightPanel(),
    },
    {
      Label: "Layout debug",
      On: environment.state.Local.ViewportDebug,
      Shortcut: null,
      Run: () => void environment.toggleViewportDebug(),
    },
  ];
  const saved = untrack(() => session.state.Scroll);
  const [stuck, setStuck] = createSignal(saved === null);
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
    release();
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
    const moved = firstAfterChange(held.Ids, ids, held.First, saved?.RowId ?? null);
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
  const readingAt = (): IThreadSession["Scroll"] => {
    const top = scroller.getBoundingClientRect().top;
    const markers = content.querySelectorAll<HTMLElement>("[data-response]");
    let low = 0;
    let high = markers.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (markers[middle]!.getBoundingClientRect().top > top) high = middle;
      else low = middle + 1;
    }
    const marker = markers[Math.max(0, low - 1)];
    return marker?.dataset.response === undefined
      ? null
      : {
          RowId: marker.dataset.response,
          Offset: Math.round(marker.getBoundingClientRect().top - top),
        };
  };
  let remembered = saved;
  const remember = () => {
    const scroll = stuck() ? null : readingAt();
    if (scroll?.RowId === remembered?.RowId && scroll?.Offset === remembered?.Offset) return;
    remembered = scroll;
    void session.rememberScroll(scroll);
  };
  // History pages the server sent before the thread expired aren't fetched again, so a place
  // in them is gone and the return follows the end instead.
  let restoring = saved !== null;
  // Rows below the place can still be growing when it's put back, which clamps the scroll short
  // (and at the end, where a clamped scroll would read as following it), so it's put back again
  // as they grow, until the reader scrolls.
  let holding: HTMLElement | null = null;
  const putBack = () => {
    if (holding === null || saved === null || !holding.isConnected) return;
    scroller.scrollBy(
      0,
      holding.getBoundingClientRect().top - scroller.getBoundingClientRect().top - saved.Offset,
    );
    lastPosition = position();
  };
  const release = () => {
    restoring = false;
    holding = null;
  };
  createEffect(() => {
    if (!restoring || saved === null) return;
    const ids = timeline().Ids;
    if (responses()?.Starts.includes(saved.RowId)) {
      holding = content.querySelector(`[data-response="${CSS.escape(saved.RowId)}"]`);
      if (holding === null) return;
      restoring = false;
      putBack();
    } else if (ids.includes(saved.RowId)) {
      growTo(ids.indexOf(saved.RowId));
    } else if (thread.threadSynchronized() && ids.length > 0) {
      restoring = false;
      setStuck(true);
      scrollToEnd();
    }
  });
  onMount(() => {
    const observer = new ResizeObserver(() => {
      if (stuck()) scrollToEnd();
      else putBack();
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
      measureStage({ Width: stage.clientWidth, Height: stage.clientHeight });
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
    <div class="relative flex h-full" classList={{ "panel-motion": panelMotion() }}>
      <Show when={panelSheet() && (rightPanelOpen() || terminalOpen())}>
        <SheetBackdrop contained ref={enterPanel} onClick={closeTopSheet} />
      </Show>
      <FileDropSection>
        <PageHeader>
          <SidebarToggle />
          <div class={BREADCRUMB}>
            <Show when={session.projectName()}>
              {(name) => (
                <>
                  <button
                    class={CRUMB_LINK}
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
                    <span class={`${CRUMB_MUTED} group-hover/crumb:text-foreground`}>{name()}</span>
                  </button>
                  <span class={CRUMB_SEPARATOR}>/</span>
                </>
              )}
            </Show>
            <h1 class={CRUMB_TITLE} data-tip={thread.state.Thread?.title}>
              {thread.state.Thread?.title ?? "Loading thread…"}
            </h1>
            <Show when={!thread.threadSynchronized()}>
              <span class="flex-none text-[12px] font-normal text-muted-foreground">syncing</span>
            </Show>
          </div>
          <div class="flex flex-none gap-1">
            <UsageRing />
            <ThreadMenu ref={(button) => (menuButton = button)} items={menuItems()} />
          </div>
        </PageHeader>
        <Show when={endedReason()}>
          {(reason) => <p class={NOTICE}>This thread's stream ended: {reason()}</p>}
        </Show>
        <Show when={retrying()}>
          <p class={NOTICE}>Can't load this thread right now. Retrying.</p>
        </Show>
        <div
          class={CHAT_STAGE}
          classList={{ "with-details": detailsInline() }}
          data-checklist={checklist() === null ? undefined : ""}
          ref={stage}
          style={{
            "--checklist-rows": statusRows(),
            "--details-shift": `${layout().Shift}px`,
            "--details-lane": layout().LaneWidth === null ? undefined : `${layout().LaneWidth}px`,
          }}
        >
          <Show when={session.threadError()}>
            {(error) => (
              <div
                class={`pointer-events-none absolute inset-x-0 top-0 z-30 flex flex-col ${CONTENT_COLUMN}`}
              >
                <ThreadErrorBanner
                  error={error()}
                  onDismiss={() => session.dismissThreadError(error())}
                />
              </div>
            )}
          </Show>
          <Show when={session.state.Details} keyed>
            {(details) => (
              <DetailsSurface
                inline={layout().Inline}
                shown={detailsShown()}
                anchor={menuButton}
                onDismiss={() => session.closeDetailsPopover()}
              >
                <ThreadDetailsCard
                  state={session.state.Git}
                  details={details}
                  branch={thread.state.Thread?.branch ?? null}
                  scripts={projectScripts()}
                  running={turnState() !== null}
                  shown={detailsShown()}
                />
              </DetailsSurface>
            )}
          </Show>
          <div
            class="min-h-0 flex-1 [scrollbar-gutter:stable_both-edges] overflow-x-hidden overflow-y-auto px-[calc(var(--gutter)-var(--app-scrollbar-width))] pt-2 pb-[calc(var(--composer-height,0px)+var(--turn-status-height))] [mask-image:linear-gradient(to_bottom,transparent_0,black_1.5rem)] focus-visible:outline-none"
            ref={scroller}
            data-timeline
            data-tip-scroll-dismiss
            tabIndex={-1}
            onScroll={() => {
              if (holding !== null) {
                lastPosition = position();
                return;
              }
              const next = position();
              const follow = followAfterScroll(lastPosition, next, touching || dragging);
              if (follow === "stick") setStuck(true);
              else if (follow === "detach") setStuck(false);
              lastPosition = next;
              if (!restoring) remember();
            }}
            onWheel={(event) => {
              release();
              if (event.deltaY < 0 && scroller.scrollTop > 0) setStuck(false);
            }}
            onKeyDown={(event) => {
              release();
              if (SCROLL_UP_KEYS.has(event.key) && scroller.scrollTop > 0) setStuck(false);
            }}
            onTouchStart={() => {
              release();
              touching = true;
            }}
            onTouchEnd={() => (touching = false)}
            onTouchCancel={() => (touching = false)}
            onPointerDown={(event) => {
              // A press on the scroller itself, not on a row, is its scrollbar.
              if (event.target !== scroller) return;
              release();
              dragging = true;
              document.addEventListener("pointerup", () => (dragging = false), { once: true });
            }}
          >
            <div class={CONTENT_COLUMN} ref={content}>
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
                  <>
                    <span class="block h-0" data-response={start} />
                    <TimelineResponse
                      ids={responses()?.Segments[start] ?? []}
                      latest={start === lastStart()}
                    />
                  </>
                )}
              </For>
              <For each={thread.pendingApprovalIds()}>
                {(id) => <PendingApproval state={thread.state.RuntimeRequests[id]!} />}
              </For>
              <Show when={thread.state.Thread !== null && thread.state.Timeline.length === 0}>
                <p class="py-12 text-center text-sm text-muted-foreground">
                  Send a message to start the conversation.
                </p>
              </Show>
            </div>
          </div>
          <div class={COMPOSER_LANE} ref={lane}>
            <Show when={!stuck()}>
              <Button
                variant="glass"
                size="xs"
                class="absolute bottom-[calc(100%+var(--turn-status-height)+4px)] left-1/2 z-30 -translate-x-1/2"
                onClick={() => {
                  release();
                  scrollToEnd();
                }}
              >
                <ChevronDown class="size-3.5" />
                Scroll to end
              </Button>
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
            <RewindDialog />
          </div>
        </div>
        <Show when={terminalOpen()}>
          <TerminalPanel state={session.state.Terminal} />
        </Show>
      </FileDropSection>
      <Show when={rightPanelOpen()}>
        <aside ref={enterPanel} class={panelSheet() ? RIGHT_PANEL_SHEET : RIGHT_PANEL_COLUMN}>
          <Show
            when={session.state.Panels.Diff}
            keyed
            fallback={
              <SurfaceLauncher
                actions={launcher()}
                onRun={openSurface}
                onClose={() => session.closeLauncher()}
              />
            }
          >
            {(panel) => <DiffPanel panel={panel} />}
          </Show>
        </aside>
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
