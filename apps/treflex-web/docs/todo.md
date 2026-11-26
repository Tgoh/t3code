# Todo

Everything in the pipeline for the treflex client, in the order to do it. Within a stage, the items can run in parallel threads unless an item says otherwise. An item being worked on is marked **In progress** with its branch. Gaps against stock that nobody has asked for yet go in [issues.md](./issues.md) instead. The long-term goal is full parity with stock, so `issues.md`'s gaps move in here a few at a time.

## 1. Style parity

Nothing hand-rolled that stock already has. Before parity and the missing features, so new work uses the shared components.

- **Shared components, the gaps left.** Stock's tokens and `components/ui` are ported (see the README's "Components copied from stock"). What remains:
  - Stock's overlay scrollbars, which need JavaScript scrollbars; treflex keeps native ones.
  - Press-and-drag to pick a menu item, and Select's popup growing as it scrolls in aligned mode.
  - `MiddleTruncate`, for branch and path names.
  - The timeline sender label, which stock replaces with an "Open thread" button in the message actions, and the sidebar's "Show more", which stock draws as a full row with a chevron.
  - Ports for components no treflex view uses yet: `NumberField`, `RadioGroup`, `Calendar`, `ColorPicker`, `Group`, `PreviewCard`, `QrCode`, `DiscoveryList`, `PanelTabCloseButton`, `Table`.

## 2. Parity and polish

From a pass over `issues.md` for gaps Tam hits in daily use. Each item names its `issues.md` entry, which has the detail.

- **Settings treflex ignores.** Of Tam's picks (2026-11-23), Show skills in slash menu goes with Composer. Rich text composer, Render math, Effort display, the two screen reader settings and Project grouping stay unwired for now.
- **Changed-files card gaps against stock.** The card is now stock's collapsed folder tree (`TimelineRows.tsx` `ChangedFiles`). What it still lacks: the Expand/Collapse all choice lasts for the session, not across a reload (stock keeps it in `localStorage`, `threadChangedFilesExpandedById`); a turn's tracked-repository files (`repositories`, stock's `ChangedFilesGroup` sections) aren't listed; a file row opens the turn's diff but doesn't scroll to that file; and stock virtualizes past 250 rows. The card shows only for a run with no reply, such as the run after a compaction; otherwise it folds into the reply's "N files" button.
- **Phone: the send button misbehaves near the caret.** On the iPhone (2026-11-23), a tap on the send button sometimes does nothing when the text cursor is close to it, likely iOS's caret and selection handles taking the tap. It's rare; Tam will send a screenshot next time (2026-11-24). Start from that, or reproduce it on the phone, compare stock's phone composer layout, and if the button is the problem, move it or give it room on phone only.
- **Paradigm review leftovers.** The fixes merged (2026-11-24); what stays open is in `issues.md` under "Review: treflex paradigms after Solid 2": `viewport.ts` `enterPanel` still waits a microtask, since its elements have no component to wait in with `onSettled`, and `repairRestore` in `Root.ts` has no caller until something snapshots.
- **A reusable bottom-anchored scroller.** After the phone scroll work merges and has had a week or so on Tam's iPhone (Tam agreed, 2026-11-24). Extract the timeline's scrolling from `ThreadView.tsx` into a self-contained module inside this app, with a clean API. It covers:
  - the `column-reverse` anchoring;
  - the gesture hold, which works without `touchstart` during momentum;
  - corrections only after a real size change, never against the reader's scroll or overscroll;
  - stuck-to-end with scroll to end and per-thread memory;
  - the grow-at-top sentinel;
  - the `scrollTrace` ring as a debug option.

  Split it into a framework-free core (gesture state, correction decision, anchor maths, clamp handling) with unit tests, and a thin Solid 2 binding. It's a candidate for treflex's reference app (`solidportal`) and later a package of its own; that's Tam's call once it has proven itself.

## 3. Missing features

Each item groups related gaps from `issues.md`, which lists them in full. They can run in parallel, apart from items that touch the same view. **On hold until the client moves to treflex 0.4.0** (Tam, 2026-11-24): 0.4.0 changes the public API, so anything built on 0.3 now would be ported twice.

- **Stock features from the 2026-11-22 sync,** Tam's picks:
  - **What's left of side threads.** Subagents and side chats open beside the thread or in its place. Still missing:
    - linked-environment threads, which need peer-link reads;
    - the side chat header's "Add to chat" and Delete;
    - `/side` and `/btw`;
    - the read-only bar's live status line (stock's `formatProviderSubagentStatus`), and the pane's "Subagent of" and "Context from" dividers;
    - tabs and keeping the open side thread across a reload, under "Multi-surface right panel tabs";
    - forgetting the session of a side chat that was deleted unused, which stays until reload.
