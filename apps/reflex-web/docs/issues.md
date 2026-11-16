# Issues

Problems found while building the reflex client: gaps in treflex, mismatches with the t3code server, and anything that pushes towards a server change.

## Setup: `vp` does not select the pinned Node on this machine

The repo pins Node 26.12.1 and the server needs 24.10 or later, but `vp` stays in `system_first` mode and runs the system Node (24.4.1). `vp env exec --node 26.12.1` also ran 24.4.1. `vp env on` would fix it, but it changes the machine-wide mode, which other projects share.

Workaround: use Node 26.13.0 through nvm. The pin in `package.json` isn't enforced, and `vp i` and `vp run dev` work on it.

## Setup: pnpm installs `file:` treflex as a copy

Under `node_modules/.pnpm`, treflex is a real directory and not a link, so changes in the pin don't reach the app until `vp i` runs again. solidportal gets a link from npm. `link:` might behave like solidportal, but it hasn't been tried, and treflex's `solid-js` peer must still resolve to the app's copy.

## Setup: `vp run check:changed` fails its unused-patches step

The step installs the workspace in a temp directory, where the `.t3/treflex` junction doesn't exist. Its other checks still run. It runs when the lockfile, the workspace file, patches or any `package.json` change, so this comes back whenever dependencies do.

## Setup: the app's tsconfig turns off two of the repo's strict flags

Treflex ships as TypeScript source, so the app's typecheck covers it. Reflex failed `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`, so the app's `tsconfig.json` turns both off. Treflex at the pin passes both; with them on, only the app's `threadHistory.ts` fails, on the `signal` it passes to `fetch`.

## Gap: the connection runtime has one public door

`client-runtime` exports the session factory only as a type, so reusing the supervisor means building the whole `Connection` layer. That layer requires the relay client, DPoP signer, SSH gateway, cloud session and stores, none of which one cookie-authenticated environment uses. `Infrastructure/connection.ts` mocks them, and a mock dies if it's ever called. Adding a remote environment means replacing these mocks.

## Gap: the command path assumes atoms

`createEnvironmentRpcCommand` and its `permissionAtom` take an atom runtime, so they don't fit without one. Commands go through `client-runtime/operations` and `request`, run with `EnvironmentRegistry.run`. That skips the client's permission check, so a connection without the scope learns from the server's refusal. `startThreadTurn` also needs `SecureRandom` provided, even when given a command id.

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

## Cost: stream items queue in treflex, not the socket

`r.emit` resolves once a message is queued, not delivered, so the shell and thread streams read the socket with no backpressure from the receivers, and the cursor advances as each emit is queued. A receiver failure ends the stream with `receiver-failed` through `endOnReceiverFailure`.

## Mismatch: replaying terminal history after resizes can misdraw a line

The server's history is the raw PTY bytes, written at whatever width the shell had. After resizing between 47, 53 and 80 columns and then reattaching, one prompt line drew its typed text over the prompt, because ConPTY's cursor positions no longer matched the replayed screen. A shell at one width replayed cleanly. Stock replays the same history.

## Limit: busy marks are per action

Every busy mark is an `inFlight` read, which says whether an action runs on an entity and not which arguments it runs with, and only a repeat of the same `latest` action or the removal of its entity stops a running one. So where a mark has to be per row, or end with the data it's about, the row is an entity of its own:

- Each runtime request, so an answer marks only its own request's buttons. The answer waits inside `open(...)`, so a server update or snapshot folds into the request while nothing holds it, and `leading` still drops a second press during the wait. Its typed answers stay on the `ThreadSession`, keyed by request, because the replica's fold would delete them and an expired thread drops its data. They aren't cleared once sent, so a resolved request's answers stay there unseen until the session goes.
- The history window, which a snapshot with another cursor or has-more, or over a window holding a fetch error, replaces, ending its fetch and its mark. Its pages reach the thread through `History/Page`, and the thread drops a page from a window it no longer holds, which a page queued behind that snapshot would be. `OpenThread` is bound to `ThreadReceiver` only to hear those pages.

