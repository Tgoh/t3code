# Issues

Problems found while building the reflex client: gaps in treflex, mismatches with the t3code server, and anything that pushes towards a server change.

## Setup: `vp` does not select the pinned Node on this machine

The repo pins Node 26.12.1 and the server needs 24.10 or later, but `vp` stays in `system_first` mode and runs the system Node (24.4.1). `vp env exec --node 26.12.1` also ran 24.4.1. `vp env on` would fix it, but it changes the machine-wide mode, which other projects share.

Workaround: use Node 26.13.0 through nvm. The pin in `package.json` isn't enforced, and `vp i` and `vp run dev` work on it.

## Setup: `vp run check:changed` fails its unused-patches step

The step installs the workspace in a temp directory that holds the manifests and lockfile but not `apps/reflex-web/vendor/`, so treflex's tarballs aren't there. Its other checks still run. It runs when the lockfile, the workspace file, patches or any `package.json` change, so this comes back whenever dependencies do.

## Setup: `vp run check:changed` fails this app's tests

Its test step runs `apps/reflex-web`'s tests in the root vitest project, which lacks this app's `solid` and `browser` resolve conditions, so `solid-js` resolves to its server build and every `createTestRuntime` throws treflex's `SolidServerBuildError`. Run them with `vp test run` from `apps/reflex-web`. Fixing it means a change to upstream's root `vite.config.ts`.

## Setup: the app's tsconfig turns off two of the repo's strict flags