- **Composer.** `@` thread items and chips in place of markdown links, the built-in `/model` and `/clear`, keyboard shortcuts, project skills from the workspace snapshot with the Show skills in slash menu setting, and stock's steer-while-approvals-show override. See "Composer: no stash…" and "A send during a run…".
- **Sidebar.** Moving on from the open thread when it's snoozed, stock's sweep (drag from a row's Settle, Un-settle or Wake across others), the Archived undo notice, the auto-settle toggle, and snooze presets on the Threads settings page, which the custom snooze dialog's "Edit snooze options" link needs. See the "Sidebar" entries.
- **Thread details and git.** Context and usage rows, environment and worktree pickers, git progress phases and hook output, View PR, Initialize Git and Publish repository. See "Thread details" and "Thread details, git".
- **Multi-surface right panel tabs.** Stock's tab strip (`RightPanelTabs.tsx`, `rightPanelStore.ts`): the diff, side threads and other surfaces open as tabs side by side, with "+", maximize and reordering, and the open tabs and side thread kept across a reload. See "Right panel: … No tabs or maximize".
- **Diff panel.** The Commits submenu, the base ref picker, the file tree, hide test files and lazy loading of large Git diffs. See the "Diff panel" entries.
- **Terminal.** The thread's other server terminals as tabs, from the terminal metadata stream, and stock's script reuse of an idle shell. See the terminal entries under "Skipped for the prototype" and "Thread details, scripts".
- **Right panel surfaces.** The rest of Files, then Pull request and Browser, which the launcher lists but disables (Tam left the order open, 2026-11-23). Keep right-panel changes from the diff panel and these from running at once.
  - What's left of Files: the folder browser (`FileBrowserPanel`, `FileExplorerPane`, the breadcrumbs' folder menus), which the launcher's Files entry opens, then the header's editor picker, editing and saving, the large-text viewer, and the PDF, Office, font, notebook, Mermaid, HTML and delimited-table previews. See "Files preview".
- **Settings pages.** Build the pages greyed out in the nav, starting with Labs, Worktrees and Source control (Tam left the order open, 2026-11-23).

## 4. Performance

- **A cold open from HTTP and a cache.** Load the first snapshot over HTTP and seed it from a persisted thread cache, as stock does, so a reload doesn't wait on a socket snapshot. See "Mismatch: a cold open takes a full socket snapshot".
- **Jump into history.** Support `throughEntryId` history pages, which jump-to-row needs once the timeline is virtualized. See "History pages load older rows only".
- **Virtualize the timeline.** The timeline window only grows as you scroll up, so a long thread scrolled back through keeps every row mounted: 162 MB of heap against stock's 60 MB in `docs/benchmarks.md`. When the next turn starts, the window collapses to the tail in one long task, 184 ms unthrottled and about 860 ms at 4× CPU. Prototype on [virtua](https://github.com/inokawa/virtua)'s Solid list first. Then rerun the benchmark's long-thread case and check by hand that treflex still matches stock in four cases: staying pinned to the bottom while streaming, Load earlier without a jump, jump-to-row, and a streaming row that grows. If virtua can't match stock in one of those, port `@legendapp/list` (MIT): its `src/core` is framework-free, and only its React container layer needs a Solid rewrite. Carry over T3 Code's `patches/@legendapp__list@3.7.2.patch` too.

