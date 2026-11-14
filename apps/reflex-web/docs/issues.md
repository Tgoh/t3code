# Issues

Problems found while building the reflex client: gaps in treflex, mismatches with the t3code server, and anything that pushes towards a server change.

## Setup: `vp` does not select the pinned Node on this machine

The repo pins Node 26.12.1 and the server needs 24.10 or later, but `vp` stays in `system_first` mode and runs the system Node (24.4.1). `vp env exec --node 26.12.1` also ran 24.4.1. `vp env on` would fix it, but it changes the machine-wide mode, which other projects share.

Workaround: use Node 26.13.0 through nvm. The pin in `package.json` isn't enforced, and `vp i` and `vp run dev` work on it.

## Setup: pnpm installs `file:` treflex as a copy

Under `node_modules/.pnpm`, treflex is a real directory and not a link, so changes in the pin don't reach the app until `vp i` runs again. solidportal gets a link from npm. `link:` might behave like solidportal, but it hasn't been tried, and treflex's `solid-js` peer must still resolve to the app's copy.

## Setup: `vp run check:changed` fails its unused-patches step

The step installs the workspace in a temp directory, where `../../../reflex-t3code-treflex/packages/core` doesn't exist. Its other checks still run. It runs when the lockfile, the workspace file, patches or any `package.json` change, so this comes back whenever dependencies do.

## Setup: the app's tsconfig turns off two of the repo's strict flags

Treflex ships as TypeScript source, so the app's typecheck covers it. Reflex failed `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`, so the app's `tsconfig.json` turns both off. Treflex at the pin passes both; with them on, only the app's `threadHistory.ts` fails, on the `signal` it passes to `fetch`.

## Gap: the connection runtime has one public door

`client-runtime` exports the session factory only as a type, so reusing the supervisor means building the whole `Connection` layer. That layer requires the relay client, DPoP signer, SSH gateway, cloud session and stores, none of which one cookie-authenticated environment uses. `Infrastructure/connection.ts` mocks them, and a mock dies if it's ever called. Adding a remote environment means replacing these mocks.

## Gap: the command path assumes atoms

`createEnvironmentRpcCommand` and its `permissionAtom` take an atom runtime, so they don't fit without one. Commands go through `client-runtime/operations` and `request`, run with `EnvironmentRegistry.run`. That skips the client's permission check, so a connection without the scope learns from the server's refusal. `startThreadTurn` also needs `SecureRandom` provided, even when given a command id.

## Limit: providers exercised

Replay and one provider are verified. A real Claude Haiku turn from this client completed with a file-change approval approved in the same tab, and a pasted image reached the provider, which answered correctly. `devReplay`'s ACP agent refuses image prompts, so an image turn there fails with "The provider could not start this turn". Codex and the other providers haven't been run from this client.

## Mismatch: the wire format is decoded and then re-encoded

The RPC client decodes each stream item into `DateTime`s and the app encodes it back to hold plain data in the tree. This is negligible per delta (about 0.03 ms each way) but about 80 ms on a 1,000-item snapshot. If that matters, the fix is a protocol client without the decode, which `client-runtime` doesn't offer.

## Mismatch: a cold open takes a full socket snapshot

The stock client loads the first snapshot over HTTP and falls back to the socket. This client always uses the socket. Reconnects resume from the cursor.

## Mismatch: `thread.removed` doesn't say why

The shell sends the same item for an archived and a deleted thread, and `thread.deleted` only reaches a thread's own stream. So a thread deleted elsewhere while closed keeps its `ThreadSession`.

## Cost: a reconnect snapshot reconciles every row

About 50 ms at 1,000 items and 1.1 s at 20,000. The bounded window keeps a socket snapshot near the low end, but it will be a visible pause if history pages have grown the thread and the socket reconnects past the replay limit.

## Cost: stream items queue in treflex, not the socket

`r.emit` resolves once a message is queued, not delivered, so the shell and thread streams read the socket with no backpressure from the receivers, and the cursor advances as each emit is queued. A receiver failure ends the stream with `receiver-failed` through `endOnReceiverFailure`.

## Mismatch: replaying terminal history after resizes can misdraw a line

The server's history is the raw PTY bytes, written at whatever width the shell had. After resizing between 47, 53 and 80 columns and then reattaching, one prompt line drew its typed text over the prompt, because ConPTY's cursor positions no longer matched the replayed screen. A shell at one width replayed cleanly. Stock replays the same history.