The app's `tsconfig.json` turns off `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`, because treflex's source once failed them. Treflex 0.1.0 ships declarations, which pass both. With them on, the app's own code has 16 errors in 12 files.

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
- Selectors that return fresh objects remount `<For>` rows and wake any parent selector, because a memo compares with `===`. An opt-in equality setting or structural sharing would cover both.
- `inFlight(action, owner)` has no per-argument form, so a per-argument mark has to be composed, and one action can't stop another's run on the same entity. The entities in the limit above follow from that.
- A transient costs a named helper and a selector for each view that reads it. Nothing here snapshots, so they buy no behaviour in this app.
- No entity hears its own failures, so `Root`, the parent of `Environment`, is the nearest error boundary for the Environment's own commands. A failure the boundary writes has no clearing rule of its own, so `Root` needed a dismiss action.
- There's no public way to react to derived state (`watch` is internal to treflex), so marking a thread visited when a completion is on screen is done at both write sites that can cause it, `selectThread` and the shell delivery, each checking `needsVisit` itself.
- Rows that belong to one ordered list with the parent's live rows can't be owned by the child. Moving loaded history pages onto the window entity split one sequence across two entities, so placement had to read and write both, and two ordering bugs followed. Lifetime fit the "results live and die with the window" case; order did not.
- A timer recurs, so every backoff tick starts with `stopTimer`. There's no one-shot timer.
- Keeping an entity for a while after its view leaves has no mechanism of its own. Retaining a left thread composes one: close its stream, start an expiry timer on it, and on the tick publish to the parent, because an entity can't remove itself inside its own delivery.
- The timeline's `<For>` iterates ids from the `timelineIds` selector, a plain `[...draft.Timeline]` copy. Each row-adding delta re-runs the copy, which reads every id through the view proxy: about 31 ms p50 at 20,000 rows. The history window keeps a cold open near 500 rows, so this doesn't show at real sizes. If it does, send treflex the size and the timing; they've said they'd make the whole-array copy cheaper inside treflex rather than add an API.
- A resource has one `r.status` detail string, and the terminal's connection phase already uses it, so the shell process's status goes through `emit` into a transient.
- `treflex-eslint`'s rules aren't on. `no-edit-after-write` and `no-hidden-open` need type information, which the repo's oxlint JS plugins don't provide. `no-yield-in-finally` and `no-global-open` don't, and 0.1.0 ships them built to JavaScript, but every rule imports `@typescript-eslint/utils`, which the repo doesn't install, and the lint config is upstream's root `vite.config.ts`. Treflex's `require-yield-star` check, including a missing `yield*` before `someGen`, `filterGen` or `mapGen`, is a Biome plugin, which oxlint can't load.
- "Do not create an entity only so that its removal closes a resource" sits against component state being a documented resource owner: `CommandOutput` mounts an empty `useComponentState` for nothing but owning its subscription.
- Persistence is whole-runtime only: a snapshot carries the whole tree, and nothing persists one slice, such as `Local`'s preferences, across a reload. Each kind of preference was persisted its own way until it converged on a read effect at creation plus a write effect per change (`Infrastructure/preferences.ts`, `draftMemory.ts`). A persisted slice, read before the first render and written per change, would replace those effects and the pre-paint read of the colour scheme in `index.tsx`.
- There's no clock in the model. The sidebar's snooze split reads `Local.Now`, which a minute timer writes through an app-side `clockNow` effect.

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
- Drafts live in this port's `localStorage`, not stock's draft store, so the two clients keep separate drafts. A file whose upload hadn't finished when the page closed is dropped, where stock keeps it as a row to attach again. Images are kept as data URLs, as stock keeps them, so a few large ones can fill the store, and the write is then dropped.
- A send during a run follows the Follow-up behavior setting, but not stock's override to steer while approvals are shown. A send during a compaction that can't take a steer isn't forced to queue, and Enter on an empty composer doesn't resume a held queue.
- The queue popover has no keyboard shortcuts for send now or edit, and an edit changes only the text, not attachments. Stock has no reorder either.
- The provider list and the hidden-model and model-order settings are read once at startup, not followed. The picker keeps a runtime-catalog driver's active model listed as Unavailable when the catalog drops it, but only for a provider that's ready. Model favorites are read at startup and after this client's own toggle, so one changed in stock shows after a reload.
- A sent message appears when the stream delivers it, with no pending row in Local; the gap wasn't noticeable.
- A new thread starts on the model and options last picked in this browser, else the project's default, else the first provider's default, which can be a paid one. The last pick and each model's options are kept in this port's `localStorage`, not stock's draft store, so the two clients remember picks separately.
- A new thread's permission mode defaults to Full access, not the project's `defaultRuntimeMode` setting.
- A new thread asks the server to generate its title, which uses the server's title provider. On this machine that's Codex, which fails to spawn, so titles fall back to the text.
- Assistant markdown is lexed whole on every delta, though only the changed block re-renders. A delta takes about 1 ms at 2 KB, 2.3 ms at 10 KB, 6 ms at 30 KB and 19 ms at 100 KB before layout, so only a very long message overruns a frame.
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
- Diffs render as a unified list with line numbers, not `@pierre/diffs`' diff view, with no syntax highlighting. Markdown code blocks use its highlighter.
- A diff panel holds one fetched string in Local and refetches on each open. It doesn't refresh when a later checkpoint lands.
- Restoring a checkpoint isn't offered.
- The benchmark uses a generated fixture: `~/.t3` doesn't exist here and the dev home holds only a few short threads.
- The benchmark calls the receiver directly, so it leaves out treflex's clone of each emitted message.

## Unmatched against the stock UI

- Visits: a visit that fails isn't retried after a reconnect, so Done can stay until the next completion.
- Questions: an answer can't carry attachments or thread chips, so the attach button hides while a question holds the composer. Text set aside when an option replaces it shows as a line in the card, not a toast, and undo doesn't take it back out of the draft. Question drafts don't survive a reload.
- Thread links: a link to a thread the shell doesn't hold shows its written label, or "Thread", and still opens, where stock asks the server for its title and shows "Thread no longer available" when it's gone. A thread on another machine is named but never opens, since this client connects to one environment. The chip has no hover card; `t3code://` deep links and prompt links aren't recognised, and a raw-HTML block's thread link keeps its written text rather than the thread's title.
- Messages from other threads and automations: the automation fold shows the prompt's first line, not its scheduled task's title, and has no Open automation link. Consecutive steers each show their Steer label, where stock shows it once, because a row doesn't know its neighbours. Guest messages show the guest's words without the guest name or styling.
- Project icons: a cloned project's icon isn't asked for again when its clone lands, as stock does, so it shows the monogram until the next request after the 30-minute refresh. An icon file changed in place shows on the next refresh, not straight away.
- Sidebar: no "Setting up" state for a thread launched from a draft before its first run lands, and no Regenerate title action.

