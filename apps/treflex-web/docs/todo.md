# Todo

Everything in the pipeline for the treflex client, in the order to do it. Within a stage, the items can run in parallel threads unless an item says otherwise. An item being worked on is marked **In progress** with its branch. Gaps against stock that nobody has asked for yet go in [issues.md](./issues.md) instead.

## 1. Parity and polish

From a pass over `issues.md` for gaps Tam hits in daily use. Each item names its `issues.md` entry, which has the detail.

- **Resend a turn lost to a dropped connection.** **In progress:** `treflex/resend-turns`. Stock's `packages/client-runtime/src/operations/commands.ts` treats an interrupt-only or transport failure on a turn command as lost transport and resends it, with the same command id, across socket loss. Treflex shows "The connection dropped before the server answered" and drops the send, so a message sent as the socket drops can be lost. Port stock's resend.
- **html-render and MCP app rows.** Render stock's html-render rows (`HtmlRenderFrame`, with its long-lived asset URLs) and MCP app rows (`McpAppFrame`) in the timeline, so agents' inline pages and charts show in this client. See "Timeline: the fold and work groups leave out…".
- **Photos from the phone.** Resize and recompress images before upload as stock does, and convert HEIC to JPEG, so iPhone photos aren't refused. Drop duplicates, and show upload progress and a retry. See "Attachments: images aren't resized…".
- **Expired image URLs.** Refresh an attachment or markdown image's signed URL when it expires, so a long-open thread doesn't show "Image unavailable". See "Timeline: an expanded image has no next…".
- **Tool output.** Fetch a tool row's output with `getTurnItem` when it's expanded, since the wire omits it. See "Tool output isn't fetched".
- **Back button.** Push address history when the thread or view changes, so the browser's back button and the phone's back gesture work. See "The address uses `replaceState`".
- **New-thread defaults.** A new thread's permission mode should follow the project's `defaultRuntimeMode`, and its model shouldn't fall back to the first provider's default, which can be a paid one. Match stock's resolution. See "A new thread's permission mode…" and "A new thread starts on the model…".
- **A missing thread.** Report a thread that doesn't exist, as stock does, instead of retrying its subscription with backoff.
- **The diff panel goes stale.** Refetch when a later checkpoint lands, not only on each open.
- **Stop flickers back.** Hold "Stopping" until the shell stream delivers the stopped row. See "Open: Stop flickers back before the run ends".
- **Settings treflex ignores.** Wire up whichever of the 19 settings still marked "Not used here yet" Tam picks. Send shortcut and Time format look easiest. Waits for Tam's pick.

## 2. Restructuring

From an audit of how the port uses treflex 0.1.0. Most of the code already follows the treflex docs. What doesn't is two entities that each do several jobs, and parent views that work out data and pass it down. The first three items touch `ThreadSession` and `ThreadView`, so run them in one thread, in this order. The rest can run beside it.

- **Split `ThreadSession`.** It owns the composer, queue, rewind, fork, diff panel, terminal, git and more. Make the diff panel a child entity that is minted on open and replaced or removed on close. That drops the re-checks after each wait in `openDiff` and `openBranchDiff`, the manual resets in `closeDiff`, and the reliance on `latest` to cancel stale loads. Make the terminal a child entity with its state in plain fields instead of the `Terminal/Attachment` transient. `GitWork` already has this shape. See "move long work onto a child entity" in the reflex repo's `docs/patterns.md`.
- **Checkout and panel selectors.** `ThreadView`'s `ThreadBody` builds the checkout in a memo that compares with JSON, passes it down as a prop and into `ThreadDetails` component state, and passes it to every `GitWork` action. Add one `checkout` selector on `ThreadSession` and let `GitWork` read the checkout itself. Panel availability is worked out in both `Environment.panelShortcuts` and `ThreadBody`'s menu and launcher, so make it one selector too. `terminalLaunch`, `searchRoot` and `Dictation.recordingOptions` resolve the working directory separately, and should use the same selector.
  - Move git status into main state here (`ThreadDetails.ts` `attach`). The details card mounts for every thread with a checkout, even while hidden, so the subscription already lasts as long as the thread is open. Open it from `selectThread` or a checkout change, on `ThreadSession` or a child entity. The branch list is per project and can go with it, and so does the card's `createEffect` that refreshes status when it's shown. Then derive the `vcs-status` scope in `Activity.ts` `scopes` from that subscription, instead of from the conditions under which `ThreadView` mounts the card, and report straight away when it opens or closes, as stock does.
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

