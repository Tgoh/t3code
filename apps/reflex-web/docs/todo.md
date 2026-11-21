# Todo

Work Tam has queued for later. Gaps against stock that nobody has asked for yet go in [issues.md](./issues.md) instead.

## Treflex follow-ups

The friction write-up is at `G:\Sorted\Code\t3code-dev-home\notes\treflex-friction-from-t3code-port.md`. The treflex side's verdicts are in the reflex repo's `docs/wip` (commit 2b37348).

- **Make the tree hold what `Wire<T>` says.** Typing the tree from `Encoded` doesn't work: on Effect 4.1.3 it's `unknown` or `Json` for the stream types. Instead, encode with `Schema.toCodecJson(Schema.toType(S))`. Dates still become strings, and everything else keeps its decoded shape, so `Wire<T>` becomes true. Do it at the encode sites: `shellStream.ts`, `threadItemCodec.ts`, `serverConfigStream.ts` and the `encode*` helpers in `settingsImpl.ts`. That removes the hand decode in `subagents.ts` `notificationSource` and the unknown-event special case in `threadItemCodec.ts`. Three more changes come with it:
  - Every decode of tree data has to use the same codec, at least `decodeMutation` and `decodePatch` in `settingsImpl.ts`. The full codec rejects a secret environment variable in the new shape.
  - Client settings in localStorage use reflex's format, not stock's, so read and write them with the same codec. Stock's localStorage is on another origin anyway. Run both codecs over the current saved value first. If they differ, fall back to the full codec when reading.
  - Decode the history page (`threadHistory.ts`) and the voice JSON (`dictation.ts`), and re-encode them with the same codec. Both are cast from raw JSON today, so history items keep the legacy notification source and skip the decode's cleanup.
- **Derive each request's turn item instead of indexing it.** Remove `OpenThread.RequestItemIds` and `indexRequestItem`. Have `requestItems` walk `Timeline` from the newest item, for pending requests only, until it finds the item whose `requestId` matches. That's how stock does it (`derivePendingThreadRequests` in `packages/client-runtime/src/state/threadRequests.ts`). The old 60 ms cost came from a selector that read every turn item. This one reads only the tail, and nothing when no request is pending. Before you delete the index:
  - Measure at 20,000 items with a pending request.
  - Check a request whose item is outside the loaded history window.
- **Record the verdicts.** Add treflex's verdicts to the "Feedback for treflex" section of `issues.md`.
- **Treflex 0.2.0.** Once it ships, re-vendor it. Read `docs/wip/done/release-0.2.0-breaking-changes.md` in the reflex repo first. `REPLICA_WRITERS` has to switch from `Name` to `Label`, and `testing/watchRuntime.ts` gives way to the strict test preset. Then move the minute clock to `provideExternal`/`external`. Past 0.2.0, rejections reach actions as copies with a native error type, so `instanceof ServerError` in `serverError()` stops matching and every server failure takes the bug route.

## Restructuring

From an audit of how the port uses treflex 0.1.0. Most of the code already follows the treflex docs. What doesn't is two entities that each do several jobs, and parent views that work out data and pass it down. The first four items fit in one thread.