- Sidebar: no pull requests button in the footer, because this client has no pull requests page.
- Sidebar: the active list uses stock's order key, but stock's inbox places a few threads differently (`ask me` here), and there's no working shelf.
- Sidebar: no archive (this client has no way back from it), custom snooze time, bulk settle, auto-settle toggle or search.
- Sidebar: every settled thread is streamed, where stock omits older ones and pages them in.
- Projects: Add project is stock's palette for its own views only. It clones only from a pasted URL, with no hosting-provider sources (GitHub and the rest, with their Setup Required state) or repository lookup, and a new project can't be published to GitHub from it. There's no environment chooser and no keyboard shortcut to open it. Folders group one per project, as stock's "separate" mode, with no repository grouping, and every open project has a folder, where stock shows an idle one only while pinned. No project archive.
- Projects: the folder menu has no Project settings page (icon, default model, workspace, actions, checkouts); rename is in the menu instead. Open in file manager is offered whatever the server's `availableEditors` says, and its failure shows in the sidebar's error line.
- Projects: removal counts only threads the shell holds, where stock adds the older settled threads it pages in, so the count can be low. It removes one project, with no grouped checkouts, and a failure stays in the dialog rather than a toast.
- Projects: the order is per browser and port, as stock's is per browser, and keyed by project id where stock keys by environment and path, so a removed and re-added folder goes to the end. The sort choice is a sidebar picker, not a setting, and defaults to Manual (stock: Last user message), whose unsaved order is the old one: pinned first, then by title. The time orders keep pinned projects on top, which stock's don't.
- Projects: dragging works with a mouse or pen in Manual only, with no keyboard or touch, as stock's old project drag had neither. Folders don't animate into place.
- Projects: a clone that fails or finishes while its project isn't open shows nothing until you open it; stock raises a toast.
- Sidebar: Limited and a waiting guest message's Request aren't distinct states, drafts have no card, and the thread list shows no scrollbar.
- Sidebar hover card: no environment, terminal process or pull request lines, and a long branch is cut at the end rather than the middle.
- Sidebar and composer: only Claude and OpenAI provider icons are copied; Replay, Cursor, Grok, OpenCode, Antigravity and Kiro show none, and instance badges aren't drawn.
- New thread: a pen button targets the current project, and a small native select beside it picks another, where stock has one button.
- Header: no title menu.
- Thread details: no environment or worktree pickers (the machine row only names it), no usage, context, servers, automations, side chats or linked pull request rows, no "Choose what to show" menu, and no compact or essential density for a short window. Only an open thread has the card; a new-thread draft doesn't. Its open state is per thread and resets on reload, where stock keeps it.
- Thread details, lineage: no side chats section, delegated-from row, workflow groups, stop-subagent button or disconnect menu, and the rows have a plain tip where stock has a subagent hover card and provider icons. A task delegated to a linked environment is listed but can't be opened from here.
- Thread details, git: no progress phases or hook output while an action runs (the row says Working…), no View PR for a branch with an open pull request, no Publish repository dialog or Initialize Git, and no live branch sync for drafts. The commit dialog lists files without opening them in the editor. Changes counts come from status alone, not the diff preview stock reads, and status refreshes when the menu opens, not when the window regains focus.
- Thread details, branches: the picker lists the first 100 refs with a server-side search, with no remote refs, pull request checkout, worktree moves or context menu; a branch checked out in another worktree is refused.
- Thread details, scripts: a script runs in the thread's one drawer terminal, where stock opens a new terminal. Scripts can be added but not edited or removed, and `t3.json` file scripts aren't imported. Scripts have no keyboard shortcuts, and `editor.openFavorite` isn't handled.
- Right panel: the launcher opens Terminal (as the drawer) and Diff; Browser, Files, Pull request, Linked pull requests, Device and Side chat are listed but disabled. No tabs or maximize; one surface shows at a time.
- Tooltips: a quick move between triggers opens instantly everywhere, where stock does that only inside the sidebar.
- Timeline: the fold and work groups leave out stock's superseded-attempt folds ("Superseded attempt"), the tool-call visibility setting (zen and hide-successful), hiding delegation rows that a subagent card replaces, compaction dividers and `/compact` turns, viewed-image strips, html-render and MCP app rows, the "Waiting on N subagents" label and the timestamp setting. Resumed subagents fold with the response they appear in, not their original turn. Stock's tool icons and shimmer aren't copied, and an expanded group grows to a fixed height rather than by its open entries.
- Timeline: an expanded work entry's body is this client's (`viewOf`), not stock's per-tool detail.
- Timeline: a subagent finishing is a plain "Subagent … finished" row with the question-mark icon, where stock shows a card with the provider icon, the title, a result line, "Finished <time>" and a chevron that opens the subagent.
- Timeline: "Background activity updated" falls back to the question-mark icon, where stock gives it a lightning icon.
- Timeline: no minimap, and the scroll-to-end pill doesn't summarise what's waiting below.
- Running turn (a deliberate divergence, see the README): a turn that did no work drops its fold when it settles, as stock's does, so its reply moves up a row then. A stopped or failed turn unfolds its work, as stock's does. The status line keeps its row above the composer while idle, and the queue is a popover rather than stock's control above the composer.
- Message actions: no reply or prompt link action. Fork shows only on a settled response's last reply, where stock offers it on every finished reply, including in a running turn. Edit from here doesn't wait for attachments still being read in (stock refuses while they prepare), restores a message's text without its thread and environment mention records, and doesn't check the environment's operate scope (see "the command path assumes atoms"). Stock's busy fork button pulses; this one only disables.
- Timeline: approvals show every option inline, with no More menu and no decline-by-typing placeholder.
- Attachments: images aren't resized or recompressed, so an image over 10 MB is refused and HEIC is refused rather than converted to JPEG. Uploads show no progress or retry button; a failed upload retries at send. Duplicate images aren't dropped, the 80 MB total for images is left to the server, and the text has no inline chips referring to attachments.
- Attachments: no preview pane. A file card opens the server's URL in a new tab, and the server serves Markdown and other types it won't show inline as a download. A file card looks the same with or without message text, where stock lists files as rows above the text.
- Attachments: a dropped or pasted folder is refused, as on stock web; stock desktop inserts its path.
- Timeline: an expanded image has no next, previous or zoom, and an attachment or markdown image URL isn't refreshed, so a thread left open past its expiry shows a name chip or "Image unavailable" after a reload of the image. A markdown image of a file the agent rewrites keeps showing the old bytes until the message remounts.
- Markdown images: no copy, download or open-file actions, and no "pair again" hint when the connection can't read host files. Video and audio embeds show their alt text. An `<img>` in raw HTML still loads only web and data sources, so a file path there shows nothing.
- Markdown: no run-in-terminal button, math or diagrams. A code block is highlighted once its fence closes, where stock highlights it line by line as it streams, and wrap defaults on rather than following a word-wrap setting.
- File link chips open in the editor on click, where stock opens the in-app file panel and keeps the editor for Ctrl-click. They have no context menu (copy path, reveal, open in browser), no media preview, no lookup of a bare file name across the workspace and other projects, no size in the tooltip and no app-bundle icon, and they're offered whatever the connection's remote-open mode. A failed open shows in the sidebar's error line. Dart, Java, Lua, PHP and R files use Pierre's generic icon, not stock's own.
- Changed files card: flat list, not a tree, and its rows don't open a single file's diff.
- Composer: no stash, multi-model send or keyboard shortcuts. The `@` menu lists files only, with no thread items (nor machines or models), shows a generic file or folder icon where stock shows per-type icons, and inserts a plain markdown link rather than a chip. The `/` menu has no built-in `/model`, `/side`, `/btw` or `/clear`, and skills show no source badge. Commands and skills come from the provider list read at startup, without a project's workspace snapshot, so project-only skills are missing. Prompt history moves at the first or last line of the text, not the wrapped visual line.
- Model menu: no number-key jumps, provider setup or update notices, unavailable-provider state, custom models from settings, instance badges or New badges, and a fixed height rather than stock's fit to the tallest tab. Providers other than Claude and Codex show a letter, not their icon. A favorite toggle doesn't migrate favorites a stock browser kept locally before the server held them. A non-reasoning option such as an agent's mode opens its choices below its row, not in a side menu.
- Model menu: a typed `ultrathink` doesn't take over the effort label or lock the levels, the effort shows as a word with no bars setting, and the provider's reported selection isn't shown.
- Permissions: no overflow menu at narrow widths, and modes a managed policy forbids aren't disabled. A new thread's strip under the composer holds only the permissions chip, with no workspace or branch pickers.
- Diff panel: no tabs, split view, wrap, turn picker, file icons or collapsed unchanged-line markers.
- Terminal drawer: fixed height with no resize, tabs or splits; the emulator is xterm, so glyph rendering differs from stock's.

