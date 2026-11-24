# Issues

Problems found while building the treflex client: gaps in treflex, mismatches with the t3code server, and anything that pushes towards a server change.

## Setup: `vp` does not select the pinned Node on this machine

The repo pins Node 26.12.1 and the server needs 24.10 or later, but `vp` stays in `system_first` mode and runs the system Node (24.4.1). `vp env exec --node 26.12.1` also ran 24.4.1. `vp env on` would fix it, but it changes the machine-wide mode, which other projects share.

Workaround: use Node 26.13.0 through nvm. The pin in `package.json` isn't enforced, and `vp i` and `vp run dev` work on it.

## Setup: `vp run check:changed` fails its unused-patches step

The step runs when a change touches a dependency file: `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `.pnpmfile.cjs`, `patches/`, `apps/{mobile,web}/deps/` or any `package.json`. It installs in a temp copy of the repo, which has no `apps/treflex-web/vendor/treflex-eslint-0.3.0.tgz`, so the install fails. The fix is in `scripts/check-changed.ts`: its `extra` copy list lacks `apps/treflex-web/vendor`.

## Gap: the connection runtime has one public door

`client-runtime` exports the session factory only as a type, so reusing the supervisor means building the whole `Connection` layer. That layer requires the relay client, DPoP signer, SSH gateway, cloud session and stores, none of which one cookie-authenticated environment uses. `Infrastructure/connection.ts` mocks them, and a mock dies if it's ever called. Adding a remote environment means replacing these mocks.

## Limit: a server-side defect shows as the sidebar error

An action's `catch` takes only a `ServerError`, which `settle` makes from an Effect run's typed failure, and rethrows a defect as a bug. The RPC client delivers a defect the server died with as a defect too, so it can't be told from a client bug: it reaches Root's sidebar error instead of the inline error line where the action would show a refusal. Telling them apart needs the RPC layer to mark a defect that came over the wire.

## Gap: the command path assumes atoms

`createEnvironmentRpcCommand` and its `permissionAtom` take an atom runtime, so they don't fit without one. Commands go through `client-runtime/operations` and `request`, run with `EnvironmentRegistry.run`. That skips the client's permission check, so a connection without the scope learns from the server's refusal. `startThreadTurn` also needs `SecureRandom` provided, even when given a command id.

## Limit: the timeline's scroll corrections on iOS

The timeline scroller is bottom-anchored (`column-reverse`), so rows loading above need no scroll write and a phone can fling to the top in one go. Growth at or below the reader needs a correction, and iOS drops a scroll write during a touch and stops a fling at one. So the tail is held while the reader scrolls up. A row between the viewport and the tail that grows mid-gesture, such as a lazy iframe or an image settling as you scroll down into it, still gets a correction that iOS may drop. If bottom-anchoring ever has to go, the idle hold it replaced is at `c4593035d3`. Virtualizing doesn't help, because stock's LegendList corrects with an immediate `scrollBy` on the web too.

## Limit: providers exercised

Replay and one provider are verified. A real Claude Haiku turn from this client completed with a file-change approval approved in the same tab, and a pasted image and an attached Markdown file each reached the provider, which answered correctly. `devReplay`'s ACP agent refuses image prompts, so an image turn there fails with "The provider could not start this turn". Codex and the other providers haven't been run from this client.

## Mismatch: the wire format is decoded and then re-encoded

The RPC client decodes each stream item into `DateTime`s and the app encodes it back to hold plain data in the tree. This is negligible per delta (about 0.03 ms each way) but about 80 ms on a 1,000-item snapshot. If that matters, the fix is a protocol client without the decode, which `client-runtime` doesn't offer.

## Mismatch: a cold open takes a full socket snapshot

The stock client loads the first snapshot over HTTP and falls back to the socket, and seeds it from a thread cache it persists. This client always uses the socket and persists nothing, so a reload, or opening a thread not viewed in the last five minutes, waits for a snapshot. Reconnects and returns to a retained thread resume from the cursor.

## Mismatch: `thread.removed` doesn't say why

The shell sends the same item for an archived and a deleted thread, and `thread.deleted` only reaches a thread's own stream. So a thread deleted elsewhere while closed keeps its `ThreadSession`.

## Cost: a reconnect snapshot reconciles every row

About 50 ms at 1,000 items and 1.1 s at 20,000. The bounded window keeps a socket snapshot near the low end, but it will be a visible pause if history pages have grown the thread and the socket reconnects past the replay limit.

## Cost: `compactionCandidate` reads the whole thread

The bench shows the selector tracking 166,726 reads in one run at 20,000 items, so any change to one of them re-runs all of it.

## Cost: stream items queue in treflex, not the socket

`r.emit` resolves once a message is queued, not delivered, so the shell and thread streams read the socket with no backpressure from the receivers, and the cursor advances as each emit is queued. A receiver failure ends the stream with `receiver-failed` through `endOnReceiverFailure`.

## Mismatch: replaying terminal history after resizes can misdraw a line

The server's history is the raw PTY bytes, written at whatever width the shell had. After resizing between 47, 53 and 80 columns and then reattaching, one prompt line drew its typed text over the prompt, because ConPTY's cursor positions no longer matched the replayed screen. A shell at one width replayed cleanly. Stock replays the same history.

## Limit: busy marks are per action

Every busy mark is an `inFlight` read, which says whether an action runs on an entity and not which arguments it runs with, and only a repeat of the same `latest` action or the removal of its entity stops a running one. So where a mark has to be per row, or end with the data it's about, the row is an entity of its own:

- Each runtime request, so an answer marks only its own request's buttons. The answer waits inside `open(...)`, so a server update or snapshot folds into the request while nothing holds it, and `leading` still drops a second press during the wait. Its typed answers stay on the `ThreadSession`, keyed by request, because the replica's fold would delete them and an expired thread drops its data. `settleQuestions` clears them once the request is no longer pending.
- The history window, which a snapshot with another cursor or has-more, or over a window holding a fetch error, replaces, ending its fetch and its mark. Its pages reach the thread through `History/Page`, and the thread drops a page from a window it no longer holds, which a page queued behind that snapshot would be. The window holds only its cursor, has-more and error; the rows stay on `OpenThread`. Once treflex has `stop(action, owner)`, `loadEarlier` can move onto `OpenThread` and the window entity can go.

## Gap: a selector can't search every turn item for a request's

Stock's `derivePendingThreadRequests` searches every turn item for each pending request. Here every read goes through the view proxy, so a selector that reads every held item, even through `Object.keys`, costs about 200 ms per added row at 20,000 items. `requestItems` walks `Timeline` from the newest row instead, which reads only the rows after the request's item, and nothing when no request is pending.

The timeline doesn't hold every request's item. A bounded snapshot keeps a pending request's item in `turnItems` after its window drops the row (`isRetainedDependency` in `apps/server/src/orchestration-v2/threadHistoryPaging.ts`), and stock shows the request from it. A timeline walk would read every row and miss it, so `applySnapshot` records those items in `OpenThread.RowlessRequestItemIds`, which `requestItems` reads first. Only a snapshot takes a held item's row away, and every new item gets a row, so a held item is always on the timeline or in that list.

## Review: treflex paradigms after Solid 2

A review of the client against treflex 0.3's and Solid 2's rules, merged with its fixes. What it left:

- **Kept, Tam 2026-11-24: details card fit** (`ThreadSession.ts` `Fits` and `Popover`, written from a `ResizeObserver` in `ThreadView.tsx`). A measurement and an open popover in main state fail the restore test, but they fit views.md's "caused by what is on screen" exception, are safe at every mount, and stock keeps both in stores. Moving them means moving the shortcut into `ThreadBody`, the popover into view state, and the model tests into the browser.
- **Kept, Tam 2026-11-24: question collapse and diff wrap** (`RequestViews.tsx`, `DiffPanel.tsx`). Both are signals that reset on a thread switch, as in stock, for parity. The alternative is `QuestionCollapsed` on the session and `Wrap` on `IDiffPanel`.
- **Kept: a frame after a treflex dispatch** (`App.tsx`, `ComposerMenus.tsx`, `TimelineRows.tsx`). `onFlush` would be wrong there: a dispatch queued behind a held entity lands after the next flush.
- **Open: `viewport.ts` `enterPanel`** still waits a microtask for its element. It's the ref of elements that `<Show>`s in `ThreadView` mount, which have no component of their own to wait in with `onSettled`. It needs its own component if a `<Loading>` ever holds a commit there.
- **Open: the restore repair has no caller.** `repairRestore` in `Root.ts` rebuilds draft files and restarts the Usage and Archive loads, and `Model.test.ts` restores through it. Nothing in the app snapshots yet, so it runs only in tests.

## Feedback for treflex

- `merge` is gone, and `reconcileRows` takes one array of keyed rows at a time, refuses an incoming row without a key, and is a generator an action has to `yield*`. Folding a wire payload with nested keyless arrays into a held node in place, from the synchronous apply code, needed an app-side helper (`reconcile` in `rows.ts`). `reconcileRows` doesn't accept records, and the replica keys its rows by id in records to keep a delta's lookups constant, so the runtime requests' entity-aware fold (`reconcileEntities`, `putEntity`) is app-side too.
- Selectors that return fresh objects remount `<For>` rows and wake any parent selector, because a memo compares with `===`. An opt-in equality setting or structural sharing would cover both.
- `inFlight(action, owner)` has no per-argument form, so a per-argument mark has to be composed, and one action can't stop another's run on the same entity. The entities in the limit above follow from that.
- A transient costs a named helper and a selector for each view that reads it. Nothing here snapshots, so they buy no behaviour in this app.
- No entity hears its own failures, so `Root`, the parent of `Environment`, is the nearest error boundary for the Environment's own commands. A failure the boundary writes has no clearing rule of its own, so `Root` needed a dismiss action.
- There's no public way to react to derived state (`watch` is internal to treflex), so `Shell.visitShown` has to be called from each event that can show a thread or complete one: `selectThread`, `openView(null)`, the shell receiver and its reconnect. A new way to change `SelectedThreadId` or `Local.View` has to join that list; a hand-written one first missed closing Settings. `startWatch` would replace the list.
- `leading` goes by entity, which broke the visit: it ran on the Shell for any thread id, so a visit to thread B was dropped while thread A's visit was in flight, a real per-argument `leading` case.
- Rows that belong to one ordered list with the parent's live rows can't be owned by the child. Moving loaded history pages onto the window entity split one sequence across two entities, so placement had to read and write both, and two ordering bugs followed. Lifetime fit the "results live and die with the window" case; order did not.
- A timer recurs, so every backoff tick starts with `stopTimer`. There's no one-shot timer.
- Keeping an entity for a while after its view leaves has no mechanism of its own. Retaining a left thread composes one: close its stream, start an expiry timer on it, and on the tick publish to the parent, because an entity can't remove itself inside its own delivery.
- The timeline's `<For>` iterates ids from the `timelineIds` selector, a plain `[...draft.Timeline]` copy. Each row-adding delta re-runs the copy, which reads every id through the view proxy: about 31 ms p50 at 20,000 rows. The history window keeps a cold open near 500 rows, so this doesn't show at real sizes. If it does, send treflex the size and the timing; they've said they'd make the whole-array copy cheaper inside treflex rather than add an API.
- A resource has one `r.status` detail string, and the terminal's connection phase already uses it, so the shell process's status goes through `emit` into the shell entity's `Status` field.
- Only `treflex-eslint`'s type-free rules are on, through an override in upstream's root `vite.config.ts`, because a `lint` block in this app's `vite.config.ts` replaces the root config instead of adding to it. The typed rules (`no-discarded-generator`, `no-edit-after-write`, `no-hidden-open`, `no-returned-promise`) throw under oxlint for lack of type information, so a forgotten `yield*` on the app's own generators goes unreported. Treflex's `require-yield-star` check, including a missing `yield*` before `someGen`, `filterGen` or `mapGen`, is a Biome plugin, which oxlint can't load.
- "Do not create an entity only so that its removal closes a resource" sits against a resource being keyed by owner and key: each expanded command row's output needs an entity of its own (`ICommandOutputRow` on `ThreadSession`) only so several can be open on one session.
- Persistence is whole-runtime only: a snapshot carries the whole tree, and nothing persists one slice, such as `Local`'s preferences, across a reload. Each kind of preference was persisted its own way until it converged on a read effect at creation plus a write effect per change (`Infrastructure/preferences.ts`, `draftMemory.ts`). A persisted slice, read before the first render and written per change, would replace those effects and the pre-paint read of the colour scheme in `index.tsx`.
- The 0.2 to 0.3 upgrade notes don't mention third-party Solid 1 libraries. `lucide-solid` peers Solid 1 and has no Solid 2 release, so this client replaced it with its own icon component over `lucide`'s data.
- The notes' test setup leaves out four things that cost time here. Setting `resolve.conditions` replaces Vite's defaults rather than adding to them. `@solidjs/vite-plugin` adds the `"solid"` condition itself, so an app can drop its own. The plugin inlines `solid-js` for tests only when the app sets no `test.server.deps.inline`. And the `"browser"` condition is needed by any Node-environment test that imports Solid, not only a component test.
- "Put an `<Errored>` at the root" changes what a view's throw does compared with 0.2's provider, which reported the throw and left the rest of the page running. A root `<Errored>` replaces the whole app with its fallback. The notes could say so, and suggest boundaries lower in the tree for an app that wants the old behaviour, with `render`'s `onError` to report what they catch: a boundary's catch reaches no global handler.
- "A rejection reaches an action as a copy" could say that `instanceof Error`, `TypeError` and `DOMException` still hold for the copy, and that `effect/class-rejection` checks only the thrown value, not its `cause`.
- The notes leave Solid 2's own changes to Solid's notes, but one caused most of this migration's regressions and no diagnostic catches it: a read after a write in the same tick sees the old value until the flush, for memos and the DOM as well as the signal. Here it broke scroll-to-end memory, the folder picker, the command palette's search, the composer's focus on expand, the collapsible's animation and the timeline's scroll correction. `STRICT_READ_UNTRACKED` and `ownedWrite` say nothing about it. The notes could flag it, together with the other Solid 2 changes that cost time: boolean attributes render by presence (`aria-*` and `spellcheck` need `"true"`/`"false"` strings), `useContext` throws without a provider and no default value, `onCleanup` throws `CLEANUP_IN_FORBIDDEN_SCOPE` in `onSettled`, `createTrackedEffect` and ref callbacks, while in `createEffect`'s apply phase dev only warns `NO_OWNER_CLEANUP` and the cleanup never runs, so production leaks silently, and `createMemo` has no initial-value argument.

## Differences from the immutable reducer

- `Timeline` isn't pruned. A hidden row keeps its place and renders nothing, because `TimelineRow` applies the shared visibility rule itself, so a run status change wakes only that run's rows. A hidden row can therefore come back live: a superseded interrupt result reappears if its request arrives afterwards, where the reducer has already dropped the row and only a reload would restore it. The same goes for a partial window, where the reducer treats the next update to a row it hid as unloaded history.
- A message with raw block-level HTML renders whole through the sanitizer, because the HTML can span blocks, so its code blocks have no header or copy button.
- Records don't keep the wire's array order, so anything that needs order sorts by `ordinal`.
- `archivedThreads` isn't held: the server always sends it empty, and the archive is a separate query.
- `position` isn't held: it's the row's index.

## Skipped for the prototype

- Deferred work isn't opted into (`acceptDeferredWork`), and `deferredWork` isn't preserved across updates, so a fold never loads work on opening as stock's does.
- History pages load older rows only, with no `throughEntryId` jump.
- `ServerSettings`' `automaticGitFetchInterval` and `providerHealthRefreshInterval` sit in the tree as `{_tag: "Millis", value}`, which `Wire<T>` doesn't describe. No patch treflex builds carries them; one that does must send that shape, since `decodePatch` rejects a plain number.
- The timeline window follows its top row when that row moves, so a top row moved far down (`placeRow` on an ordinal change) would collapse the window to the tail until the sentinel grows it back. No known server path moves an old row.
- An expanded tool row fetches its item once. Stock refetches when the item's revision changes while it's expanded; here a row expanded while its tool runs keeps the running item until it's collapsed and expanded again.
- A command row doesn't check the server's `commandOutputStreaming` capability, so an older server shows the subscription's error.
- A secret card takes a typed value only. Stock offers answering from a configured secret provider, behind its `T3CODE_FEATURE_SECRETS` build flag, which the driver's stock web doesn't set.
- A link card knows no other machines, since this client connects to one environment: it always links to an address with a pasted pairing code. Stock also lists the user's saved and T3 Connect machines, mints the code itself on one it's connected to, and offers an existing link. Treflex doesn't check the session's access scope, so a session that can't manage access sees the card's buttons and gets the server's refusal.
- Drafts live in this port's `localStorage`, not stock's draft store, so the two clients keep separate drafts. A file whose upload hadn't finished when the page closed is dropped, where stock keeps it as a row to attach again. Images are kept as data URLs, as stock keeps them, so a few large ones can fill the store, and the write is then dropped. A new-thread draft with attachments but no text doesn't come back after a reload: its project is kept only with the text, so the new thread gets a fresh id and the stored files are never read.
- A send during a run follows the Follow-up behavior setting, but not stock's override to steer while approvals are shown. A send during a compaction that can't take a steer isn't forced to queue, and Enter on an empty composer doesn't resume a held queue.
- The queue popover has no keyboard shortcuts for send now or edit, and an edit changes only the text, not attachments. Stock has no reorder either.
- The picker keeps a runtime-catalog driver's active model listed as Unavailable when the catalog drops it, but only for a provider that's ready.
- A sent message appears when the stream delivers it, with no pending row in Local; the gap wasn't noticeable.
- A new thread's last picked model and each model's options are kept in this port's `localStorage`, not stock's draft store, so the two clients remember picks separately. Its seeded model, from the project default, the thread it was started from or the last pick, isn't stored, so a reload seeds it again without the thread it was started from.
- The address names a new thread by its project (`?new=`), not its draft. A back to an older entry for a draft that has since become a thread opens a fresh draft in that project, where stock's `/draft/<id>` route moves on to the thread.
- A new thread asks the server to generate its title, which uses the server's title provider. On this machine that's Codex, which fails to spawn, so titles fall back to the text.
- Assistant markdown is lexed whole on every delta, though only the changed block re-renders. A delta takes about 1 ms at 2 KB, 2.3 ms at 10 KB, 6 ms at 30 KB and 19 ms at 100 KB before layout, so only a very long message overruns a frame.
- The drawer's tabs are only the ones this device opened. Stock also lists the thread's other server terminals from the terminal metadata stream (`reconcileThreadTerminalSessionIds` in `apps/web/src/terminalUiStateStore.ts`), such as shells another client or an agent opened, and drops tabs whose shell the server stopped reporting.
- A new-thread draft has no terminal until its thread exists.
- A failed attach retries on the next socket session, or from the shell's Restart button.
- Closing a shell waits for the server and shows a failure on its pane, with no fallback to typing `exit`. Stock closes the tab at once and types `exit` if the close fails.
- A second viewer's grid isn't followed: the server sizes the PTY to the smallest viewer, and this client still draws its own size.
- A shell keeps the directory it started in; only a new tab follows a worktree the thread gains since.
- A thread deleted elsewhere while closed keeps its remembered drawer in `localStorage`, for the reason under `thread.removed`.
- Terminal links: a path is offered whether or not it exists (stock checks the filesystem before underlining it), and opens in the editor; a URL opens in a new browser tab, not stock's in-app preview. Both need Ctrl-click (Cmd-click on a Mac), as stock's do. No `file://` hostname check, and no hover tooltip.
- The terminal has no clear button, font setting, close confirmation or "add selection to the composer" menu.
- The terminal doesn't pass `providerInstanceId`, as stock's default launch doesn't.
- The benchmark uses a generated fixture: `~/.t3` doesn't exist here and the dev home holds only a few short threads.
- The benchmark calls the receiver directly, so it leaves out treflex's clone of each emitted message.

