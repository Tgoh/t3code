# Todo

Everything in the pipeline for the reflex client, in the order to do it. Within a stage, the items can run in parallel threads unless an item says otherwise. An item being worked on is marked **In progress** with its branch. Gaps against stock that nobody has asked for yet go in [issues.md](./issues.md) instead.

## 1. Parity and polish

- **The "Working for" group doesn't look like stock.** **In progress:** `reflex/workgroup-dialogs`. In `TimelineResponse.tsx`, the work rows set no font size, so "Ran 6 commands" inherits the message text size. Stock's rows are `text-sm leading-relaxed` (`TimelineWorkGroupRows.tsx`). Reflex's row icons sit in a `size-6` box (`WORK_ICON` in `TimelineRows.tsx`), where stock's are `size-4`. The fold header shows a blue box after a click, where stock rings only on `focus-visible` (`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70`). Compare the whole group with stock in both states, collapsed and expanded, beside the same thread on 5733: sizes, colours, spacing, the summary text and the expanded command list.
- **Dialog animations.** **In progress:** `reflex/workgroup-dialogs`. Copy stock's dialog and popover motion. Menus keep a transition, which Tam asked for: stock's popover fade and scale, where stock's menus have none.
- **Settings reflex ignores.** Wire up whichever of the 19 settings still marked "Not used here yet" Tam picks. Send shortcut and Time format look easiest. Waits for Tam's pick.

## 2. Treflex 0.2.0

After stage 1's threads merge, since it touches tests and wiring across the client. Before stage 3, so the restructuring is built on 0.2.0.

- **Upgrade to treflex 0.2.0.** All four packages were published to npm on 17 November. Depend on the published `treflex` and `treflex-solid` instead of the tarballs in `vendor/`. `treflex-eslint` stays vendored: treflex won't publish again before 0.3.0, so take a tarball of the 0.2.1 build that holds the two lifecycle rules (see "Waiting on treflex"), or 0.2.0 from npm if that build isn't ready. Read `docs/wip/done/release-0.2.0-breaking-changes.md` in the reflex repo first.
  - `REPLICA_WRITERS` switches from `Name` to `Label`, and `testing/watchRuntime.ts` gives way to the strict test preset, which fails a test on any diag or failure it didn't expect.
  - Move the minute clock to `provideExternal`/`external`. Then make the header's usage ring recompute on it, so a weekly window that resets shows straight away. Today the ring only redraws when the server pushes new provider data, about every five minutes.
  - Add `treflex-eslint` to the `jsPlugins` in `vite.config.ts`, with only its type-free rules on: `treflex/named`, `treflex/no-yield-in-finally` and `treflex/no-global-open`. The typed rules throw under oxlint for lack of type information. See `docs/wip/13-external/lint-under-oxlint.md`.
  - **Rename the client from reflex to treflex**, the official name. Do it last, as a rename-only commit, so the upgrade's logic changes stay readable. It covers:
    - `apps/reflex-web` → `apps/treflex-web`, with its package name, `knip.jsonc`, `vite.config.ts`, workspace filters and any CI paths;
    - `dev-stack.ps1` (`-Only reflex` and the served `dist` path);
    - the docs, `CLAUDE.md` and README text, and user-visible strings, if any;
    - the `reflex/` branch prefix for future work.

    The long-lived branch `reflex-main` becomes `treflex-main` on origin. The coordinator does that branch rename after the thread merges, together with the driver restart, the `syncupstream` and `promote` skills, and anything else outside this repo. Leave `G:\Sorted\Code\reflex`, treflex's own repo, alone. Grep for `reflex` case-insensitively and check every hit, since `packages/client-runtime` has unrelated matches.
  - Prepare for the release after 0.2.0. There, rejections reach actions as copies with a native error type, so `instanceof ServerError` in `serverError()` stops matching and every server failure takes the bug route, silently in production. A development build reports the diag `effect/class-rejection` for each rejection with a class instance, and `createTestRuntime` fails on it. Run both once and fix every site. See `docs/wip/13-external/breaking-changes-since-0.2.0.md` in the reflex repo.

