# Todo

Work Tam has queued for later, in the order to do it. Within a stage, the items can run in parallel threads unless an item says otherwise. Gaps against stock that nobody has asked for yet go in [issues.md](./issues.md) instead.

## 1. Correctness

Each item fixes data or work that's wrong today.

- **Make the tree hold what `Wire<T>` says.** Typing the tree from `Encoded` doesn't work: on Effect 4.1.3 it's `unknown` or `Json` for the stream types. Instead, encode with `Schema.toCodecJson(Schema.toType(S))`. Dates still become strings, and everything else keeps its decoded shape, so `Wire<T>` becomes true. Do it at the encode sites: `shellStream.ts`, `threadItemCodec.ts`, `serverConfigStream.ts` and the `encode*` helpers in `settingsImpl.ts`. That removes the hand decode in `subagents.ts` `notificationSource` and the unknown-event special case in `threadItemCodec.ts`. Three more changes come with it:
  - Every decode of tree data has to use the same codec, at least `decodeMutation` and `decodePatch` in `settingsImpl.ts`. The full codec rejects a secret environment variable in the new shape.
  - Client settings in localStorage use reflex's format, not stock's, so read and write them with the same codec. Stock's localStorage is on another origin anyway. Run both codecs over the current saved value first. If they differ, fall back to the full codec when reading.
  - Decode the history page (`threadHistory.ts`) and the voice JSON (`dictation.ts`), and re-encode them with the same codec. Both are cast from raw JSON today, so history items keep the legacy notification source and skip the decode's cleanup.
- **Derive each request's turn item instead of indexing it.** Remove `OpenThread.RequestItemIds` and `indexRequestItem`. Have `requestItems` walk `Timeline` from the newest item, for pending requests only, until it finds the item whose `requestId` matches. That's how stock does it (`derivePendingThreadRequests` in `packages/client-runtime/src/state/threadRequests.ts`). The old 60 ms cost came from a selector that read every turn item. This one reads only the tail, and nothing when no request is pending. Before you delete the index:
  - Measure at 20,000 items with a pending request.
  - Check a request whose item is outside the loaded history window.
- **Put state on the right side of the line, and start work from events.** The line is in `CLAUDE.md`: what causes the work, and whether a restore would bring that back. Git status and the Usage page wait for their stage 4 items; do the rest now.
  - **Move to main state:**
    - **Command output** (`CommandOutput.tsx`). Whether a row is expanded is already on `ThreadSession`, so `toggleRowExpanded` should open the output subscription, not the row's mount.
    - **Editors** (`ThreadDetails.ts`). `editorsEffect` lists the editors installed in the environment and is fetched on every thread open. Load it once on `Environment`.
    - **Lineage titles** (`lineageTitles.ts`). These are other threads' titles, fetched on every thread open. Fetch them when the thread opens, or keep them as a title cache on the shell.
    - **Project favicons** (`brand.tsx`). They're requested through `Environment` when a project changes. Request them from the shell receiver as project rows arrive.
    - **Git status** (`ThreadDetails.ts` `attach`), in stage 4 with the checkout selector. The details card mounts for every thread with a checkout, even while hidden, so the subscription already lasts as long as the thread is open. Open it from `selectThread` or a checkout change, on `ThreadSession` or a child entity. The branch list is per project and can go with it.
    - **Usage page**, in stage 4 with "Split `Environment`". `UsageView.tsx` starts `loadUsage` and `autoRefreshLimits` on mount; that item turns the page into a component feature opened by `openView`.
  - **Move to component state:** the composer `@` file search (`ComposerCommandMenu.tsx`, now `ThreadSession.searchFiles`). Put the debounce in the action as a `delay`, as `searchMessages` does, and start it from the composer's input handler, not a `setTimeout` in an effect.
  - **Keep in component state, but start from the handler:** message search (`messageSearch.ts`) and Add project's folder browsing (`AddProject.tsx`) run from an effect over the query. Dispatch from the input handler instead.
  - **Keep in component state as is:** media and attachment URLs, which are signed, expire, and are fetched because a row is rendered; Add project's settings; voice models on the settings page, like the Usage page.
  - **Main-state writes from the view:** `ThreadView.tsx` runs `fitDetails` from an effect over the stage size, so dispatch it from the ResizeObserver callback. It also closes the details popover in `onCleanup`, so close it in the action that leaves or switches the thread.

## 2. Daily friction

Two threads: the phone composer, and the sidebar with type-to-focus.