## Unmatched against the stock UI

- Visits:
  - Reloading on a thread doesn't count as an open, where stock's chat view sends `opened: true` on every mount. Treflex sends it when a thread is selected, or reselected from Settings or Usage.
  - The palette sends the query that picked a thread as `searchQuery`, which stock never does.
  - The wake watermark (`wokeAt`) is ignored.
  - Stock (`packages/client-runtime/src/state/threadVisits.ts`) also visits on every shell update while the chat view is mounted, throttled to one every 10 s, where treflex visits only on an unseen completion.
- Questions: an answer can't carry attachments or thread chips, so the attach button hides while a question holds the composer. Text set aside when an option replaces it shows as a line in the card, not a toast, and undo doesn't take it back out of the draft. Question drafts don't survive a reload.
- Thread links: a link to a thread the shell doesn't hold shows its written label, or "Thread", and still opens, where stock asks the server for its title and shows "Thread no longer available" when it's gone. A thread on another machine is named but never opens, since this client connects to one environment. The chip has no hover card; `t3code://` deep links and prompt links aren't recognised, and a raw-HTML block's thread link keeps its written text rather than the thread's title.
- Messages from other threads and automations: the automation fold shows the prompt's first line, not its scheduled task's title, and has no Open automation link. Consecutive steers each show their Steer label, where stock shows it once, because a row doesn't know its neighbours. Guest messages show the guest's words without the guest name or styling.
- Project icons: a cloned project's icon isn't asked for again when its clone lands, as stock does, so it shows the monogram until the next request after the 30-minute refresh. An icon file changed in place shows on the next refresh, not straight away.
- Sidebar: no "Setting up" state for a thread launched from a draft before its first run lands. A title being regenerated dims, where stock runs a shimmer over it.

