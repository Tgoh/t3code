# Stock bugs

Bugs found in stock T3 Code (`apps/web`, `packages/client-runtime`, the server) while porting or comparing. Some may be worth reporting or fixing upstream. Each entry says where the bug is, what goes wrong, whether it was reproduced, and whether treflex has the same bug.

## Timeline: earlier rows can jump the view on iOS mid-scroll

- **Where:** `ScrollAdjust` in `@legendapp/list` 3.7.3 (`react.mjs`), which `MessagesTimeline.tsx` drives with `maintainVisibleContentPosition={{ data: true, size: true }}` on a scroller set to `[overflow-anchor:none]`.
- **What goes wrong:** when rows are added or resized above the viewport, it corrects with `el.scrollBy` straight away. Its `isDragging` and `isMomentumScrolling` checks are fed only by React Native's scroll callbacks, so on the web they never hold a correction back. iOS Safari overwrites a scroll change made while a finger is panning, and stops momentum at one made while flinging. So a correction during a touch is lost (the view jumps by the inserted height) or cuts the fling short.
- **Status:** found by reading the code on 2026-11-23. Tam confirmed it on an iPhone the same day: stock hitches on every row that lands above the view while scrolling up.
- **Treflex:** in `ThreadView.tsx`, rows above the viewport (a grow of the window, a history page, the Load earlier row) wait until the touch and its momentum end, then go in and are corrected in one step while nothing is moving.

## Diff panel: the turn picker offers turns the server refuses

- **Where:** the Turn submenu in `apps/web/src/components/DiffPanel.tsx`, from `deriveThreadCheckpointSummaries` in `packages/client-runtime/src/state/threadCheckpoints.ts`, which lists every checkpoint with an `appRunOrdinal`.
- **What goes wrong:** an interrupted or failed turn is listed, but `CheckpointDiffQuery.ts` serves only completed runs, so picking one shows "Failed to load turn diff" and "No patch available for this selection."
- **Status:** reproduced on 2026-11-23 in the Test project's "Live State Check File Creation" thread: Turn 5 to Turn 15 are interrupted runs, and Turn 5 fails to load.
- **Treflex:** not affected. Its picker lists the turns the server serves (`diffTurns` in `OpenThread.ts`), apart from a run outside the loaded history window, whose status it doesn't hold.

## Settings: Archive confirmation describes a second click it doesn't ask for

- **Where:** the Archive confirmation row in `GeneralSettingsPanel`, `apps/web/src/components/settings/SettingsPanels.tsx`.
- **What goes wrong:** it says "Require a second click on the inline archive action before a thread is archived", but `confirmThreadArchive` opens an `Archive thread "…"?` dialog from the thread menu in `Sidebar.tsx` and `useThreadActionMenu.ts`. No inline archive action asks for a second click.
- **Status:** found by reading the code on 2026-11-23, not run.
- **Treflex:** copies the description in `settingsPages.ts`, and the setting gates the thread menu's Archive dialog, as stock's does.

## Server: a restart drops pending idle compactions

- **Where:** `apps/server/src/orchestration-v2/IdleCompactionService.ts`. Timers live in memory, as its doc comment says.
- **What goes wrong:** a server restart within the hour after a turn completes drops that thread's compaction, so its next turn rereads the whole context uncached.
- **Status:** reproduced on 2026-11-22: the Notes Main thread's turn finished at 18:35, and the 18:40 and 18:43 restarts lost its 19:30 compaction. Upstream has an open fix by a maintainer, pingdotgg/t3code#27926 (issue #27915). Its commits apply to current main with test-file conflicts only, but its ProjectionStore candidate test asserts a row order the query doesn't guarantee, and failed until switched to `sameDeepMembers`.
- **Treflex:** the server is stock's, so affected until #27926 lands and a sync brings it in.

## Thread details: a failed Open in editor shows nothing