- **Phone composer.** Both items touch the composer's send path, so do them together.
  - **The send button is unreliable on phone.** A tap often just closes the keyboard instead of sending. The likely cause is the textarea blurring on pointerdown: the keyboard collapses, the layout shifts, and the click misses. Likely fix: `preventDefault` on the send button's pointerdown or mousedown so the composer keeps focus. Verify on a real iPhone home-screen app.
  - **Enter on phone.** The keyboard's Enter should insert a newline, and only the send button should send. Make it the default on coarse pointers, with no setting, unless stock does something else on touch.
- **Sidebar and typing.**
  - **Long thread titles are cut off.** Thread rows moved to a single line, so long titles are truncated. Let titles wrap again, probably clamped to two lines, without making short rows taller.
  - **Settle only on the open thread.** Show a row's settle button only on the selected thread, so a thread can't be settled before it's been looked at. Check the other ways to settle, such as the thread menu, the command palette and the shortcut, and decide whether they follow the same rule.
  - **Type-to-focus from buttons and links.** A key typed while a button or link has focus stays with it, as in stock (`shouldRedirectInputToComposer` in `src/composerFocusRedirect.ts`). That happens after clicking a sidebar thread or a header button. Tam wants any keypress to reach the composer. When focus is on a button or link, send printable keys to the composer, but keep Space and Enter activating the focused element. Keep the other exceptions: fields, open layers, keys with modifiers, and `aria-keyshortcuts`.

## 3. Parity and polish

- **Secret and link requests can't be answered in reflex.** Port stock's `SecretRequestCard` and the link-request card. Until then, answer them in stock web on 5733. Also listed in `issues.md` under "Skipped for the prototype".
- **The "Working for" group doesn't look like stock.** In `TimelineResponse.tsx`, the work rows set no font size, so "Ran 6 commands" inherits the message text size. Stock's rows are `text-sm leading-relaxed` (`TimelineWorkGroupRows.tsx`). Reflex's row icons sit in a `size-6` box (`WORK_ICON` in `TimelineRows.tsx`), where stock's are `size-4`. The fold header shows a blue box after a click, where stock rings only on `focus-visible` (`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70`). Compare the whole group with stock in both states, collapsed and expanded, beside the same thread on 5733: sizes, colours, spacing, the summary text and the expanded command list.
- **Dialog animations.** The Add project dialog has no open or close animation. Go through reflex's dialogs, popovers and menus, and compare each with stock's transitions.
- **Settings reflex ignores.** Wire up whichever of the 19 settings still marked "Not used here yet" Tam picks. Send shortcut and Time format look easiest. Waits for Tam's pick.

## 4. Restructuring

From an audit of how the port uses treflex 0.1.0. Most of the code already follows the treflex docs. What doesn't is two entities that each do several jobs, and parent views that work out data and pass it down. The first three items touch `ThreadSession` and `ThreadView`, so run them in one thread, in this order. The rest can run beside it.