## Feedback for treflex

- `merge` is gone, and `reconcileRows` takes one array of keyed rows at a time, refuses an incoming row without a key, and is a generator an action has to `yield*`. Folding a wire payload with nested keyless arrays into a held node in place, from the synchronous apply code, needed an app-side helper (`reconcile` in `rows.ts`). `reconcileRows` doesn't accept records, and the replica keys its rows by id in records to keep a delta's lookups constant, so the runtime requests' entity-aware fold (`reconcileEntities`, `putEntity`) is app-side too.
- `reconcileRows` throws a `TypeError` without `update`, where the table in `docs/advanced/state-tree.md` says a missing `update` keeps a matched row's contents.
- Selectors that return fresh objects remount `<For>` rows and wake any parent selector, because a memo compares with `===`. An opt-in equality setting or structural sharing would cover both.
- `inFlight(action, owner)` has no per-argument form, so a per-argument mark has to be composed, and one action can't stop another's run on the same entity. The entities in the limit above follow from that.
- A transient costs a named helper and a selector for each view that reads it: here three transients (shell sync, thread sync, terminal status and focus) and three selectors. Nothing here snapshots, so they buy no behaviour in this app.
- No entity hears its own failures, so `Root`, the parent of `Environment`, is the nearest error boundary for the Environment's own commands. A failure the boundary writes has no clearing rule of its own, so `Root` needed a dismiss action.
- There's no public way to react to derived state (`watch` is internal to treflex), so marking a thread visited when a completion is on screen stays in `ThreadBody`'s view effect. The model could do it at its write sites instead, in `selectThread` and in the shell delivery through `publishToNearest`.
- Rows that belong to one ordered list with the parent's live rows can't be owned by the child. Moving loaded history pages onto the window entity split one sequence across two entities, so placement had to read and write both, and two ordering bugs followed. Lifetime fit the "results live and die with the window" case; order did not.
- A timer recurs, so every backoff tick starts with `stopTimer`. There's no one-shot timer.
- Keeping an entity for a while after its view leaves has no mechanism of its own. Retaining a left thread composes one: close its stream, start an expiry timer on it, and on the tick publish to the parent, because an entity can't remove itself inside its own delivery.
- The timeline's `<For>` iterates ids from the `timelineIds` selector, a plain `[...draft.Timeline]` copy. Each row-adding delta re-runs the copy, which reads every id through the view proxy: about 31 ms p50 at 20,000 rows. The history window keeps a cold open near 500 rows, so this doesn't show at real sizes. If it does, send treflex the size and the timing; they've said they'd make the whole-array copy cheaper inside treflex rather than add an API.
- A resource has one `r.status` detail string, and the terminal's connection phase already uses it, so the shell process's status goes through `emit` into a transient.
- `treflex-eslint`'s rules aren't on. `no-edit-after-write` and `no-hidden-open` need type information, which the repo's oxlint JS plugins don't provide. `no-yield-in-finally` and `no-global-open` don't, but oxlint loads a JS plugin with Node's own import, where the package's extensionless imports don't resolve, and every rule imports `@typescript-eslint/utils`, which the repo doesn't install.
- "Do not create an entity only so that its removal closes a resource" sits against component state being a documented resource owner: `CommandOutput` mounts an empty `useComponentState` for nothing but owning its subscription.

## Differences from the immutable reducer

- `Timeline` isn't pruned. A hidden row keeps its place and renders nothing, because `TimelineRow` applies the shared visibility rule itself, so a run status change wakes only that run's rows. A hidden row can therefore come back live: a superseded interrupt result reappears if its request arrives afterwards, where the reducer has already dropped the row and only a reload would restore it. The same goes for a partial window, where the reducer treats the next update to a row it hid as unloaded history.
- A message with raw block-level HTML renders whole through the sanitizer, because the HTML can span blocks, so its code blocks have no header or copy button.
- Records don't keep the wire's array order, so anything that needs order sorts by `ordinal`.
- `archivedThreads` isn't held: the server always sends it empty, and the archive is a separate query.
- `position` isn't held: it's the row's index.