## Not done: three in-flight marks are still in the tree

`Sending`, `Stopping` and `Terminal.Ending` are `inFlight` reads of `leading` actions, so they show busy from when the action arrives, queued included. Records name those actions by their inner functions: `sendDraft`, `requestStop` and `endShell`. The other three would each need a redesign:

- `Answering` holds the id of the request being answered, which each request's buttons compare against, and `inFlight` can't say which request.
- `Diff.Loading` is cleared by `closeDiff` and by a diff with no turn, before the fetch it marks has ended.
- `History.Loading` is cleared by a reconnect snapshot, which replaces the window the page was fetched for, while that fetch is still waiting.

## Feedback for treflex

- `merge` is gone, and `reconcileRows` takes one array of keyed rows at a time, refuses an incoming row without a key, and is a generator an action has to `yield*`. Folding a wire payload with nested keyless arrays into a held node in place, from the synchronous apply code, needed an app-side helper (`reconcile` in `rows.ts`).
- Selectors that return fresh objects remount `<For>` rows and wake any parent selector, because a memo compares with `===`. The docs don't warn about it. An opt-in equality setting or structural sharing would cover both.
- `<For>` over a store array pays for two proxy walks per list change, about 13 ms of a 15 ms add at 20,000 rows against 1.4 ms with a plain array. An id list through `<For>` is the pattern treflex recommends, so `treflex-solid` could offer a helper that tracks the array and hands `<For>` a plain copy.
- `expose` and `status` have no obvious home for a live handle plus a changing display value, which is why terminal status goes through `emit` into state.
- `treflex-eslint`'s recommended rules need type information, which the repo's oxlint JS plugins don't provide, so they aren't on.
- "Do not create an entity only so that its removal closes a resource" conflicts with `(entity, key)` identity for view-owned resources like `CommandOutput`.

## Differences from the immutable reducer

- `Timeline` isn't pruned. A hidden row keeps its place and renders nothing, because `TimelineRow` applies the shared visibility rule itself, so a run status change wakes only that run's rows. A hidden row can therefore come back live: a superseded interrupt result reappears if its request arrives afterwards, where the reducer has already dropped the row and only a reload would restore it. The same goes for a partial window, where the reducer treats the next update to a row it hid as unloaded history.
- A message with raw block-level HTML renders whole through the sanitizer, because the HTML can span blocks, so its code blocks have no header or copy button.
- Records don't keep the wire's array order, so anything that needs order sorts by `ordinal`.
- `archivedThreads` isn't held: the server always sends it empty, and the archive is a separate query.
- `position` isn't held: it's the row's index.

## Skipped for the prototype

- Deferred work isn't opted into (`acceptDeferredWork`), and `deferredWork` isn't preserved across updates, until the timeline can expand a group.
- History pages load older rows only, with no `throughEntryId` jump.
- History responses are held unchecked, so a turn item type this client doesn't know reaches the tree.
- `encodeThreadItem`'s unknown-event pass-through has no test: the app has no `@effect/vitest`, and lint bars running effects by hand in tests.
- Timelines aren't virtualised: every row in the window is in the DOM, up to about 500 rows on a cold open and more after "load earlier". Rendering cost at that size isn't measured.
- The address uses `replaceState`, so selecting threads adds no back-button history.
- Tool output isn't fetched: the wire omits it, the row says so, and `getTurnItem` would fill it in.
- A command row doesn't check the server's `commandOutputStreaming` capability, so an older server shows the subscription's error.
- A command row's expanded state is DOM-only, so it collapses when the thread is reselected.
- Secret and link requests are shown but can only be answered in the stock client.
- Drafts and picked images don't survive a reload.
- Attachments are images only, and the composer lists them by name with no thumbnail.
- The queue offers resume and cancel, with no edit, reorder or promote to steer.
- A send during a run uses the server's `auto` delivery, with no steer or queue choice.
- The permissions picker is on a new thread only, offering Full access and Supervised, and interaction mode isn't offered.
- The provider list is read once at startup, not followed.
- A sent message appears when the stream delivers it, with no pending row in Local; the gap wasn't noticeable.
- The default model for a new thread is the first provider's default, as in the stock client, which can be a paid one.
- A new thread asks the server to generate its title, which uses the server's title provider. On this machine that's Codex, which fails to spawn, so titles fall back to the text.
- Timeline rows aren't grouped into work groups as in the stock UI.
- Assistant markdown is lexed whole on every delta, though only the changed block re-renders. A delta takes about 1 ms at 2 KB, 2.3 ms at 10 KB, 6 ms at 30 KB and 19 ms at 100 KB before layout, so only a very long message overruns a frame.
- A multi-select question takes its options as comma-separated text, with no checkboxes.
- A thread that doesn't exist retries its subscription with backoff rather than reporting missing.
- A closed thread drops its data, so reopening takes a new snapshot; there's no retention or local cache.
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

