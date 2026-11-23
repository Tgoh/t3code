# Todo

Everything in the pipeline for the treflex client, in the order to do it. Within a stage, the items can run in parallel threads unless an item says otherwise. An item being worked on is marked **In progress** with its branch. Gaps against stock that nobody has asked for yet go in [issues.md](./issues.md) instead. The long-term goal is full parity with stock, so `issues.md`'s gaps move in here a few at a time.

**On hold until treflex 0.3.0 ships:** finish the items already in progress, and start nothing new (Tam, 2026-11-23).

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

- **Settings treflex ignores.** Of Tam's picks (2026-11-23), only the Archive confirmation is left: it waits for the archive action in the Sidebar item. Tool calls in chat with Timeline rows, and Show skills in slash menu with Composer. Rich text composer, Render math, Effort display, the two screen reader settings and Project grouping stay unwired for now.

## 3. Missing features

Each item groups related gaps from `issues.md`, which lists them in full. They can run in parallel, apart from items that touch the same view.

- **Invalid keybindings warning.** **In progress** on `treflex/small-gaps`. Stock toasts "Invalid keybindings configuration" with the config's issues (`KeybindingsUpdateToast.tsx`); nothing in treflex shows `config.issues` yet.
- **Stock features from the 2026-11-22 sync,** Tam's picks:
  - **What's left of side threads.** Subagents and side chats open beside the thread or in its place. Still missing:
    - linked-environment threads, which need peer-link reads;
    - the side chat header's "Add to chat" and Delete;
    - `/side` and `/btw`;
    - the read-only bar's live status line (stock's `formatProviderSubagentStatus`), and the pane's "Subagent of" and "Context from" dividers;
    - tabs, so several side threads stay open beside the diff;
    - keeping the open side thread across a reload, as stock's `rightPanelStore` does;
    - forgetting the session of a side chat that was deleted unused, which stays until reload.
- **Composer.** `@` thread items and chips in place of markdown links, the built-in `/model` and `/clear`, keyboard shortcuts, project skills from the workspace snapshot with the Show skills in slash menu setting, and stock's steer-while-approvals-show override. See "Composer: no stash…" and "A send during a run…".
- **Timeline rows.** **In progress** on `treflex/timeline-rows`. Compaction dividers and `/compact` turns, superseded-attempt folds, the tool-call visibility setting, viewed-image strips, the "Waiting on N subagents" label and stock's per-tool detail in expanded rows. See the "Timeline" entries under "Unmatched against the stock UI".
- **Sidebar.** **In progress** on `treflex/sidebar-features`, with the Archive confirmation. Search, bulk settle, an archive view with the way back, custom snooze time and Regenerate title. See the "Sidebar" entries.
- **Thread details and git.** Context and usage rows, environment and worktree pickers, git progress phases and hook output, View PR, Initialize Git and Publish repository. See "Thread details" and "Thread details, git".
- **Diff panel.** **In progress** on `treflex/diff-panel`. Stock's `@pierre/diffs` view with syntax highlighting, split view, wrap, tabs and the turn picker, and restoring a checkpoint. See "Diff panel" and "Restoring a checkpoint isn't offered".
- **Terminal.** **In progress** on `treflex/terminal`. Tabs and splits, a resizable drawer, links, search and a restart button for an exited shell. See the terminal entries under "Skipped for the prototype".
- **Right panel surfaces.** Files, Pull request and Browser, which the launcher lists but disables, in that order (Tam left the order open, 2026-11-23). Files starts after the diff panel merges, since both change the right panel. The file preview brings stock's copy button with it (Copy contents, or Copy preview when truncated, in `AttachmentFilePreview`'s header); until a preview exists, a file attachment opens in a new browser tab.
- **Settings pages.** Build the pages greyed out in the nav, starting with Labs, Worktrees and Source control (Tam left the order open, 2026-11-23).
- **A pairing token box on the unpaired page.** **In progress** on `treflex/small-gaps`. Stock's unpaired page takes a pasted pairing token; treflex's only says to open a pairing link. Add the box and stock's wording ("Enter a pairing token to start a session with this environment.").
- **Usage limits from external sources.** **In progress** on `treflex/small-gaps`. Open the config stream with `usageLimitSources` and show the usage-limit hubs, as stock does. See "Usage limits".