## Unmatched: settings and usage

Settings opens in place of the thread view, not as stock's modal, and keeps the thread in the address underneath it (`?settings=<page>`, `?usage`).

- Settings pages not built, shown greyed out in the nav: Diffs & pull requests, SnapShots, Browser, Devices, Scheduled tasks, Source control, Worktrees, Environments, Sharing & access, Secrets, Maintenance, Labs, and Open source licenses under About. The footer has no Pull requests button or page.
- Client settings (General, Chat and most of Appearance) are written to stock's `t3code:client-settings:v1` key in stock's shape, but `localStorage` is per port, so stock web on 5733 and this client never see each other's values, and stock desktop keeps its own file. This client acts only on the color scheme; every other client row says "Not used here yet". The timeline doesn't read tool-call visibility or the time format, and the composer doesn't read the send shortcut, follow-up behavior, rich text or skills-in-slash-menu.
- Settings are read when a page opens and replaced by each write's reply. Stock follows the config stream, so a change made elsewhere while a page is open shows only after reopening it. The composer's provider list reloads after a provider or model write from this client, but not after one made in stock.
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
- Usage limits: no usage-limit hubs (the session's config stream isn't opened with `usageLimitSources`), external usage links, segment popovers or reset credits. `server.refreshProviders` is a guarded RPC, so `settingsImpl.ts` supplies an allow-all `RpcPermissionGuard` past the `no-rpc-permission-bypass` lint rule (see "the command path assumes atoms"): a connection without the read scope learns from the server's refusal.