- Sidebar: no Search box, thread filter, sidebar toggle, or settings, pull request and usage buttons, because this client has no behaviour for them, so the T3 mark sits where the toggle was.
- Sidebar: the active list uses stock's order key, but stock's inbox places a few threads differently (`ask me` here), and there's no working shelf.
- Sidebar: no archive (this client has no way back from it), custom snooze time, bulk settle, drag reorder, auto-settle toggle or search.
- Sidebar: every settled thread is streamed, where stock omits older ones and pages them in.
- Projects: Add project takes a typed folder path, with no folder browser, clone or new-folder option. Folders group one per project, as stock's "separate" mode, with no repository grouping, and every open project has a folder, where stock shows an idle one only while pinned. No project archive, delete, settings or reorder.
- Sidebar: Waiting and Limited aren't distinct states, drafts have no card, and the thread list shows no scrollbar.
- Sidebar hover card: no environment, terminal process or pull request lines, and a long branch is cut at the end rather than the middle.
- Sidebar and composer: only Claude and OpenAI provider icons are copied; Replay, Cursor, Grok, OpenCode, Antigravity and Kiro show none, and instance badges aren't drawn.
- New thread: a pen button targets the current project, and a small native select beside it picks another, where stock has one button.
- Header: no thread details toggle or title menu.
- Tooltips: no keyboard shortcut hints, because this client has no shortcuts, and a quick move between triggers opens instantly everywhere, where stock does that only inside the sidebar.
- Timeline: no "Worked for" fold or work-group summary, so tool rows always show; their wording is this client's (`Command: …`), not stock's (`Ran command`).
- Timeline: no minimap, and the scroll-to-end pill doesn't summarise what's waiting below.
- Message actions: copy and time show on every finished assistant message, where stock shows them only on the last of a response. Where a changed files card follows, they sit above the card, not below it, so that gap is 30px against stock's 16px. There's no edit, fork or prompt link action.
- Timeline: approvals show every option inline, with no More menu and no decline-by-typing placeholder.
- Timeline: an expanded image has no next, previous or zoom, images inside markdown don't expand, and an attachment URL isn't refreshed, so a thread left open past its expiry shows a name chip after a reload of the image.
- Markdown: no syntax highlighting, language icons, run-in-terminal button, file link chips, math or diagrams. A relative link is plain text with its path in a tooltip, not a link that opens the file. A code block's wrap choice resets when its message re-renders during streaming.
- Changed files card: flat list, not a tree, and its rows don't open a single file's diff.
- Composer: native select popups, not stock's model and permission menus, and no effort label; the composer is a solid block below the timeline, not glass floating over it.
- Composer: the permission label is read-only on an existing thread, and the placeholder leaves out `@ files, $ skills, / commands`, which this client doesn't have.
- Diff panel: no tabs, split view, wrap, turn picker, file icons or collapsed unchanged-line markers.
- Terminal drawer: fixed height with no resize, tabs or splits; the emulator is xterm, so glyph rendering differs from stock's.
- Layout: no narrow-width sidebar collapse; below 640px only the chat gutter shrinks.

## Open: reading `packages/` restarts the dev server on Windows

`vp run dev` runs the server under `node --watch` over `src`, `packages` and `package.json`. On this machine a recursive `fs.watch` reports `change` on a directory that is only listed, with nothing written, so any tool that lists a directory under those paths restarts the server and interrupts a running turn. A probe watching `packages/` while the app's gates ran saw one `change` for every package during `tsc --noEmit`, directly or through `vp run typecheck`, and the server's process id changed, sometimes twice. `vp test run`, `vp lint` and `vp fmt` raised no events. A separate directory showed the same event from a plain `ls`, and none from reading a file. Avoid typechecking during a turn. Daily use needs a server run without `--watch`.

## Open: 502s on the environment descriptor

The console showed `/.well-known/t3/environment` requests through the Vite proxy ending in 502 and `ERR_ABORTED` during `check:changed`, and again during step 6. Both fit a server restart from the entry above, but that hasn't been confirmed. The connection recovers.