## Skipped for the prototype

- Deferred work isn't opted into (`acceptDeferredWork`), and `deferredWork` isn't preserved across updates, so a fold never loads work on opening as stock's does.
- History pages load older rows only, with no `throughEntryId` jump.
- History responses are held unchecked, so a turn item type this client doesn't know reaches the tree.
- `encodeThreadItem`'s unknown-event pass-through has no test: the app has no `@effect/vitest`, and lint bars running effects by hand in tests.
- The timeline window follows its top row when that row moves, so a top row moved far down (`placeRow` on an ordinal change) would collapse the window to the tail until the sentinel grows it back. No known server path moves an old row.
- The address uses `replaceState`, so selecting threads adds no back-button history.
- Tool output isn't fetched: the wire omits it, the row says so, and `getTurnItem` would fill it in.
- A command row doesn't check the server's `commandOutputStreaming` capability, so an older server shows the subscription's error.
- Secret and link requests are shown but can only be answered in the stock client.
- Drafts and attached files don't survive a reload.
- The queue offers resume and cancel, with no edit, reorder or promote to steer.
- A send during a run uses the server's `auto` delivery, with no steer or queue choice.
- The composer doesn't offer interaction mode (Plan).
- The provider list and the hidden-model and model-order settings are read once at startup, not followed. Model favorites are read at startup and after this client's own toggle, so one changed in stock shows after a reload.
- A sent message appears when the stream delivers it, with no pending row in Local; the gap wasn't noticeable.
- A new thread starts on the model and options last picked in this browser, else the project's default, else the first provider's default, which can be a paid one. The last pick and each model's options are kept in this port's `localStorage`, not stock's draft store, so the two clients remember picks separately.
- A new thread's permission mode defaults to Full access, not the project's `defaultRuntimeMode` setting.
- A new thread asks the server to generate its title, which uses the server's title provider. On this machine that's Codex, which fails to spawn, so titles fall back to the text.
- Assistant markdown is lexed whole on every delta, though only the changed block re-renders. A delta takes about 1 ms at 2 KB, 2.3 ms at 10 KB, 6 ms at 30 KB and 19 ms at 100 KB before layout, so only a very long message overruns a frame.
- A multi-select question takes its options as comma-separated text, with no checkboxes.
- A thread that doesn't exist retries its subscription with backoff rather than reporting missing.
- One terminal per thread, `term-1`, with no tabs or splits.
- A new-thread draft has no terminal until its thread exists.
- An exited shell has no restart button: Hide and Terminal start a new one.
- A failed attach retries only on the next socket session or after Hide and Terminal.
- A failed End shell shows the error, with no fallback to typing `exit`.
- A second viewer's grid isn't followed: the server sizes the PTY to the smallest viewer, and this client still draws its own size.
- A thread that gains a worktree keeps its remembered launch until Hide and Terminal.
- A thread deleted elsewhere while closed keeps its remembered launch in `localStorage`, for the reason under `thread.removed`.
- The terminal has no links, search, clear button or font setting.
- The terminal doesn't pass `providerInstanceId`, as stock's default launch doesn't.
- Diffs render as a unified list with line numbers, not `@pierre/diffs`, whose non-React entry wasn't evaluated. There's no syntax highlighting.
- A diff panel holds one fetched string in Local and refetches on each open. It doesn't refresh when a later checkpoint lands.
- Restoring a checkpoint isn't offered.
- The benchmark uses a generated fixture: `~/.t3` doesn't exist here and the dev home holds only a few short threads.
- The benchmark calls the receiver directly, so it leaves out treflex's clone of each emitted message.

## Unmatched against the stock UI