## 3. Missing features

Built on the restructured model, so after stage 2. Each item groups related gaps from `issues.md`, which lists them in full. They can run in parallel, apart from items that touch the same view.

- **Composer.** `@` thread items and chips in place of markdown links, the built-in `/model` and `/clear`, keyboard shortcuts, project skills from the workspace snapshot, and stock's steer-while-approvals-show override. See "Composer: no stash…" and "A send during a run…".
- **Timeline rows.** Compaction dividers and `/compact` turns, superseded-attempt folds, the tool-call visibility setting, viewed-image strips, the "Waiting on N subagents" label and stock's per-tool detail in expanded rows. See the "Timeline" entries under "Unmatched against the stock UI".
- **Sidebar.** Search, bulk settle, an archive view with the way back, custom snooze time and Regenerate title. See the "Sidebar" entries.
- **Thread details and git.** Context and usage rows, environment and worktree pickers, git progress phases and hook output, View PR, Initialize Git and Publish repository. See "Thread details" and "Thread details, git".
- **Diff panel.** Stock's `@pierre/diffs` view with syntax highlighting, split view, wrap, tabs and the turn picker, and restoring a checkpoint. See "Diff panel" and "Restoring a checkpoint isn't offered".
- **Terminal.** Tabs and splits, a resizable drawer, links, search and a restart button for an exited shell. See the terminal entries under "Skipped for the prototype".
- **Right panel surfaces.** Files, Pull request and Browser, which the launcher lists but disables. Tam picks the order.
- **Settings pages.** Of the pages greyed out in the nav, build the ones Tam picks; Labs, Worktrees and Source control look most used.
- **Usage limits from external sources.** Open the config stream with `usageLimitSources` and show the usage-limit hubs, as stock does. See "Usage limits".

## 4. Performance

After stage 2, which also changes `ThreadView`.

- **A cold open from HTTP and a cache.** Load the first snapshot over HTTP and seed it from a persisted thread cache, as stock does, so a reload doesn't wait on a socket snapshot. See "Mismatch: a cold open takes a full socket snapshot".
- **Jump into history.** Support `throughEntryId` history pages, which jump-to-row needs once the timeline is virtualized. See "History pages load older rows only".

- **Virtualize the timeline.** The timeline window only grows as you scroll up, so a long thread scrolled back through keeps every row mounted: 162 MB of heap against stock's 60 MB in `docs/benchmarks.md`. When the next turn starts, the window collapses to the tail in one long task, 184 ms unthrottled and about 860 ms at 4× CPU. Prototype on [virtua](https://github.com/inokawa/virtua)'s Solid list first. Then rerun the benchmark's long-thread case and check by hand that treflex still matches stock in four cases: staying pinned to the bottom while streaming, Load earlier without a jump, jump-to-row, and a streaming row that grows. If virtua can't match stock in one of those, port `@legendapp/list` (MIT): its `src/core` is framework-free, and only its React container layer needs a Solid rewrite. Carry over T3 Code's `patches/@legendapp__list@3.7.2.patch` too.

## Waiting on treflex

- **Checks that keep agents off React habits.** treflex's verdicts are in `docs/wip/13-external/views-start-work-from-their-lifecycle.md` in the reflex repo. When each one ships, turn it on here and fix what it finds.
  1. **`treflex/no-main-state-in-lifecycle`**, a type-free lint rule, comes first. It also covers timers and microtasks in views. **In progress** in the reflex repo. There will be no npm release: when the build is done, treflex's Main thread sends the branch (`claude/eslint-0.2.1`, `treflex-eslint` 0.2.1, which works with core 0.2.0) and a pack command, and the client vendors the tarball in place of `vendor/treflex-eslint-0.2.0.tgz`. To turn it on, set `"treflex/no-main-state-in-lifecycle": "error"` in the client's override in the root `vite.config.ts`, and fix or annotate every site it flags. A site that's really caused by what's on screen gets `// oxlint-disable-next-line treflex/no-main-state-in-lifecycle -- <reason>`, and its action has to be `leading` and check state before it writes.
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