- **Split `ThreadSession`.** It owns the composer, queue, rewind, fork, diff panel, terminal, git and more. Make the diff panel a child entity that is minted on open and replaced or removed on close. That drops the re-checks after each wait in `openDiff` and `openBranchDiff`, the manual resets in `closeDiff`, and the reliance on `latest` to cancel stale loads. Make the terminal a child entity with its state in plain fields instead of the `Terminal/Attachment` transient. `GitWork` already has this shape. See "move long work onto a child entity" in the reflex repo's `docs/patterns.md`.
- **Checkout and panel selectors.** `ThreadView`'s `ThreadBody` builds the checkout in a memo that compares with JSON, passes it down as a prop and into `ThreadDetails` component state, and passes it to every `GitWork` action. Add one `checkout` selector on `ThreadSession` and let `GitWork` read the checkout itself. Panel availability is worked out in both `Environment.panelShortcuts` and `ThreadBody`'s menu and launcher, so make it one selector too. `terminalLaunch`, `searchRoot` and `Dictation.recordingOptions` resolve the working directory separately, and should use the same selector. Move the git status subscription into main state here (stage 1's state item).
- **Git's default-branch confirmation as an `ask`.** Replace `PendingDefaultBranch`, `continueDefaultBranch`, `cancelDefaultBranch` and the `confirmed` flag with one `ask` inside `runGitAction`, as `Rewind/Confirm` already works. The git buttons would show busy while the dialog is open.
- **Split `Environment`.** Give dictation its own entity under `Local` that owns the `Voice/Dictation` resource and receiver. Make the archived and usage settings pages component features (`createComponentFeature`) whose data lives only while the page is open. That removes `Replica.Archived`, `Replica.Usage`, four `REPLICA_WRITERS` entries, and the two different ways the loads are triggered (`openView` and `onMount`).
- **Thinner sidebar rows.** After stage 2's sidebar thread, which changes the same rows. `Sidebar.tsx`'s `card()` passes `ThreadCard` 14 props, most of them worked out per row. Let the card read from its thread, as timeline rows do, and keep only cross-row values in the parent, such as `mixedProviders` and the search highlight.
- **Drop the duplicate keybindings stream.** `Server/Keybindings` (`Infrastructure/serverKeybindings.ts`) opens a second subscription for keybindings that `Server/Config` already writes to `Replica.Config.keybindings`. Delete the resource and have `App.tsx` read the config.
- **Smaller items.**
  - Share one receiver registration between `index.tsx` and `Model.test.ts`. The test copy already lacks `GitReceiver` and `VoiceModelsReceiver`.
  - Turn the remaining transients on Local entities into plain fields.
  - Make the non-archived projects list one selector; four views rebuild it now.
  - `Environment.currentProjectId` reads `Shell.Threads` but `ThreadSession.projectId` reads `OpenThreads`; pick one source.
  - Use work tags instead of the five `useInFlight([...])` action lists.
  - Move `runScript`'s open-the-terminal decision from the view into the action.
  - Give features hand-picked ids instead of `import.meta.url`.

## 5. Performance

After stage 4, which also changes `ThreadView`.

- **Virtualize the timeline.** The timeline window only grows as you scroll up, so a long thread scrolled back through keeps every row mounted: 162 MB of heap against stock's 60 MB in `docs/benchmarks.md`. When the next turn starts, the window collapses to the tail in one long task, 184 ms unthrottled and about 860 ms at 4× CPU. Prototype on [virtua](https://github.com/inokawa/virtua)'s Solid list first. Then rerun the benchmark's long-thread case and check by hand that reflex still matches stock in four cases: staying pinned to the bottom while streaming, Load earlier without a jump, jump-to-row, and a streaming row that grows. If virtua can't match stock in one of those, port `@legendapp/list` (MIT): its `src/core` is framework-free, and only its React container layer needs a Solid rewrite. Carry over T3 Code's `patches/@legendapp__list@3.7.2.patch` too.

## Whenever it ships

- **Treflex 0.2.0.** Once it ships, re-vendor it. Read `docs/wip/done/release-0.2.0-breaking-changes.md` in the reflex repo first. `REPLICA_WRITERS` has to switch from `Name` to `Label`, and `testing/watchRuntime.ts` gives way to the strict test preset. Then move the minute clock to `provideExternal`/`external`. Past 0.2.0, rejections reach actions as copies with a native error type, so `instanceof ServerError` in `serverError()` stops matching and every server failure takes the bug route. In production that's silent. A development build reports the diag `effect/class-rejection` for each rejection with a class instance, and `createTestRuntime` fails on it. So run the tests on `createTestRuntime` and the dev build once to find every site before upgrading. See `docs/wip/13-external/breaking-changes-since-0.2.0.md` in the reflex repo. Also vendor `treflex-eslint` and add it to the `jsPlugins` in `vite.config.ts`, with only its type-free rules on: `treflex/named`, `treflex/no-yield-in-finally` and `treflex/no-global-open`. The typed rules throw under oxlint for lack of type information. See `docs/wip/13-external/lint-under-oxlint.md`.

## Housekeeping

Any time; none of it touches the client.

- **Record the verdicts.** Add treflex's verdicts to the "Feedback for treflex" section of `issues.md`. The friction write-up is at `G:\Sorted\Code\t3code-dev-home\notes\treflex-friction-from-t3code-port.md`, and the treflex side's verdicts are in the reflex repo's `docs/wip` (commit 2b37348).
- **Server start time.** On a server restart, check whether the roughly 50 seconds between launch and the first log line comes back. See `G:\Sorted\Code\t3code-dev-home\dev-stack\server.log`.
- **Empty worktree folders.** Delete the leftovers under `G:\Sorted\Code\t3code-dev-home\worktrees\t3code`: `reflex-landscape-header-*`, `reflex-inline-media-*` and `reflex-idle-compaction--c2d629098b4fd778`.
- **Stale worktrees.** Clean up about 50 registered `reflex/*` worktrees whose branches are merged.