- Visits: a visit that fails isn't retried after a reconnect, so Done can stay until the next completion.
- Questions: answers typed into a question that Stop cancels or that expires are lost; stock moves them into the composer. Option previews don't render, and an `initialAnswer` isn't filled in.
- Markdown: `vscode://`, `cursor://` and other editor links are dropped instead of opening the file.
- Thread links: a link to a thread the shell doesn't hold shows its written label, or "Thread", and still opens, where stock asks the server for its title and shows "Thread no longer available" when it's gone. A thread on another machine is named but never opens, since this client connects to one environment. The chip shows the sidebar's monogram badge where stock shows the project's favicon, and has no hover card; `t3code://` deep links and prompt links aren't recognised, and a raw-HTML block's thread link keeps its written text rather than the thread's title.
- Messages from other threads and automations: the automation fold shows the prompt's first line, not its scheduled task's title, and has no Open automation link. Consecutive steers each show their Steer label, where stock shows it once, because a row doesn't know its neighbours. Guest messages show the guest's words without the guest name or styling.
- Sidebar: no "Setting up" state for a thread launched from a draft before its first run lands, and no Regenerate title action.

- Sidebar: no Search box, thread filter, sidebar toggle, or settings, pull request and usage buttons, because this client has no behaviour for them, so the T3 mark sits where the toggle was.
- Sidebar: the active list uses stock's order key, but stock's inbox places a few threads differently (`ask me` here), and there's no working shelf.
- Sidebar: no archive (this client has no way back from it), custom snooze time, bulk settle, drag reorder, auto-settle toggle or search.
- Sidebar: every settled thread is streamed, where stock omits older ones and pages them in.
- Projects: Add project is stock's palette for its own views only. It clones only from a pasted URL, with no hosting-provider sources (GitHub and the rest, with their Setup Required state) or repository lookup, and a new project can't be published to GitHub from it. There's no environment chooser, no Open in file manager, and no keyboard shortcut to open it. Folders group one per project, as stock's "separate" mode, with no repository grouping, and every open project has a folder, where stock shows an idle one only while pinned. No project archive.
- Projects: the folder menu has no Project settings page (icon, default model, workspace, actions, checkouts); rename is in the menu instead. Open in file manager is offered whatever the server's `availableEditors` says, and its failure shows in the sidebar's error line.
- Projects: removal counts only threads the shell holds, where stock adds the older settled threads it pages in, so the count can be low. It removes one project, with no grouped checkouts, and a failure stays in the dialog rather than a toast.
- Projects: the order is per browser and port, as stock's is per browser, and keyed by project id where stock keys by environment and path, so a removed and re-added folder goes to the end. The sort choice is a sidebar picker, not a setting, and defaults to Manual (stock: Last user message), whose unsaved order is the old one: pinned first, then by title. The time orders keep pinned projects on top, which stock's don't.
- Projects: dragging works with a mouse or pen in Manual only, with no keyboard or touch, as stock's old project drag had neither. Folders don't animate into place.
- Projects: a clone that fails or finishes while its project isn't open shows nothing until you open it; stock raises a toast.
- Sidebar: Limited and a waiting guest message's Request aren't distinct states, drafts have no card, and the thread list shows no scrollbar.
- Sidebar hover card: no environment, terminal process or pull request lines, and a long branch is cut at the end rather than the middle.
- Sidebar and composer: only Claude and OpenAI provider icons are copied; Replay, Cursor, Grok, OpenCode, Antigravity and Kiro show none, and instance badges aren't drawn.
- New thread: a pen button targets the current project, and a small native select beside it picks another, where stock has one button.
- Header: no thread details toggle or title menu.
- Tooltips: no keyboard shortcut hints, because this client has no shortcuts, and a quick move between triggers opens instantly everywhere, where stock does that only inside the sidebar.
- Timeline: the fold and work groups leave out stock's superseded-attempt folds ("Superseded attempt"), the tool-call visibility setting (zen and hide-successful), hiding delegation rows that a subagent card replaces, compaction dividers and `/compact` turns, viewed-image strips, html-render and MCP app rows, the "Waiting on N subagents" label and the timestamp setting. Resumed subagents fold with the response they appear in, not their original turn. Stock's tool icons and shimmer aren't copied, and an expanded group grows to a fixed height rather than by its open entries.
- Timeline: an expanded work entry's body is this client's (`viewOf`), not stock's per-tool detail.
- Timeline: no minimap, and the scroll-to-end pill doesn't summarise what's waiting below.
- Message actions: no edit, fork, reply or prompt link action.
- Timeline: approvals show every option inline, with no More menu and no decline-by-typing placeholder.
- Attachments: images aren't resized or recompressed, so an image over 10 MB is refused and HEIC is refused rather than converted to JPEG. Uploads show no progress or retry button; a failed upload retries at send. Duplicate images aren't dropped, the 80 MB total for images is left to the server, and the text has no inline chips referring to attachments.
- Attachments: no preview pane. A file card opens the server's URL in a new tab, and the server serves Markdown and other types it won't show inline as a download. A file card looks the same with or without message text, where stock lists files as rows above the text.
- Attachments: a dropped or pasted folder is refused, as on stock web; stock desktop inserts its path.
- Timeline: an expanded image has no next, previous or zoom, images inside markdown don't expand, and an attachment URL isn't refreshed, so a thread left open past its expiry shows a name chip after a reload of the image.
- Markdown: no syntax highlighting, language icons, run-in-terminal button, file link chips, math or diagrams. A relative link is plain text with its path in a tooltip, not a link that opens the file. A code block's wrap choice resets when its message re-renders during streaming.
- Changed files card: flat list, not a tree, and its rows don't open a single file's diff.
- Composer: no `@ files`, `$ skills` or `/ commands` menus and no voice input, so the placeholder leaves out their hints. No prompt history, stash, multi-model send or keyboard shortcuts.
- Model menu: no number-key jumps, provider setup or update notices, unavailable-provider state, custom models from settings, instance badges or New badges, and a fixed height rather than stock's fit to the tallest tab. Providers other than Claude and Codex show a letter, not their icon. A favorite toggle doesn't migrate favorites a stock browser kept locally before the server held them. A non-reasoning option such as an agent's mode opens its choices below its row, not in a side menu.
- Model menu: a typed `ultrathink` doesn't take over the effort label or lock the levels, the effort shows as a word with no bars setting, and the provider's reported selection isn't shown.
- Permissions: no overflow menu at narrow widths, and modes a managed policy forbids aren't disabled. A new thread's strip under the composer holds only the permissions chip, with no workspace or branch pickers.
- Diff panel: no tabs, split view, wrap, turn picker, file icons or collapsed unchanged-line markers.
- Terminal drawer: fixed height with no resize, tabs or splits; the emulator is xterm, so glyph rendering differs from stock's.
- Layout: no narrow-width sidebar collapse; below 640px only the chat gutter shrinks.

## Open: reading `packages/` restarts the dev server on Windows

`vp run dev` runs the server under `node --watch` over `src`, `packages` and `package.json`. On this machine a recursive `fs.watch` reports `change` on a directory that is only listed, with nothing written, so any tool that lists a directory under those paths restarts the server and interrupts a running turn. A probe watching `packages/` while the app's gates ran saw one `change` for every package during `tsc --noEmit`, directly or through `vp run typecheck`, and the server's process id changed, sometimes twice. `vp test run`, `vp lint` and `vp fmt` raised no events. A separate directory showed the same event from a plain `ls`, and none from reading a file. Avoid typechecking during a turn. Daily use needs a server run without `--watch`.

## Open: 502s on the environment descriptor

The console showed `/.well-known/t3/environment` requests through the Vite proxy ending in 502 and `ERR_ABORTED` during `check:changed`, and again during step 6. Both fit a server restart from the entry above, but that hasn't been confirmed. The connection recovers.