## Waiting on treflex

- **Move to treflex 0.4.0** once it ships. The missing features wait on this. Do the following with the move:
  - **A dev-only state hook** (Tam, 2026-11-24). It lets threads check live state directly, not through DOM `evaluate` calls (about 2,800 in the friction review). This is the shape treflex Main recommended; it's recorded on their "why mode" item (reflex `81541ef5`), which will keep it working or give a one-line move.
    - Call `createActivityLog(runtime)` in setup, and again in a restore's setup.
    - Under `import.meta.env.DEV` only, set `window.__treflex = { state: () => runtime.state, select: (selector, node = runtime.state) => runtime.select(selector, node), log: () => runtime.select(readLog, runtime.state) }`. `readLog` reads the `ActivityLog` external, as treflex's `restart-and-records.md` shows.
    - Keep it read-only: leave out `runtime`, since `dispatch` writes real state. State isn't redacted, so the hook must never reach production.
    - In 0.4, `runtime.select(sel, node)` replaces `processSelector(sel, () => x)`, and log fields are camelCase (`kind`, not `Kind`).
    - Tell threads about the hook in this app's `CLAUDE.md`, with an example `evaluate` snippet, and say that the preview is for layout and screenshots.
    - `inFlight(action, owner)` through `select` answers what's running until "why mode" adds a list of running work.
- **Checks that keep agents off React habits.** treflex's verdicts are in `docs/wip/13-external/views-start-work-from-their-lifecycle.md` in the reflex repo. When each one ships, turn it on here and fix what it finds.
  1. **A development diag in treflex-solid** for a dispatch into main state from a component or effect. It waits until treflex has chosen its Solid 2 route.
  2. **A restore-under-views check** for the main-or-component-state rule comes after resume's piece 4c.

  Screen-caused work, such as loading the next page when a list's end scrolls into view, gets a named opt-in at the call site instead of being banned.

## Server

- **A usage tool for agents.** No MCP tool exposes usage limits, so a thread can't check headroom before large work. Add a read-only tool that returns the snapshot the usage ring shows: per provider, each window's percent used and reset time. Keep the handler thin over the existing usage service, with its type in `packages/contracts`. Upstream's rule that what a user can see an agent can reach makes it a candidate upstream PR; Tam decides whether to raise one.

## Lint

- **A reason on every lifecycle callback.** treflex dropped `require-lifecycle-reason`, since the repo already has the tool. Extend `t3code/no-unreasoned-state-sync` in `oxlint-plugin-t3code/` to Solid's `onSettled`, `createEffect`, `createTrackedEffect`, `createRenderEffect` and `onCleanup`, for `apps/treflex-web/**` only, with its suppression-reason rule applying there too. Then annotate the existing sites with their reasons.

## Repo

- **Delete `Tgoh/t3code-archive`.** `Tgoh/t3code` is public, with Actions, Issues, Projects and Wiki off. The private archive holds the old history; Tam deletes it once happy. Never push a branch made before the cutover: its history isn't connected and would bring the old commits back.

## Housekeeping

Any time; none of it touches the client.

- **Record the verdicts.** Add treflex's verdicts to the "Feedback for treflex" section of `issues.md`. The friction write-up is at `G:\Sorted\Code\t3code-dev-home\notes\treflex-friction-from-t3code-port.md`, and the treflex side's verdicts are in the reflex repo's `docs/wip` (commit 2b37348).
- **Server start time.** On a server restart, check whether the roughly 50 seconds between launch and the first log line comes back. See `G:\Sorted\Code\t3code-dev-home\dev-stack\server.log`.