- Sidebar: no pull requests button in the footer, because this client has no pull requests page.
- At 390px wide, a row's "More actions" menu opened from the keyboard appears at the viewport's top-left corner instead of beside the row.
- At 390px wide, Thread actions → Diff opens the "Open a surface" picker instead of the diff.
- At 390px wide, the diff toolbar's scope select is cut to "C.." and the "+N -N" count overlaps the refresh icon.
- Command palette: no "Open settings" or "Project settings" actions.
- Sidebar: the active list uses stock's order key, but stock's inbox places a few threads differently (`ask me` here), and there's no working shelf.
- Sidebar: snoozing the open thread, from a preset, Custom… or the bulk menu, leaves it open, where stock's `performSnooze` moves on to the next row as settling does.
- Sidebar: no auto-settle toggle, no drag across rows from a Settle, Un-settle or Wake button to apply it to each (stock's sweep), and no Archived undo notice after an archive; the way back is Settings, Archived.
- Sidebar, multi-select: Ctrl or Cmd-click and Shift-click select rows, and the bulk menu acts on them. Each thread's command toasts its own failure, where stock's bulk snooze and delete toast once for the batch, and a bulk unpin doesn't ask for the Unpin confirmation. Selected rows can't be dragged together. A Regenerate title send the server refuses toasts on its own rather than counting in the batch's toast.
- Custom snooze: the date is the browser's date input, not stock's calendar popover, the amount is a plain number field, and there's no "Edit snooze options" link, since the Threads settings page has no snooze presets yet.
- Sidebar: every settled thread is streamed, where stock omits older ones and pages them in.
- Sidebar: grouped by project, pinned threads lead their own folder, in pin order, where stock lists them in one Pinned section above the folders, so a closed folder hides its pins. Dragging reorders pins only within their folder.
- Projects: Add project is stock's palette for its own views only. It clones only from a pasted URL, with no hosting-provider sources (GitHub and the rest, with their Setup Required state) or repository lookup, and a new project can't be published to GitHub from it. There's no environment chooser and no keyboard shortcut to open it. Folders group one per project, as stock's "separate" mode, with no repository grouping, and every open project has a folder, where stock shows an idle one only while pinned. No project archive.
- Projects: the folder menu has no Project settings page (icon, default model, workspace, actions, checkouts); rename is in the menu instead. Open in file manager is offered on the server's machine whatever the server's `availableEditors` says.
- Projects: removal counts only threads the shell holds, where stock adds the older settled threads it pages in, so the count can be low. It removes one project, with no grouped checkouts, and a failure stays in the dialog rather than a toast.
- Projects: the order is per browser and port, as stock's is per browser, and keyed by project id where stock keys by environment and path, so a removed and re-added folder goes to the end. The sort choice is a sidebar picker, not a setting, and defaults to Manual (stock: Last user message), whose unsaved order is the old one: pinned first, then by title. The time orders keep pinned projects on top, which stock's don't.
- Projects: dragging works with a mouse or pen in Manual only, with no keyboard or touch, as stock's old project drag had neither. Folders don't animate into place.
- Projects: a clone that fails or finishes while its project isn't open shows nothing until you open it; stock raises a toast.
- Sidebar: Limited and a waiting guest message's Request aren't distinct states, drafts have no card, and the thread list shows no scrollbar.
- Sidebar hover card: no environment, terminal process or pull request lines, and a long branch is cut at the end rather than the middle.
- Provider icons: Antigravity's bundled image and an ACP Registry agent's registry icon aren't drawn, so those providers (Replay among them) show none. A provider with no icon gets no instance badge either: those two, and the model menu's letter fallback. A thread on a disabled or unavailable instance shows no icon, so no instance badge either, where stock shows both. The model menu and the subagent bar decide their badges by each instance's enabled flag on the server, where stock's apply the project's own provider choices first.
- New thread: a pen button targets the current project, and a small chevron beside it opens the palette's project picker, where stock has one button that opens that picker.
- Header: no title menu.
- Thread details: no environment or worktree pickers (the machine row only names it), no usage, context, servers, automations, side chats or linked pull request rows, no "Choose what to show" menu, and no compact or essential density for a short window. Only an open thread has the card; a new-thread draft doesn't.
- Thread details, lineage: no side chats section, delegated-from row, workflow groups, stop-subagent button or disconnect menu, and the rows have a plain tip where stock has a subagent hover card and provider icons. A task delegated to a linked environment is listed but can't be opened from here.
- Thread details, git: no progress phases or hook output while an action runs (the row says Working…), no View PR for a branch with an open pull request, no Publish repository dialog or Initialize Git, and no live branch sync for drafts. The commit dialog lists files without opening them in the editor. Changes counts come from status alone, not the diff preview stock reads, and status refreshes when the menu opens, not when the window regains focus.
- Thread details, branches: the picker lists the first 100 refs with a server-side search, with no pull request checkout, worktree moves or context menu; a branch checked out in another worktree is refused.
- Thread details, scripts: a script runs in the drawer's active shell, busy or not, where stock reuses an idle drawer shell (`findReusableProjectScriptTerminal` in `apps/web/src/lib/projectScriptTerminal.ts`) and otherwise opens a new one. Scripts can be added but not edited or removed, and `t3.json` file scripts aren't imported. Scripts have no keyboard shortcuts, and `editor.openFavorite` isn't handled.
- Right panel: the launcher opens Terminal (as the drawer) and Diff; Browser, Files, Pull request, Linked pull requests, Device and Side chat are listed but disabled. Files is disabled because stock's entry opens the folder browser, which isn't here; a file opens in the preview from its link, its attachment card or the diff. No tabs or maximize; one surface shows at a time, so opening a file replaces the diff or side thread.
- Files preview: no folder browser, breadcrumb folder menus or editor picker in its header, no editing or saving, and no lookup of a bare file name across the workspace before reading it. A text file over 1 MB shows its first megabyte with stock's notice, where stock streams the rest through its large-text viewer, and an attachment over 1 MB does the same. PDF, HTML, Office, font, notebook, Mermaid and delimited-table files show as source or as "No preview for this file". A link to a subfolder opens the preview's "not a regular file" error, where stock opens its folder browser.
- Tooltips: the effort picker's level descriptions are as wide as other tips, where stock narrows them to 14rem. Moving between a message's link and file tips swaps the tip in place, where stock slides it to the next anchor.
- Timeline: the fold and work groups leave out hiding delegation rows that a subagent card replaces, and the timestamp setting. Resumed subagents fold with the response they appear in, not their original turn. Stock's tool icons and shimmer aren't copied, so a running compaction's divider doesn't shimmer, and an expanded group grows to a fixed height rather than by its open entries. A `/compact` turn's divider stands in for the running turn's "Working" fold. A superseded attempt's fold doesn't load deferred work, which this client never asks for.
- Timeline: an expanded tool row follows stock's per-tool detail, except that a file change has no Open diff (the row's View diff opens the turn), a read shows the tool's arguments rather than stock's path line, commands aren't highlighted inside embedded scripts, and a web result links only to an `http` or `https` address. Reasoning and the other rows keep this client's body.
- Timeline, a thread's scroll position: a return to a place in history pages the server sent before the thread expired (five minutes after leaving it) follows the end, since those pages aren't fetched again; stock scrolls to the old pixel offset instead. A put-back place holds while rows below it grow, until the reader's own wheel, touch, key or scrollbar drag; a script or find-in-page scroll in that time is undone by the next growth.
- Timeline, rendered pages and MCP apps: a page's links open in a new tab, not stock's in-app browser or pull request view, and a page's images open alone, without the gallery. An MCP app's tool line sits right above it as one row, so a work group never takes it in, and an app's frame doesn't keep a virtualized row mounted (this timeline isn't virtualized).
- Timeline, subagent cards: no hover card with the model, project and branch, a task on a linked environment doesn't open, and a path-like result line is cut at the end rather than the middle.
- Timeline: no minimap, and the scroll-to-end pill doesn't summarise what's waiting below.
- Running turn (a deliberate divergence, see the README): a turn that did no work drops its fold when it settles, as stock's does, so its reply moves up a row then. A stopped or failed turn unfolds its work, as stock's does. The status line keeps its row above the composer while idle, and the queue is a popover rather than stock's control above the composer.
- Message actions: no reply or prompt link action. Fork shows only on a settled response's last reply, where stock offers it on every finished reply, including in a running turn. Edit from here doesn't wait for attachments still being read in (stock refuses while they prepare), restores a message's text without its thread and environment mention records, and doesn't check the environment's operate scope (see "the command path assumes atoms"). Stock's busy fork button pulses; this one only disables.
- Timeline: approvals show every option inline, with no More menu and no decline-by-typing placeholder.
- Attachments: a preparing image's tile is blank where stock shows the source's thumbnail, and Enter while images prepare does nothing rather than arming a held send. The 80 MB total for images is left to the server, and the text has no inline chips referring to attachments.
- Attachments: a file card looks the same with or without message text, where stock lists files as rows above the text.
- Attachments: a dropped or pasted folder is refused, as on stock web; stock desktop inserts its path.
- Timeline: an expanded image has no next, previous or zoom. An image, video or audio URL is signed again only when it fails to load within five minutes of its expiry, where stock signs every shown URL again each 30 minutes; a file card's link isn't, so one clicked after an hour opens the server's error. A markdown image of a file the agent rewrites keeps showing the old bytes until the message remounts.
- Markdown images: no copy, download or open-file actions, and no "pair again" hint when the connection can't read host files. Video and audio embeds show their alt text. An `<img>` in raw HTML still loads only web and data sources, so a file path there shows nothing.
- Markdown: no run-in-terminal button, math or diagrams. A code block is highlighted once its fence closes, where stock highlights it line by line as it streams, and wrap defaults on rather than following a word-wrap setting.
- File link chips have no Open in integrated browser (stock's is desktop only), no remote editor links (stock's `vscode://` links over SSH or Tailscale), no lookup of a bare file name across the workspace and other projects, no drag, no size in the tooltip and no app-bundle icon. Dart, Java, Lua, PHP and R files use Pierre's generic icon, not stock's own.
- Changed files card: flat list, not a tree, and its rows don't open a single file's diff.
- A project that is a plain folder holding tracked repositories (the Test project, around `details-git-demo`) shows no changed files card: the card counts the thread folder's own checkpoint files, and a repository's changes sit on its own checkpoint scope. Stock's card counts them too (`turnChanges` in `packages/client-runtime/src/state/threadRepositories.ts`). The diff panel shows them.
- Composer: no stash, multi-model send or keyboard shortcuts. The `@` menu lists files only, with no thread items (nor machines or models), shows a generic file or folder icon where stock shows per-type icons, and inserts a plain markdown link rather than a chip. The `/` menu has no built-in `/model`, `/side`, `/btw` or `/clear`, and skills show no source badge. Commands and skills come from the provider list, without a project's workspace snapshot, so project-only skills are missing. Prompt history moves at the first or last line of the text, not the wrapped visual line. Once a stop lands, the button that takes Stop's place doesn't ignore clicks for stock's 500 ms (`STOP_LANDED_CLICK_GUARD_MS`).
- Model menu: no number-key jumps, provider setup or update notices, unavailable-provider state, custom models from settings, New badges, and a fixed height rather than stock's fit to the tallest tab. Providers other than Claude and Codex show a letter, not their icon. A favorite toggle doesn't migrate favorites a stock browser kept locally before the server held them. A non-reasoning option such as an agent's mode opens its choices below its row, not in a side menu.
- Model menu: a typed `ultrathink` doesn't take over the effort label or lock the levels, the effort shows as a word with no bars setting, and the provider's reported selection isn't shown.
- Permissions: no overflow menu at narrow widths, and modes a managed policy forbids aren't disabled. A new thread's strip under the composer holds only the permissions chip, with no workspace or branch pickers.
- Diff panel: no Commits submenu, base ref picker (the comparison target shows as text), file tree, hide test files, refresh when the panel is shown again, file context menu, copy path button, line comments, tool-call diffs, or lazy loading of large Git diffs (stock asks for metadata and loads each file's patch as it scrolls in). A file title in a repository's Git scope, or in a turn's repository outside the thread's folder, opens in the editor, as stock's does.
- Diff panel: the Git scopes of a folder project list only the repositories the thread changed, not the project's other tracked folders (stock adds them through `filesystemEnvironment.listFolders` and `taskFolder`). Whether the thread's folder is a repository comes from its checkpoints being missing, not from Git status.
- Diff panel: hiding whitespace is held per open panel and carried to the next scope, where stock holds one choice for the browser session. The turn picker lists turns whose checkpoints the loaded history window holds, so older turns appear once their history pages load.
- Diff panel: picking Latest turn keeps following each newer turn as it lands, where stock pins the turn that was latest when picked.
- Diff panel: the Git scopes can't expand the unchanged lines between hunks, since stock's `loadDiffFiles` (`reviewEnvironment.diffFileContents`) and `compactPartialHunkOffsets` aren't ported.
- Terminal drawer: the emulator is xterm, so glyph rendering differs from stock's. Treflex's toolbar adds Find and Hide to stock's split, new and close buttons.

## Unmatched: settings and usage

Settings opens in place of the thread view, not as stock's modal, and keeps the thread in the address underneath it (`?settings=<page>`, `?usage`).

- Settings pages not built, shown greyed out in the nav: Diffs & pull requests, SnapShots, Browser, Devices, Scheduled tasks, Source control, Worktrees, Environments, Sharing & access, Secrets, Maintenance, Labs, and Open source licenses under About. The footer has no Pull requests button or page.
- Client settings (General, Chat and most of Appearance) are written to stock's `t3code:client-settings:v1` key in stock's shape, but `localStorage` is per port, so stock web on 5733 and this client never see each other's values, and stock desktop keeps its own file. This client acts only on the color scheme; every other client row says "Not used here yet". The timeline doesn't read tool-call visibility or the time format, and the composer doesn't read the send shortcut, follow-up behavior, rich text or skills-in-slash-menu.
- Client settings are read from this port's `localStorage` when a page opens, so a change made in another tab shows only after reopening it.
- Settings search covers the rows of built pages only, without stock's synonyms or result highlight. No "Applying settings for" project and environment scope (every write goes to the one environment, as stock's environment-wide path), no per-row reset or inheritance markers, and no Restore device defaults.
- Appearance: the color scheme only, no theme library, theme editor, contrast, glass opacity, thread details items, panel animations, environment identification, composer context or typography.
- General: no language select or desktop quit shortcut. Project grouping turns on as "repository" rather than stock's remembered last mode.
- Providers: enable and disable, hide (one or all), reorder, favorite and filter models only. Models keep the stored order rather than stock's favorites-first grouping. No adding or removing instances, display name or accent edits, setup, runtime or environment forms, custom models, provider refresh, usage-provider hubs, text generators, health check interval or idle compaction, and no project-scoped enable override. Favorites aren't migrated when the server's `favorites` is still null. Providers other than Claude and Codex show no icon.
- Projects: name, pin, archive and remove for a picked project. No icon picker, new-thread defaults, actions or checkout grouping.
- Threads: no default model, fallback model or text generation model pickers, and no snooze presets. The workspace select offers "Default" for the inherited value, where stock shows what it resolves to.
- Keybindings: read-only list with search; editing, recording, conflict warnings and Open keybindings.json aren't built.
- Archive: one environment, no right-click menu, and a failure goes to the sidebar's error line rather than a toast.
- About: the server's version, not the client build's, and no update, update track, mobile app or welcome rows.
- Usage: no environment or provider pickers (this client has one environment), model price overrides, model detail dialog, chart hover tooltip, speed premium note, ChatGPT shared usage, or in-page shortcuts (stock's `c`, `t`, `l` and the period keys). `mod+u` opens it, as in stock.
- Usage limit recovery: no limit-recovery banner (stock's `UsageLimitRecoveryBanner`, with Wake now for the snooze it sets). Stock hides the thread error banner while that banner shows (`timelineThreadError` in `apps/web/src/components/ChatView.tsx`); treflex shows the usage-limit error as a warning banner instead, until it has one.
- Usage limits: one section per provider instance, each window with its own headline, bar and reset, where stock pools a driver's accounts into one section with a weighted headline and a labelled bar segment (or legend row) per account. A hub account that carries an email is named by its hub alone, where stock shows a redacted email chip, so two such accounts on one hub look alike. No external usage links, segment popovers or reset credits (a hub account's among them). `server.refreshProviders` is a guarded RPC, so `settingsImpl.ts` supplies an allow-all `RpcPermissionGuard` past the `no-rpc-permission-bypass` lint rule (see "the command path assumes atoms"): a connection without the read scope learns from the server's refusal.

## Unmatched: voice input

Dictation transcribes on this client's own server with a local model, as stock's environment destination does. The destination is a per-device choice in `localStorage` (Off, or the server), not shared with stock on another port.

- No cloud destinations (OpenAI, Grok, OpenRouter): they bill the person's provider key, and their key setup isn't built here. Stock's keys stay on the server, so adding them is a client change only.
- No transcript cleanup, dictionary (personal or project), correction cue, language select, microphone order or test, hardware or unload settings, model compare, linking or removal. The project's name is still sent as a recognition hint.
- The shortcut toggles; stock's "hold to talk" mode isn't built. Escape cancels a recording.
- No dictating into a question's custom answer, the timeline's comment editors or the preview annotator.
- Tested in desktop Chromium with `getUserMedia` stubbed to play a recorded WAV through Web Audio, on the dev server and on the production build with its service worker in control, both streaming and buffered, and a send after dictation on Haiku. A real iPhone isn't tested. iOS needs the HTTPS (Tailscale) address, may ask for the microphone again in each home-screen app session, and ends the capture when the app goes to the background, which shows as "Mic disconnected" with Record again.

## Unmatched: menus

Base UI's press-and-drag selection isn't built: pressing a menu trigger, dragging onto an item and releasing doesn't choose it. Click the trigger, then the item.

## Open: reading `packages/` restarts the dev server on Windows

`vp run dev` runs the server under `node --watch` over `src`, `packages` and `package.json`. On this machine a recursive `fs.watch` reports `change` on a directory that is only listed, with nothing written, so any tool that lists a directory under those paths restarts the server and interrupts a running turn. A probe watching `packages/` while the app's gates ran saw one `change` for every package during `tsc --noEmit`, directly or through `vp run typecheck`, and the server's process id changed, sometimes twice. `vp test run`, `vp lint` and `vp fmt` raised no events. A separate directory showed the same event from a plain `ls`, and none from reading a file. Avoid typechecking during a turn. Daily use needs a server run without `--watch`.

## Open: 502s on the environment descriptor

The console showed `/.well-known/t3/environment` requests through the Vite proxy ending in 502 and `ERR_ABORTED` during `check:changed`, and again during step 6. Both fit a server restart from the entry above, but that hasn't been confirmed. The connection recovers.