## 4. Performance

- **A cold open from HTTP and a cache.** Load the first snapshot over HTTP and seed it from a persisted thread cache, as stock does, so a reload doesn't wait on a socket snapshot. See "Mismatch: a cold open takes a full socket snapshot".
- **Jump into history.** Support `throughEntryId` history pages, which jump-to-row needs once the timeline is virtualized. See "History pages load older rows only".
- **Virtualize the timeline.** The timeline window only grows as you scroll up, so a long thread scrolled back through keeps every row mounted: 162 MB of heap against stock's 60 MB in `docs/benchmarks.md`. When the next turn starts, the window collapses to the tail in one long task, 184 ms unthrottled and about 860 ms at 4× CPU. Prototype on [virtua](https://github.com/inokawa/virtua)'s Solid list first. Then rerun the benchmark's long-thread case and check by hand that treflex still matches stock in four cases: staying pinned to the bottom while streaming, Load earlier without a jump, jump-to-row, and a streaming row that grows. If virtua can't match stock in one of those, port `@legendapp/list` (MIT): its `src/core` is framework-free, and only its React container layer needs a Solid rewrite. Carry over T3 Code's `patches/@legendapp__list@3.7.2.patch` too.

## Waiting on treflex

- **Checks that keep agents off React habits.** treflex's verdicts are in `docs/wip/13-external/views-start-work-from-their-lifecycle.md` in the reflex repo. When each one ships, turn it on here and fix what it finds.
  1. **A development diag in treflex-solid** for a dispatch into main state from a component or effect. It waits until treflex has chosen its Solid 2 route.
  2. **A restore-under-views check** for the main-or-component-state rule comes after resume's piece 4c.

  Screen-caused work, such as loading the next page when a list's end scrolls into view, gets a named opt-in at the call site instead of being banned.

## Server

- **A usage tool for agents.** No MCP tool exposes usage limits, so a thread can't check headroom before large work. Add a read-only tool that returns the snapshot the usage ring shows: per provider, each window's percent used and reset time. Keep the handler thin over the existing usage service, with its type in `packages/contracts`. Upstream's rule that what a user can see an agent can reach makes it a candidate upstream PR; Tam decides whether to raise one.

## Lint

- **A reason on every lifecycle callback.** treflex dropped `require-lifecycle-reason`, since the repo already has the tool. Extend `t3code/no-unreasoned-state-sync` in `oxlint-plugin-t3code/` to Solid's `onMount`, `createEffect`, `createComputed`, `createRenderEffect` and `onCleanup`, for `apps/treflex-web/**` only, with its suppression-reason rule applying there too. Then annotate the existing sites with their reasons.

## Repo

- **Delete `Tgoh/t3code-archive`.** `Tgoh/t3code` is public, with Actions, Issues, Projects and Wiki off. The private archive holds the old history; Tam deletes it once happy. Never push a branch made before the cutover: its history isn't connected and would bring the old commits back.

## Housekeeping

Any time; none of it touches the client.

- **Make `vp run check:changed` pass for this app.** Every thread reports the same two failures, which hide real ones.
  - Its test step runs this app's tests in the root vitest project, which lacks the app's `solid` and `browser` resolve conditions, so about 140 tests fail there that pass from `apps/treflex-web`. Give the app its own vitest project in the root config, or exclude it from the root run and have `check:changed` run it from its folder.
  - Its unused-patches step installs in a temp copy that can't find `vendor/treflex-eslint-0.2.1.tgz`.

  Both mean editing upstream's root config, so keep the change small. See "Setup: `vp run check:changed` fails this app's tests" in `issues.md`.

- **Record the verdicts.** Add treflex's verdicts to the "Feedback for treflex" section of `issues.md`. The friction write-up is at `G:\Sorted\Code\t3code-dev-home\notes\treflex-friction-from-t3code-port.md`, and the treflex side's verdicts are in the reflex repo's `docs/wip` (commit 2b37348).
- **Server start time.** On a server restart, check whether the roughly 50 seconds between launch and the first log line comes back. See `G:\Sorted\Code\t3code-dev-home\dev-stack\server.log`.