## Unmatched: voice input

Dictation transcribes on this client's own server with a local model, as stock's environment destination does. The destination is a per-device choice in `localStorage` (Off, or the server), not shared with stock on another port.

- No cloud destinations (OpenAI, Grok, OpenRouter): they bill the person's provider key, and their key setup isn't built here. Stock's keys stay on the server, so adding them is a client change only.
- No transcript cleanup, dictionary (personal or project), correction cue, language select, microphone order or test, hardware or unload settings, model compare, linking or removal. The project's name is still sent as a recognition hint.
- The shortcut toggles; stock's "hold to talk" mode isn't built. Escape cancels a recording.
- No dictating into a question's custom answer, the timeline's comment editors or the preview annotator.
- Tested in desktop Chromium with `getUserMedia` stubbed to play a recorded WAV through Web Audio, on the dev server and on the production build with its service worker in control, both streaming and buffered. A real iPhone isn't tested. iOS needs the HTTPS (Tailscale) address, may ask for the microphone again in each home-screen app session, and ends the capture when the app goes to the background, which shows as "Mic disconnected" with Record again.

## Open: reading `packages/` restarts the dev server on Windows

`vp run dev` runs the server under `node --watch` over `src`, `packages` and `package.json`. On this machine a recursive `fs.watch` reports `change` on a directory that is only listed, with nothing written, so any tool that lists a directory under those paths restarts the server and interrupts a running turn. A probe watching `packages/` while the app's gates ran saw one `change` for every package during `tsc --noEmit`, directly or through `vp run typecheck`, and the server's process id changed, sometimes twice. `vp test run`, `vp lint` and `vp fmt` raised no events. A separate directory showed the same event from a plain `ls`, and none from reading a file. Avoid typechecking during a turn. Daily use needs a server run without `--watch`.

## Open: Stop flickers back before the run ends

After a Stop click, the composer's button reads "Stopping", then "Stop generation" for 10 to 20 ms, then the run ends. "Stopping" is the thread row's `latestRunStopRequested` or `stopRun` in flight, and the stop command's reply can land before the shell stream delivers the row with the flag set, so neither holds for that gap. Seen on the driver and on the `useInFlight` branch alike.

## Open: 502s on the environment descriptor

The console showed `/.well-known/t3/environment` requests through the Vite proxy ending in 502 and `ERR_ABORTED` during `check:changed`, and again during step 6. Both fit a server restart from the entry above, but that hasn't been confirmed. The connection recovers.