- **Split `ThreadSession`.** It owns the composer, queue, rewind, fork, diff panel, terminal, git and more. Make the diff panel a child entity that is minted on open and replaced or removed on close. That drops the re-checks after each wait in `openDiff` and `openBranchDiff`, the manual resets in `closeDiff`, and the reliance on `latest` to cancel stale loads. Make the terminal a child entity with its state in plain fields instead of the `Terminal/Attachment` transient. `GitWork` already has this shape. See "move long work onto a child entity" in the reflex repo's `docs/patterns.md`.
- **Split `Environment`.** Give dictation its own entity under `Local` that owns the `Voice/Dictation` resource and receiver. Make the archived and usage settings pages component features (`createComponentFeature`) whose data lives only while the page is open. That removes `Replica.Archived`, `Replica.Usage`, four `REPLICA_WRITERS` entries, and the two different ways the loads are triggered (`openView` and `onMount`).
- **Checkout and panel selectors.** `ThreadView`'s `ThreadBody` builds the checkout in a memo that compares with JSON, passes it down as a prop and into `ThreadDetails` component state, and passes it to every `GitWork` action. Add one `checkout` selector on `ThreadSession` and let `GitWork` read the checkout itself. Panel availability is worked out in both `Environment.panelShortcuts` and `ThreadBody`'s menu and launcher, so make it one selector too. `terminalLaunch`, `searchRoot` and `Dictation.recordingOptions` resolve the working directory separately, and should use the same selector.
- **Thinner sidebar rows.** `Sidebar.tsx`'s `card()` passes `ThreadCard` 14 props, most of them worked out per row. Let the card read from its thread, as timeline rows do, and keep only cross-row values in the parent, such as `mixedProviders` and the search highlight.
- **Drop the duplicate keybindings stream.** `Server/Keybindings` (`Infrastructure/serverKeybindings.ts`) opens a second subscription for keybindings that `Server/Config` already writes to `Replica.Config.keybindings`. Delete the resource and have `App.tsx` read the config.
- **Git's default-branch confirmation as an `ask`.** Replace `PendingDefaultBranch`, `continueDefaultBranch`, `cancelDefaultBranch` and the `confirmed` flag with one `ask` inside `runGitAction`, as `Rewind/Confirm` already works. The git buttons would show busy while the dialog is open.
- **Smaller items.**
  - Share one receiver registration between `index.tsx` and `Model.test.ts`. The test copy already lacks `GitReceiver` and `VoiceModelsReceiver`.
  - Turn the remaining transients on Local entities into plain fields.
  - Make the non-archived projects list one selector; four views rebuild it now.
  - `Environment.currentProjectId` reads `Shell.Threads` but `ThreadSession.projectId` reads `OpenThreads`; pick one source.
  - Use work tags instead of the five `useInFlight([...])` action lists.
  - Move `runScript`'s open-the-terminal decision from the view into the action.
  - Give features hand-picked ids instead of `import.meta.url`.

## Parity

- **Secret and link requests can't be answered in reflex.** Port stock's `SecretRequestCard` and the link-request card. Until then, answer them in stock web on 5733. Also listed in `issues.md` under "Skipped for the prototype".
- **Settings reflex ignores.** Wire up whichever of the 19 settings still marked "Not used here yet" Tam picks. Send shortcut and Time format look easiest.

## Typing

- **Type-to-focus from buttons and links.** A key typed while a button or link has focus stays with it, as in stock (`shouldRedirectInputToComposer` in `src/composerFocusRedirect.ts`). That happens after clicking a sidebar thread or a header button. Tam wants any keypress to reach the composer. When focus is on a button or link, send printable keys to the composer, but keep Space and Enter activating the focused element. Keep the other exceptions: fields, open layers, keys with modifiers, and `aria-keyshortcuts`.

## Sidebar

- **Long thread titles are cut off.** Thread rows moved to a single line, so long titles are truncated. Let titles wrap again, probably clamped to two lines, without making short rows taller.
- **Settle only on the open thread.** Show a row's settle button only on the selected thread, so a thread can't be settled before it's been looked at. Check the other ways to settle, such as the thread menu, the command palette and the shortcut, and decide whether they follow the same rule.

## Phone composer

- **Enter on phone.** The keyboard's Enter should insert a newline, and only the send button should send. Decide whether this is a coarse-pointer default or a setting. Check what stock does on touch.
- **The send button is unreliable on phone.** A tap often just closes the keyboard instead of sending. The likely cause is the textarea blurring on pointerdown: the keyboard collapses, the layout shifts, and the click misses. Likely fix: `preventDefault` on the send button's pointerdown or mousedown so the composer keeps focus. Verify on a real iPhone home-screen app.

## Polish

- **Dialog animations.** The Add project dialog has no open or close animation. Go through reflex's dialogs, popovers and menus, and compare each with stock's transitions.

## Housekeeping

- **Server start time.** On a server restart, check whether the roughly 50 seconds between launch and the first log line comes back. See `G:\Sorted\Code\t3code-dev-home\dev-stack\server.log`.
- **Empty worktree folders.** Delete the leftovers under `G:\Sorted\Code\t3code-dev-home\worktrees\t3code`: `reflex-landscape-header-*`, `reflex-inline-media-*` and `reflex-idle-compaction--c2d629098b4fd778`.
- **Stale worktrees.** Clean up about 50 registered `reflex/*` worktrees whose branches are merged.