## 3. Restructuring

From an audit of how the port uses treflex 0.1.0. Most of the code already follows the treflex docs. What doesn't is two entities that each do several jobs, and parent views that work out data and pass it down. The first three items touch `ThreadSession` and `ThreadView`, so run them in one thread, in this order. The rest can run beside it.

- **Split `ThreadSession`.** It owns the composer, queue, rewind, fork, diff panel, terminal, git and more. Make the diff panel a child entity that is minted on open and replaced or removed on close. That drops the re-checks after each wait in `openDiff` and `openBranchDiff`, the manual resets in `closeDiff`, and the reliance on `latest` to cancel stale loads. Make the terminal a child entity with its state in plain fields instead of the `Terminal/Attachment` transient. `GitWork` already has this shape. See "move long work onto a child entity" in the reflex repo's `docs/patterns.md`.
- **Checkout and panel selectors.** `ThreadView`'s `ThreadBody` builds the checkout in a memo that compares with JSON, passes it down as a prop and into `ThreadDetails` component state, and passes it to every `GitWork` action. Add one `checkout` selector on `ThreadSession` and let `GitWork` read the checkout itself. Panel availability is worked out in both `Environment.panelShortcuts` and `ThreadBody`'s menu and launcher, so make it one selector too. `terminalLaunch`, `searchRoot` and `Dictation.recordingOptions` resolve the working directory separately, and should use the same selector.
  - Move git status into main state here (`ThreadDetails.ts` `attach`). The details card mounts for every thread with a checkout, even while hidden, so the subscription already lasts as long as the thread is open. Open it from `selectThread` or a checkout change, on `ThreadSession` or a child entity. The branch list is per project and can go with it, and so does the card's `createEffect` that refreshes status when it's shown.
- **Git's default-branch confirmation as an `ask`.** Replace `PendingDefaultBranch`, `continueDefaultBranch`, `cancelDefaultBranch` and the `confirmed` flag with one `ask` inside `runGitAction`, as `Rewind/Confirm` already works. The git buttons would show busy while the dialog is open.
- **Split `Environment`.** Give dictation its own entity under `Local` that owns the `Voice/Dictation` resource and receiver. Move the voice model list (`VoiceModels.ts`, a settings-page component feature today) onto it: dictation's missing-model check and the settings page both care which models are installed, so keep one list. Load it when server dictation is in use, and keep it fresh with the existing receiver and poll, so a download's progress survives leaving the page. Make the archived and usage settings pages component features (`createComponentFeature`) whose data lives only while the page is open. That removes `Replica.Archived`, `Replica.Usage`, four `REPLICA_WRITERS` entries, and the two different ways the loads are triggered (`openView` and `onMount`), including `UsageView.tsx`'s `loadUsage` and `autoRefreshLimits` on mount.
- **Thinner sidebar rows.** `Sidebar.tsx`'s `card()` passes `ThreadCard` 14 props, most of them worked out per row. Let the card read from its thread, as timeline rows do, and keep only cross-row values in the parent, such as `mixedProviders` and the search highlight.
- **Drop the duplicate keybindings stream.** `Server/Keybindings` (`Infrastructure/serverKeybindings.ts`) opens a second subscription for keybindings that `Server/Config` already writes to `Replica.Config.keybindings`. Delete the resource and have `App.tsx` read the config.
- **Add project's settings come from the config.** `addProjectSettingsImpl` fetches the server config again to read four values that `Replica.Config` already holds (`addProjectBaseDirectory`, `ghqCloneLayout`, `newProjectsRoot`, the platform). Make them a selector over the config and delete the effect, as was done for editors. Add project's folder browsing stays in its component state.
- **Smaller items.**
  - Share one receiver registration between `index.tsx` and `Model.test.ts`. The test copy already lacks `GitReceiver` and `VoiceModelsReceiver`.
  - Turn the remaining transients on Local entities into plain fields.
  - Make the non-archived projects list one selector; four views rebuild it now.
  - `Environment.currentProjectId` reads `Shell.Threads` but `ThreadSession.projectId` reads `OpenThreads`; pick one source.
  - Use work tags instead of the five `useInFlight([...])` action lists.
  - Move `runScript`'s open-the-terminal decision from the view into the action.
  - Give features hand-picked ids instead of `import.meta.url`.