- **Where:** `apps/web/src/components/chat/OpenInPicker.tsx`, `openInEditor`. It runs `shellEnvironment.openInEditor` through `useAtomCommand`, which only logs a failure to the console (`runAtomCommand` in `packages/client-runtime/src/state/runtime.ts`).
- **What goes wrong:** when the server can't open the editor, the click does nothing visible. Stock's file links toast "Unable to open file" for the same failure (`MarkdownFileLink.tsx`).
- **Status:** found by reading the code, not reproduced.
- **Treflex:** not affected. The details card's editor row toasts "Unable to open editor".

## Git: the quick action's hint toast can't be reached

- **Where:** `apps/web/src/components/GitActionsControl.tsx`, `runQuickAction`'s `show_hint` branch, and `resolveQuickAction` in `GitActionsControl.logic.ts`.
- **What goes wrong:** every `show_hint` action `resolveQuickAction` returns is `disabled: true`, and the button is disabled when it is, so the info toast with the hint never shows. The hint reaches people only as the disabled button's tooltip.
- **Status:** found by reading the code. Harmless dead code.
- **Treflex:** shows the hint as the disabled row's tooltip, as stock does in practice.

## Connection: a replaced session's config stream never ends

- **Where:** `packages/client-runtime/src/rpc/session.ts`, `serverConfigEvents` behind `RpcSession.subscribeServerConfig`.
- **What goes wrong:** when the supervisor closes a session's scope, its config source is interrupted, and `onExit` completes neither `serverConfigExit` nor the unscoped `PubSub`. A consumer still holding that session's `subscribeServerConfig()` stream waits forever, with no event, end or failure.
- **Impact:** none in stock today. Stock reads config through `subscribe(WS_METHODS.subscribeServerConfig, …)`, which switches sessions, and the supervisor's own route learning lives in the lease's scope. It's a trap for any new caller of `session.subscribeServerConfig()`.
- **Status:** reproduced through reflex. Closing the WebSocket stalled a reflex tab's config stream until reload.
- **Reflex:** was affected (the stale usage ring), now reads config through `subscribe` in `Infrastructure/serverConfigEvents.ts`.

## Commands: a new thread's first message and a queued send-now or steer are lost to a dropped socket

- **Where:** `packages/client-runtime/src/operations/commands.ts`. `startThreadTurn`'s `bootstrap` branch sent `launchThread` with a plain `request`, and `resumeThreadQueue` and `promoteQueuedRun` with a plain `dispatch`. Only `message.dispatch` went through the resend loop.
- **What goes wrong:** a socket that drops as one of these is sent fails it with an interrupt or an `RpcClientError`, and nothing resends it. The server would replay a resend from its command receipt, as it does for messages.
- **Status:** found by reading the code, and shown failing first in `commands.test.ts`. Fixed on `treflex/resend-turns` in a commit that touches only `packages/client-runtime`, ready to offer upstream.
- **Treflex:** was affected, since it sends through the same functions. It now inherits the fix.

## History: a snapshot re-enables Load earlier while a fetch is running

- **Where:** `packages/client-runtime/src/state/threads.ts`, `loadEarlier` and the `snapshot` case of `applyItem`.
- **What goes wrong:** every socket snapshot writes `history.loading: false`, even when its cursor matches the fetch still running. The running fetch stays current, because `isActiveHistoryRequestCursor` still matches, so it lands. But the button is enabled again in the meantime, so a second fetch of the same cursor can start alongside the first.
- **Impact:** probably only a wasted request, since the second page has the same rows.
- **Status:** found by reading the code, not reproduced.
- **Treflex:** not affected. It keeps an unchanged window entity, so the fetch's busy mark survives the snapshot.

## Requests: answer buttons can re-enable while the answer is in flight

- **Where:** `apps/web/src/components/chat/usePendingThreadRequests.ts`.
- **What goes wrong:** `respondingRequestIds` and `respondingUserInputRequestIds` are `useState` in the hook. If the component remounts while a response command runs, the mark is lost and the buttons enable again. Approvals also have no guard against a repeat beyond the button re-rendering as disabled. User input has one (`userInputResponsesInFlight`).
- **Impact:** a second answer to the same request, which the server most likely rejects.
- **Status:** found by reading the code, not reproduced.
- **Treflex:** not affected. Each request is an entity with a `leading` answer action.