## 4. Performance

After stage 3, which also changes `ThreadView`.

- **Virtualize the timeline.** The timeline window only grows as you scroll up, so a long thread scrolled back through keeps every row mounted: 162 MB of heap against stock's 60 MB in `docs/benchmarks.md`. When the next turn starts, the window collapses to the tail in one long task, 184 ms unthrottled and about 860 ms at 4× CPU. Prototype on [virtua](https://github.com/inokawa/virtua)'s Solid list first. Then rerun the benchmark's long-thread case and check by hand that reflex still matches stock in four cases: staying pinned to the bottom while streaming, Load earlier without a jump, jump-to-row, and a streaming row that grows. If virtua can't match stock in one of those, port `@legendapp/list` (MIT): its `src/core` is framework-free, and only its React container layer needs a Solid rewrite. Carry over T3 Code's `patches/@legendapp__list@3.7.2.patch` too.

## Waiting on treflex

- **Checks that keep agents off React habits.** treflex's verdicts are in `docs/wip/13-external/views-start-work-from-their-lifecycle.md` in the reflex repo. When each one ships, turn it on here and fix what it finds.
  1. **`treflex/no-main-state-in-lifecycle`**, a type-free lint rule, comes first. It also covers timers and microtasks in views. **In progress** in the reflex repo. There will be no npm release: when the build is done, treflex's Main thread sends the branch (`claude/eslint-0.2.1`, `treflex-eslint` 0.2.1, which works with core 0.2.0) and a pack command, and the client vendors the tarball. To turn it on, set `"treflex/no-main-state-in-lifecycle": "error"` in the `jsPlugins` setup, and fix or annotate every site it flags. A site that's really caused by what's on screen gets `// oxlint-disable-next-line treflex/no-main-state-in-lifecycle -- <reason>`, and its action has to be `leading` and check state before it writes.
  2. **A development diag in treflex-solid** for a dispatch into main state from a component or effect. It waits until treflex has chosen its Solid 2 route.
  3. **A restore-under-views check** for the main-or-component-state rule comes after resume's piece 4c.

  Screen-caused work, such as loading the next page when a list's end scrolls into view, gets a named opt-in at the call site instead of being banned.

  4. **`treflex/require-lifecycle-reason`**, opt-in, requires a disable comment with a reason on every `onMount`, `createEffect`, `createComputed`, `createRenderEffect` and `onCleanup`. **In progress** in the reflex repo, in the same vendored `treflex-eslint` 0.2.1 build as rule 1. Turn it on with rule 1 and annotate the existing sites.

## Housekeeping

Any time; none of it touches the client.

- **Record the verdicts.** Add treflex's verdicts to the "Feedback for treflex" section of `issues.md`. The friction write-up is at `G:\Sorted\Code\t3code-dev-home\notes\treflex-friction-from-t3code-port.md`, and the treflex side's verdicts are in the reflex repo's `docs/wip` (commit 2b37348).
- **Server start time.** On a server restart, check whether the roughly 50 seconds between launch and the first log line comes back. See `G:\Sorted\Code\t3code-dev-home\dev-stack\server.log`.
- **Empty worktree folders.** Delete the leftovers under `G:\Sorted\Code\t3code-dev-home\worktrees\t3code`: `reflex-landscape-header-*`, `reflex-inline-media-*` and `reflex-idle-compaction--c2d629098b4fd778`.
- **Stale worktrees.** Clean up about 50 registered `reflex/*` worktrees whose branches are merged.
