# Treflex client

A t3code web client built on treflex (the framework in [the reflex repo](file:///G:/Sorted/Code/reflex)) and Solid, against the stock t3code server. It's Tam's daily driver, and a test of treflex on an app it wasn't designed around.

Log gaps and problems in [docs/issues.md](./docs/issues.md).

## Decisions

| Decision           | Choice                                                                                                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Repo               | Private `Tgoh/t3code`, not a public fork, because treflex is unpublished                                                                                                                         |
| Branches           | `main` only tracks upstream. `treflex-main` is the working copy the daily driver runs from; changes go on worktree branches and merge back once they pass the gates, and a bad merge is reverted |
| Location           | `apps/treflex-web`. Avoid editing upstream's files so merges stay easy                                                                                                                           |
| Renderer           | Solid, through `treflex-solid`                                                                                                                                                                   |
| Reused             | `packages/contracts`, `packages/shared`, and `client-runtime`'s `connection/` and `rpc/`                                                                                                         |
| Replaced           | `client-runtime/src/state`, the Zustand stores, and the web components                                                                                                                           |
| Server             | No server changes. If something seems to need one, log it in `issues.md` first                                                                                                                   |
| State              | Hold the wire format in the tree, with no decoded `DateTime`, to meet treflex's plain-data rule                                                                                                  |
| Reducer            | Written as treflex actions that mutate the tree, not a port of the immutable reducer                                                                                                             |
| Tests              | Headless, with a scripted server at the effect boundary                                                                                                                                          |
| Terminal emulator  | `@xterm/xterm` with its fit and search addons, loaded on first open. Stock's libghostty WASM surface isn't reusable from a non-React app without its build and surface code                      |
| Project order      | `localStorage`, like stock's `projectOrder` in `uiStateStore` and its `sidebarProjectSortOrder` client setting. Neither is on the server, so neither is shared with stock or other devices       |
| Treflex dependency | `treflex` and `treflex-solid` 0.3.0 from npm, pinned to the exact version. `treflex-eslint` is a tarball in `vendor/`, installed with `file:`, since builds between releases aren't published    |

The server holds all the work, and the client receives its data and uses treflex for client state.

## Architecture

Read [overview.md](../../docs/internals/overview.md), [connection-runtime.md](../../docs/internals/connection-runtime.md) and [performance-regressions.md](../../docs/internals/performance-regressions.md) first.

- **Server:** `Orchestrator.ts` decides events, `EventSink` commits events, projections and the outbox in one SQLite transaction, and `EffectWorker` runs side effects afterwards. It has to work with no client connected.
- **Transport:** `WireProjection`, `ShellStream`, `ThreadStream` and `ThreadLiveEventCoalescer` shape what each subscriber receives. This is the client's input contract.
- **Stock client:** `client-runtime/src/state/threads.ts` and `shell.ts` hold snapshots, cursors and caches. `orchestrationV2Projection.ts` is the immutable reducer this client replaces.

An approval is a server row (`OrchestrationV2RuntimeRequest`) that the client displays and answers with a command. Don't model it as a parked `ask`: that wouldn't survive a reload, and another device can answer it.

## State model

If the server can rebuild it, it's replica. If only this client knows it, it's local.

```text
Root
└─ Environment
   ├─ Replica            (server's data, read-only here)
   │  ├─ Shell: projects, thread rows
   │  └─ OpenThreads: runs, messages, turn items, requests (selected and recently left)
   └─ Local              (only this client knows it)
      ├─ ThreadSessions: draft, attachments, panels; diff panel, terminal, git work, git status
      ├─ Dictation: the microphone and the server's voice models
      ├─ UsagePage, ArchivePage: the open page's reads
      └─ Preferences, sidebar shelves, system scheme
```

The minute clock isn't in the tree: it's the `Minute` outside value (`Infrastructure/clock.ts`), which views and selectors read with `minute`, since no work starts from it. An action that needs the time reads the `clockNow` effect.

- **Only what arrives from the server writes to the replica:** the stream receivers (the server config among them, which also derives the composer's provider list and favorites), history pages, an open thread's lookup of its lineage titles, settings writes' replies, plus opening and closing a thread. Commands change it only through what the stream delivers next. A thread's own commands are `ThreadSession` actions, so their draft can't reach the replica. An answer runs on its runtime request's entity, but writes only a transient error, which sits in the `TransientState` root rather than the replica. `REPLICA_WRITERS` in `testing/threadFixture.ts` lists the writers, and any `Model.test.ts` test fails when another action writes the replica. The Archive and Usage pages' reads are Local, not replica: they are one-off reads no stream keeps current, so they live only while their page is open. `showView` makes the page's entity (`Local.ArchivePage`, `Local.UsagePage`) and starts its read as the page opens, and removes it as the page closes, which ends a read in flight. A new usage period reads that window, a switch to limits re-probes them, an unarchive or delete reads the archive again once it's taken, and a restore's repair (`repairRestore` in `Root.ts`) reads the open page again, since the restore drops a read in flight.
- **Data about running work isn't state.** Busy marks are `inFlight` reads, which views make with `useInFlight` and only a selector combining busy with other state, such as `diffLoading`, makes itself. Stream sync is a transient, and so is a send held for images still preparing (`Composer/HeldSend`), since the preparation it waits on doesn't survive a restore either. A stream's end is read from its resource status.
- **A failure with its own place on screen is caught where it happens,** as a send's or an answer's is. Such a `catch` takes only a `ServerError`, through `serverError(error)` in `Infrastructure/serverError.ts`, which rethrows a refusal or a bug. The effect implementations make every server or network failure one: `settle` for an Effect run (a typed failure is the server's, and so is an interrupt, since one the action asked for never reaches it; a defect is a bug), `serverFetch` for `fetch`. A `ServerError` is a plain `Error` named `ServerError`, made with `serverFailure`, never a subclass: treflex hands an action a copy of what an effect rejects with, which keeps the name but not an app class, and a development build or a test reports `effect/class-rejection` for a class. Anything else below `Root` throws to `Root`'s `Action/Error` boundary, which shows it as an error toast. `Root`'s own `load` failing reaches the empty `onError`. Every caught throw, taken or not, is logged from the runtime's `failure` event in `index.tsx`. A view's throw is never an action's. Markdown, command output, search highlights and tool values each sit in a `Caught` boundary (`ui/Caught.tsx`), which shows their text plain, as stock's `RenderErrorBoundary` does. Any other view's throw reaches the root `<Errored>` in `index.tsx`, which shows `ViewCrash`. Either shows its content again once the throwing computation reruns cleanly. `render`'s `onError` in `index.tsx` raises every caught throw uncaught once, so the console shows it. An effect outside a boundary that reads a value thrown inside it logs the throw a second time; one owned inside the boundary doesn't.
- **Toasts aren't state.** A restore wouldn't bring one back, so the queue lives outside the tree, in `ui/toastStore.ts`, and the views render it. An action raises one with the `toast` effect (`Infrastructure/toasts.ts`), which tests read like any other effect; a view's own event, such as a paste or a copy, adds one to `toastManager` directly. A toast whose buttons start work, such as a clone's Retry, is made by a view (`ProjectClone.tsx` `CloneToasts`), and its buttons dispatch like any other control.
- **Entities stop at the open thread, except its runtime requests, its secret and link cards (`ItemRequests`, by turn item id, since the server keeps no request row for them) and its history window,** whose busy marks have to be their own (see `issues.md`). `reconcileEntities` and `putEntity` in `rows.ts` mint new requests and fold held ones in place.
- **A typed secret or pairing code never enters state.** The secret stays in its input and the code in the dialog's component state until the answer action takes it as an argument. The answer actions are marked `redactArgs` and their effects `redact: true`, so neither the arguments nor the payload is recorded, and the effects' failures keep only the server's own message, never the cause, which can echo the request. Runs, messages, turn items and shell rows are plain wire data, held by `id` in records and folded in place with `reconcile` in `rows.ts`. The timeline holds item ids, and each row joins itself with `timelineItem` and decides its own visibility, so a delta costs the same at any thread length. Grouping is laid out per response (a prompt to the next), from per-row facts that stay equal through text deltas, so a delta re-lays only its own response. A parent selector over the rows also leaves deltas alone if it returns stable references, because `<For>` remounts on new objects, but it walks the list on every added row, which only shows on very long threads.
- **A left thread stays in `OpenThreads` for five minutes,** as stock keeps it. Leaving closes its stream and starts its `Thread/Expire` timer, and returning stops the timer and reopens the stream from `LastSequence`, so the server sends only what was missed, or a snapshot past its replay limit. The tick publishes `Thread/Expired`, and `Environment` removes the thread unless it's selected again or shown beside the selected one. A side thread (`Panels.Side` on its host's session) is opened and left with its host, and hiding it retains it the same way. Being in `OpenThreads` doesn't mean being on screen, so `restoreTerminal` reads the selection through the `Selection` data source.
- **Drafts are Local and kept in `localStorage`,** per thread id, as stock keeps them: `ThreadSession` writes the text and picks on each change and the attachments after each add or remove, and `Environment.sessionOf` fills a new session from them. A new-thread draft keeps its project, so returning to that project's new thread restores it under the same id.
- **This device's choices are Local too,** in `Local.Preferences`: the sidebar's grouping, manual order, hidden projects, project filter, closed folders, collapse and width, whether the details card is pinned, the appearance mode, the usage page's metric and window, and the providers whose compaction offer was answered "Don't ask again". `newEnvironment` reads them through `storedPreferences`, and each change writes its fields through `storePreferences`, under the `localStorage` keys and shapes they always had, which stock shares for the theme, usage page and sidebar width. The thread order the sidebar shows and the next and previous shortcuts follow is the `sidebarLayout` selector.
- **Local state doesn't sit under replica threads.** Treflex treats removal as disposal, and a thread can be trimmed from the shell while it still exists. A draft also exists before its server thread does.
- **Deleting a thread is two linked steps.** The delete's reply forgets the `ThreadSession`, its stored draft and the selection. The streams remove the replica's rows: the shell's `thread.removed`, and an open thread's `thread.deleted`, whose receiver also forgets the session when another client deleted it.
- **A session joins the replica through the `Replica` data source,** which `Environment` registers, in selectors. An action reads those selectors with `select`, because a direct `getData` in an action copies the whole replica.
- **Dictation is one microphone for the client,** owned by the `Dictation` entity's `Voice/Dictation` resource, which runs stock's `VoiceInputController` from `client-runtime`. A recording is running work, so its phase, the thread it records into and a send waiting for its transcript are the entity's `Voice/Recording` transient, and a restore starts with none, since it can't reopen a live microphone. The entity is the environment's, not a thread's, so a recording keeps going while another thread is selected, and its transcript goes to the environment, which puts it in its own thread's draft. The level and live text stay in the resource's exposed value, outside state. The entity also holds the server's voice model list, which Voice settings shows and a start checks for a model in use, so a download's progress outlives the page.
- **Terminal and command output never enter state.** The drawer (`ITerminal`) holds the tabs, splits and height, and each shell is an entity of its own (`ITerminalShell`), whose `terminalSession` resource owns the emulator and its socket traffic and emits only lifecycle status. A shell's find bar is component state. `commandOutput` exposes its text, on an entity `toggleRowExpanded` mints for the row, and lives while the row is expanded and its thread shown. A tool row whose output the wire leaves out fetches its whole item when expanded, into the session's `ToolDetails`, which a collapse drops. Hiding the drawer or selecting another thread detaches every shell, and `localStorage` remembers each thread's drawer (its layout, height, whether it's open and where each shell started), so a return or a reload puts it back and reattaches.
- **Applying one delta stays under a frame (16 ms) and doesn't grow with thread length.** `vp run bench` measures it.

### Mismatches with the server

1. **A missing row doesn't mean a thread is gone.** The shell leaves out idle subagents and older settled threads, so absence can't drive disposal or deletion.
2. **Whole-row replacement.** `*.updated` events replace whole rows, and reconnects can deliver snapshots. Assigning a payload over a held node replaces the node, so views over it remount, and treflex has no `merge`. These go through `reconcile` in `rows.ts`, which keeps the nodes of rows the payload still carries.
3. **One item in several places.** Items appear in `turnItems` and `visibleTurnItems[].item`, and inherited rows come from other threads. An entity has one parent, so use id references and selector joins.
4. **Events apply as in-place actions.** Assigning a new projection walks the whole thread on every event.
5. **An action holds its entity.** Other work on that entity queues behind it, so every network wait in an action on a session, environment, open thread or runtime request is wrapped in `open(...)`. Other work runs during the wait, so what follows re-checks its premises and re-finds nodes on the draft.
6. **Turn items are a discriminated union on `type`.**

## Reference code

- **Treflex concepts:** in the reflex repo (`G:\Sorted\Code\reflex`), `docs\guide` in order, then `docs\patterns.md`, and `docs\reference` for the rules. Its `docs\upgrading.md` lists what changes between releases.
- **Conventions at scale:** `G:\Sorted\Code\solidportal\docs\exemplars.md` and `Concepts.md`.

## Logic copied from stock

Code imported from `@t3tools/*` follows upstream through the typecheck. The parts rewritten by hand from stock are rows in [docs/stock-logic.md](./docs/stock-logic.md), each beside its stock source, so an upstream change to that source changes nothing here until it's ported. The table is long: grep it for the file or the stock source you need rather than reading it whole.

Add a row whenever stock logic is copied rather than imported. A `Follows …` comment in `src` that names a source missing from the table is a missing row.

Rows follow stock's behaviour, and an upstream sync ports behaviour changes to them. These rows are ours now: their presentation has diverged on purpose, so a sync leaves stock's changes to them alone and only lists any new feature they carry:

- `timelineLayout.ts`, `TimelineResponse.tsx` folds and grouping (the `entryFacts` row still follows)
- `TurnStatus.tsx` working timer, current activity label
- `markdownImage.ts` `imageSizeStyle`, `Markdown.tsx` `ShownImage`, standalone images
- `Markdown.tsx` `ShownVideo`, `ShownAudio`, `MediaViewer`, `ImageDialog.tsx` `MediaDialog`
- `TimelineRows.tsx` `QueuedMessage` and `AttachmentFile`
- `addProjectPalette.ts`, `AddProject.tsx` key handling
- `Composer.tsx` paste handling, `FileDropSection`, attachment strip
- `ComposerMenus.tsx`
- `viewport.ts`, both rows: the sidebar sheet and collapse, the collapsed composer and focus keeping
- `Infrastructure/draftMemory.ts`, `composerFiles.ts` `stored`, `restoreOne`
- `codeHighlight.ts`, `codeHighlighter.ts`, `Markdown.tsx` `CodeToken`, `CodeTitle`
- `fileIcons.ts`, `editorIcons.tsx`, `sourceControlIcon.tsx`
- `ThreadDetailsPanel.tsx`, `threadDetailsLayout.ts`, `surfaces.ts`, `SurfaceLauncher.tsx`
- `settingsPages.ts`, `SettingsView.tsx` layout, nav, search box, `ColorSchemeSection` and `ProjectsPage`
- `usageChart.ts`, `UsageView.tsx`, `SidebarFooter.tsx`
- `DictationControls.tsx`, `VoiceSettings.tsx`

The terminal's find bar (Ctrl+Shift+F, or Cmd+F on a Mac) and an exited shell's Restart button are treflex's own: stock has no terminal search, and closes a shell's tab when the shell exits. On a screen narrower than 980px the drawer stays treflex's bottom sheet, with no resize handle. A sync doesn't port those back.

The details card's pinned state is one choice per device, where stock keeps it per thread (`threadPanelVisibilityByThreadKey` in `apps/web/src/rightPanelStore.ts`). A sync doesn't port that back.

A row moves to this list when its presentation is deliberately changed. Logic a row shares with the server (a status rule, an answer shape, a delivery choice) keeps following even when its view diverges, so split such a row rather than list it.

A running turn deliberately doesn't follow stock, so the text on screen stays still while the agent works. Its response folds under "Working for …" from the start, as it will once settled, and shows only its latest reply; each steer's segment also keeps its last reply, which stock folds. What the agent is doing and the queued messages sit in `TurnStatus`, one fixed-height line above the composer that keeps its space when empty, in place of stock's live, working and thinking rows and its Queued banner. Once the running turn has a to-do list, that line becomes the list, which stock doesn't show outside the timeline: at most six rows, so it grows only when the list appears, changes length or goes, never when a step changes status. A sync doesn't port those back.

## Components copied from stock

These mirror `apps/web/src/components/ui`, with stock's variants, sizes and class strings; an upstream sync ports their class changes. Some sizes and variants are stock `className` overrides made into names: Button's `icon-titlebar` is `SidebarTrigger`'s own, `media-navigation-inline` is the one `SidebarChrome` passes to `SidebarTrigger`, and the sidebar button's `icon-sm` is `SidebarHeaderIconButton`'s. `SidebarMenu`'s `row` layout is the `flex-row items-center` `SidebarUtilityMenu` passes, and the sidebar button's `sm-search-result` is the `h-auto min-h-10 items-start` `SettingsSidebarNav` gives its search results. `DialogPopup`'s `md` size is the `sm:max-w-md` `CustomSnoozeDialog` passes, its `xl` size is the `max-w-xl` stock's dialogs pass, and `expanded` is `ExpandedImageDialog`'s popup class. `EmptyHeader`'s `wide` is the `max-w-none` `NoActiveThreadState` passes. A sheet's `surface` is its stock call site's `className`: `sidebar` is the mobile `Sidebar`'s in `ui/sidebar.tsx`, except its width leaves a 64px strip to tap closed where stock's leaves 12px (Tam's call; a sync keeps it), `right-panel` is `RightPanelSheet`'s, and `terminal` is treflex's own, since stock's terminal drawer isn't a sheet.

| Here                              | Stock source                                                                                                                                                                             |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ui/Button.tsx`                   | `apps/web/src/components/ui/button.tsx`                                                                                                                                                  |
| `ui/Toggle.tsx`                   | `apps/web/src/components/ui/toggle.tsx`                                                                                                                                                  |
| `ui/ToggleGroup.tsx`              | `apps/web/src/components/ui/toggle-group.tsx`                                                                                                                                            |
| `ui/Switch.tsx`                   | `apps/web/src/components/ui/switch.tsx`                                                                                                                                                  |
| `ui/Checkbox.tsx`                 | `apps/web/src/components/ui/checkbox.tsx`                                                                                                                                                |
| `ui/roving.ts`                    | Base UI's `CompositeRoot` (the roving tab stop and arrow keys of `ToggleGroup`)                                                                                                          |
| `ui/Sidebar.tsx`                  | `apps/web/src/components/ui/sidebar.tsx`: `SidebarContent`, `SidebarGroup`, `SidebarMenu`, `SidebarMenuItem`, `SidebarMenuButton`, `SidebarInput`, `SidebarFooter`, `SidebarRail`'s look |
| `ui/Input.tsx`                    | `apps/web/src/components/ui/input.tsx`                                                                                                                                                   |
| `ui/DraftInput.tsx`               | `apps/web/src/components/ui/draft-input.tsx`, `apps/web/src/hooks/useCommitOnBlur.ts`                                                                                                    |
| `ui/Textarea.tsx`                 | `apps/web/src/components/ui/textarea.tsx`                                                                                                                                                |
| `ui/InputGroup.tsx`               | `apps/web/src/components/ui/input-group.tsx`                                                                                                                                             |
| `ui/Label.tsx`                    | `apps/web/src/components/ui/label.tsx`                                                                                                                                                   |
| `ui/Kbd.tsx`                      | `apps/web/src/components/ui/kbd.tsx`                                                                                                                                                     |
| `ui/Badge.tsx`                    | `apps/web/src/components/ui/badge.tsx`                                                                                                                                                   |
| `ui/Tooltip.tsx`                  | `apps/web/src/components/ui/tooltip.tsx`, `apps/web/src/components/ui/shared-tooltip.tsx`                                                                                                |
| `ui/Menu.tsx`                     | `apps/web/src/components/ui/menu.tsx`                                                                                                                                                    |
| `ui/Popover.tsx`                  | `apps/web/src/components/ui/popover.tsx`                                                                                                                                                 |
| `ui/Select.tsx`                   | `apps/web/src/components/ui/select.tsx`, and Base UI's `SelectPopup` (`alignItemWithTrigger` placement), `SelectScrollArrow` and `SelectItem` (selecting on mouse release)               |
| `ui/itemNavigation.ts`            | Base UI's `useListNavigation` and `useTypeahead` (the highlight, arrow keys and typeahead of `Menu` and `Select`)                                                                        |
| `ui/Dialog.tsx`                   | `apps/web/src/components/ui/dialog.tsx`                                                                                                                                                  |
| `ui/AlertDialog.tsx`              | `apps/web/src/components/ui/alert-dialog.tsx`                                                                                                                                            |
| `ui/DialogStyles.ts`              | `apps/web/src/components/ui/dialog-styles.ts`                                                                                                                                            |
| `ui/ScrollArea.tsx`               | `apps/web/src/components/ui/scroll-area.tsx`                                                                                                                                             |
| `ui/Sheet.tsx`                    | `SheetBackdrop` and `SheetPopup` in `apps/web/src/components/ui/sheet.tsx`                                                                                                               |
| `ui/Wizard.tsx`                   | `apps/web/src/components/ui/wizard.tsx`, `apps/web/src/components/AnimatedHeight.tsx`                                                                                                    |
| `ui/Spinner.tsx`                  | `apps/web/src/components/ui/spinner.tsx`                                                                                                                                                 |
| `ui/RefreshIcon.tsx`              | `apps/web/src/components/ui/refresh-icon.tsx`                                                                                                                                            |
| `ui/Skeleton.tsx`                 | `apps/web/src/components/ui/skeleton.tsx`                                                                                                                                                |
| `ui/visibleAnimation.ts`          | `apps/web/src/lib/visibleAnimation.ts`                                                                                                                                                   |
| `ui/Alert.tsx`                    | `apps/web/src/components/ui/alert.tsx`                                                                                                                                                   |
| `ui/Empty.tsx`                    | `apps/web/src/components/ui/empty.tsx`                                                                                                                                                   |
| `ui/StandalonePage.tsx`           | `apps/web/src/components/ui/standalone-page.tsx`                                                                                                                                         |
| `ui/Collapsible.tsx`              | `apps/web/src/components/ui/collapsible.tsx`, and Base UI's `useCollapsiblePanel` (the measured `--collapsible-panel-height`, unmounting once the exit transition ends)                  |
| `ui/CollapsibleSectionHeader.tsx` | `apps/web/src/components/ui/collapsible-section-header.tsx`                                                                                                                              |
| `ui/scrollOverflow.ts`            | Base UI's `ScrollAreaViewport` (the `--scroll-area-overflow-*` variables and `data-has-overflow-*`, `data-overflow-*` attributes)                                                        |
| `ui/floating.ts`                  | Base UI's `useAnchorPositioning` (placement middleware, `--transform-origin`), and `apps/web/src/components/ui/closing-positioner.tsx` (placement held still while a popup exits)        |
| `ui/Command.tsx`                  | `apps/web/src/components/ui/command.tsx`, with `autocomplete.tsx`'s input, list, group and item classes it builds on                                                                     |
| `ui/Combobox.tsx`                 | `apps/web/src/components/ui/combobox.tsx`, and Base UI's `AriaCombobox` and `ComboboxItem` (`autoHighlight`, the highlight on open and on a cleared query, selecting on mouse release)   |
| `ui/Toast.tsx`                    | `apps/web/src/components/ui/toast.tsx`, `anchoredCopyToast.ts`, and Base UI's `ToastViewport`, `ToastRoot` (height, swipe to dismiss) and `ToastPositioner`                              |
| `ui/toastStore.ts`                | `apps/web/src/components/ui/toast.logic.ts`, `toastHelpers.ts`, and Base UI's `ToastStore` and `createToastManager` (queue, limit, timers that pause on hover, focus and window blur)    |
| `ui/PanelTabCloseButton.tsx`      | `apps/web/src/components/ui/panel-tab-close-button.tsx`                                                                                                                                  |

## Running it

Run everything from the repo root with `./dev-stack.ps1`. It starts the server on 13773 without its file watcher, because a watcher restart interrupts running turns, plus this client on 5734 and the stock UI on 5733, as hidden processes that outlive the terminal. `-Status` shows what's up and `-Stop` stops what it started. State and logs are in `t3code-dev-home` beside the repo. It runs under PowerShell 7 or Windows PowerShell 5.1.

This client runs as a production build served by `vp preview`, not the dev server: a cold start on a phone takes about a dozen requests instead of hundreds. It has no HMR, so a change reaches it only through `./dev-stack.ps1 -Restart -Only treflex`, which runs `scripts/driver-build.ps1` to build into `t3code-dev-home\dev-stack\treflex-next` and swaps that into `apps/treflex-web/dist` only when the build succeeds. A failed build exits 1 and leaves the running client and `dist` alone; its output is in `dev-stack\treflex-build.log`.

Production builds register a service worker (`src/sw.ts`, which `vite.config.ts` writes to `dist/sw.js` with the build's file list). It precaches the shell, caches hashed assets as they load, and fetches `index.html` network-first, falling back to the cached copy offline or after three seconds. It handles only those files and page loads, never `/api`, `/ws`, `/oauth`, `/.well-known`, `/mcp` or another origin. A new build is used from the next launch or reload; the new worker installs in the background and drops the old cache. A page left open on an old build reloads itself if it needs a chunk the rebuild removed. The dev server never registers it.

The server looks for a built web client in `apps/web/dist` once, at startup, and `claude mcp login` needs it for the approval page. `./dev-stack.ps1` builds it before starting the server whenever it's missing, with no `VITE_HTTP_URL` or `VITE_WS_URL` set, and logs the build to `dev-stack\web-build.log`.

Tailscale Serve exposes this client on the machine's tailnet address at port 8443 (port 5734) and that built stock client at `:8444` (the server on 13773). The stock one is Tam's fallback when this client is broken, since no change here can break it; don't remove it or rebuild `apps/web/dist` from a broken checkout.

The session cookie isn't tied to a port, so a browser paired on 5733 is already paired on 5734. Otherwise open `localhost:5734/#token=…` with a token from `node apps/server/src/bin.ts pair`.

From `apps/treflex-web`, `vp run test` runs the headless suite and `vp run bench` prints the benchmark against `applyOrchestrationV2ProjectionEvent`, on a generated long thread. A new resource that follows a server stream gets a row in `CASES` in `src/Infrastructure/sessionSwap.test.ts`, which checks that it moves onto the session a reconnect opens. A component test is a `*.test.tsx`, which runs in jsdom and mocks the entity features its component uses, as `Markdown.test.tsx` does. `bench/stream` measures this client against stock in Chrome while a turn streams; its results are in [docs/benchmarks.md](./docs/benchmarks.md). [`bench/wire`](./bench/wire/README.md) checks the tree's codec against a running server's real data.

## Making changes

The client in the main checkout is the daily driver, so nobody edits files there. Each change gets a worktree off `treflex-main`, anywhere on disk. T3's worktree setup installs, or run `node scripts/setup-worktree.ts` with `T3CODE_PROJECT_ROOT` set to the main checkout. Then, from the worktree's `apps/treflex-web`, run its client against the same server:

```powershell
$env:TREFLEX_WEB_PORT = 5735; vp run dev
```

Keep test clients on 5735: `localStorage` is per port, so choices such as grouping by project stay set there across worktrees. The test client works on the driver's real threads, so a send there runs a real turn. The driver changes only when the branch merges into `treflex-main` and the driver is rebuilt.

To test what the driver will serve, including the service worker, build and preview on another port: `vp build`, then `vp preview --port 5747 --strictPort`. `localhost` counts as secure, so the worker registers without HTTPS. The worker outlives the server on its port, so unregister it in DevTools before running the dev server there again.

To see what the timeline does on a phone, turn on **Layout debug** in a thread's menu. The overlay shows live layout numbers and records touches, scroll events and their end, window grows, tail holds and releases, and each scroll correction with its cause, its anchor's position before and after, and where the anchor sits a frame later. Scroll on the phone, tap **Copy trace**, and paste it into a thread. **Clear** empties the recorder, which keeps the last 600 entries and records only while the overlay is on.

Work in the reflex repo doesn't reach this client until it's published. To move to a new release, read its breaking-changes record in the reflex repo's `docs/wip`, set both versions in `package.json`, and run `vp i`.

To bring in upstream changes, use the `/syncupstream` skill: it merges on a worktree, ports the logic and the shared styles copied from stock, tests the client live, and fast-forwards `treflex-main` only when it all holds. `apps/treflex-web/scripts/sync-upstream.ps1` alone fast-forwards `main` and pushes it to `origin` (`-DryRun` previews). After a sync or a style change, `vp run drift` checks the shared components against stock's; see [bench/drift](./bench/drift/README.md).

`upstream` is fetch-only. Actions is disabled on `Tgoh/t3code`, because upstream's workflows include release and deploy jobs. Keep it disabled.

## Styling

Tailwind v4 with preflight, like stock. `src/index.css` is the entry: it carries stock's whole `@theme inline` block, its custom utilities (`dropdown-glass`, `surface-glass`, `pt-safe` and the rest) and the `dark`/`light`/`any-hover` variants, over the tokens in `src/styles.css`, so a class copied from `apps/web` means the same thing here. `dark:` follows the `data-theme` attribute the appearance setting sets. `styles.css` has stock's tokens apart from those for features treflex doesn't have yet, such as the Electron window chrome, `@pierre/trees`, Pele diagrams, the settings slider, the prompt font settings, the diff colour schemes, the ultrathink highlight, thread find and the theme presets. Stock's `[data-app-sidebar]` overrides stay scoped to the app sidebar, as in stock. A stock token that isn't here renders nothing until it's copied the same way.

`styles.css` holds only global rules: the tokens, the page's base styles, the `.chat-markdown` prose rules for markup generated from Markdown (which can't carry utilities), the terminal's xterm overrides, the `@pierre/diffs` surface rules (the rest of the diff view's styling is unsafe CSS inside its shadow roots, in `diffRendering.ts`), and the iOS input rule. It sits in the `components` layer, above preflight and under the utilities, so its rules beat the reset and a utility always beats it. Preflight strips the heading, list and margin defaults, so the prose rules set them for Markdown.

- Put utilities in the markup. Never add a rule to `styles.css` unless it's global.
- When porting from stock, copy its class strings.
- Arbitrary values (`text-[14px]`) are fine where stock's scale would shift a pixel: stock's `text-sm` and `text-xs` also set a line-height.
- There's no `tailwind-merge`. Never put two utilities for the same property on one element: Tailwind's order wins, not the class order. Drive state through variants on the element's ARIA or data attributes (`aria-[current=page]:bg-accent`, `aria-selected:`, `data-[state=open]:`), not a conditional class that adds a competing utility.
- A class string used more than once in a file is a `const` at the top of that file. A look shared across areas becomes one exported string or component under `src/ui/`, made by the thread that owns it.
- `hover:` applies only where the pointer can hover, as in stock.
- Tailwind reads class names from the source text, so a class glued to an interpolation (`` `py-4${extra}` ``) is never generated. Leave a space before the `${`.
- To style an element by an ancestor's state, put the variant on the element (`in-[.chat-stage.with-details]:max-w-…`), not a rule that reaches into it.

### Shared controls

`src/ui/` holds the controls every area uses, each owning its look the way stock's `components/ui` do: `Button`, `InlineButton`, `Toggle`, `ToggleGroup`, the sidebar parts (`SidebarContent`, `SidebarGroup`, `SidebarMenu`, `SidebarMenuItem`, `SidebarMenuButton`, `SidebarInput`, `SidebarFooter`, `SidebarRail`), `Input`, `DraftInput` (commits on blur or Enter), `Textarea` (grows with its text), `InputGroup` with `InputGroupAddon` and `InputGroupInput`, `Label`, `Kbd` and `KbdGroup`, `Badge`, `Spinner`, `RefreshIcon` (spins while `refreshing`), `Skeleton`, the `Select` parts (`Select`, `SelectTrigger`, `SelectValue`, `SelectPopup`, `SelectItem`), `Switch`, `Checkbox`, `CheckboxMark` (the look alone, for a row that is itself the button), the `Menu` parts (`MenuPopup`, items, checkbox and radio items, groups, `MenuSub` submenus), `PopoverPopup`, the `Dialog`, `AlertDialog` and `Wizard` parts, the `Command` parts (`CommandDialog`, `CommandDialogPopup`, `CommandInput`, `CommandPanel`, `CommandList`, `CommandGroup`, `CommandItem`, `CommandShortcut`, `CommandFooter`), the `Combobox` parts (`Combobox`, `ComboboxTrigger`, `ComboboxPopup`, `ComboboxSearchInput`, `ComboboxList`, `ComboboxListVirtualized`, `ComboboxItem`, `ComboboxEmpty`, `ComboboxStatus`), `Alert` with `AlertTitle`, `AlertDescription` and `AlertAction`, the `Empty` parts, `StandalonePage` with `StandalonePageHeader`, the `Collapsible` parts (`Collapsible`, `CollapsibleTrigger`, `CollapsiblePanel`), `CollapsibleSectionHeader` with `SectionHeaderStatus`, `ScrollArea`, `SheetBackdrop` and `sheetPopupVariants()`, and the tooltip host, which shows any element's `data-tip` (its `data-tip-*` attributes are listed on `TooltipHost`). Pick a `variant` or `size`, and pass `class` only for layout (margin, width, position) or a property the variant doesn't set. If no variant fits, add one there rather than restyling at the call site. `buttonVariants()` returns the class string for an element that can't be a `<button>`, such as a link or a label. A field's `class` goes on its `data-slot="input-control"` wrapper, as stock's does; mark a bad value with `aria-invalid`. A `Toggle`'s `pressed` prop sets both `aria-pressed` and `data-pressed`; inside a `ToggleGroup` it takes a `value` instead, and the group's `value` lists the pressed ones. A `ToggleGroup` holds one tab stop, as Base UI's does: arrow keys, Home and End move focus without pressing. A `MenuPopup` or `PopoverPopup` is placed against its `anchor` (an element, or a point for a context menu) and writes `data-popup-open`, `data-pressed`, `aria-expanded` and `aria-controls` on its trigger while open, so the trigger only owns its open state; render it in a `Presence` and close it from `onClose`, which items, Escape, Tab and a press outside all call. A menu with a trigger is modal, as Base UI's: a backdrop with a hole for the trigger takes outside presses, so nothing under it gets them. A context menu (a point and no trigger) isn't, as stock's: a right-click elsewhere closes it and opens that target's own menu. A menu trigger carries `aria-haspopup="menu"` and `aria-expanded="false"`, and passes its `onKeyDown` to `openMenuFromKeys` so ArrowDown and ArrowUp open it. A `Select` owns its open state, unlike a menu: its `value` is the chosen item's or null, its trigger's `SelectValue` shows the label the caller passes (or its `placeholder` with no value), and its `SelectPopup` is modal like a menu's and follows each call site's `alignItemWithTrigger` and `align`, as stock's do. Nested menus and popovers dismiss through the overlay stack in `overlays.ts`, top first. A `Dialog` or `AlertDialog` is a modal `<dialog>` in the top layer: render it in a `Presence` and close it from `onClose`, which Escape, `DialogClose` and, for a `Dialog` only, a press outside the popup call. It focuses the first `DialogAction` on open (else the first tabbable element), and gives focus back to its opener as soon as the close starts: the trigger, or for a menu item, the element that menu returns focus to. While it plays its exit it is inert and no longer modal, so the page takes input at once. A `CommandDialogPopup` is a modal `<dialog>` the same way, focused on its input and closed by Escape or a press on its backdrop. A `CommandInput` keeps focus while its list's highlight moves: the caller owns the highlight, marks that row's `CommandItem` `active` and passes its id as `aria-activedescendant`. A `Combobox` owns its highlight, as Base UI's with `autoHighlight`: its `ComboboxSearchInput` keeps focus, typing highlights the first row, clearing the query goes back to the row whose `value` matches the combobox's, and ArrowUp, ArrowDown and Enter move and choose. The caller filters the rows itself. A `ComboboxPopup` is non-modal, under its `ComboboxTrigger`, which calls its `onOpen` on a press or ArrowDown and ArrowUp (a trigger that is sometimes a menu's passes its `onKeyDown` to `openComboboxFromKeys` itself); a `ComboboxListVirtualized` takes the caller's own scroller, faded by `getVirtualizedScrollFadeClassName` over `createScrollEnds`, and with `inline` (a list on the page, not in a popup) highlights its selected row on mount. An `Alert` lays out its children by `data-slot`, as stock's does: an icon first, `AlertTitle` and `AlertDescription` in the middle, `AlertAction` last. A `Collapsible` is controlled by its `open` and `onOpenChange`; its `CollapsiblePanel` is mounted only while open (or closing) and grows and shrinks over 200ms unless `animate={false}`. A surface inside a `Presence` passes `usePresence().track` as its ref and styles its entrance and exit with Base UI's `data-starting-style:` and `data-ending-style:`, as stock's class strings do. A `ScrollArea` scrolls natively and keeps the page's native scrollbars, not Base UI's overlay thumbs; it writes Base UI's `--scroll-area-overflow-*` variables and `data-overflow-*` attributes, which drive its `scrollFade`. `SidebarContent` is a faded `ScrollArea` under its `fixedHeader`; `createListDrag` scrolls that viewport around its list. The sidebar, right panel and terminal stay in the layout on narrow screens rather than opening as modal dialogs: each switches to its `sheetPopupVariants()` class there, and the persistent sidebar holds `data-ending-style` and `inert` while closed, and turns invisible once its exit ends. A `visible-animate-*` or `live-*` animation stays paused until the component calls `observeVisibleAnimation` in its body and puts the ref it returns on the element, which runs it only while it's on screen in a visible tab.

## Setting up a machine

Two folders sit side by side under `G:\Sorted\Code`, because `dev-stack.ps1` finds the data folder by relative path, and the Claude skills use absolute ones:

- `t3code`: this repo, on `treflex-main`.
- `t3code-dev-home`: the driver's data (threads, settings, attachments, stored secrets, T3's worktrees). Copy it from the old machine with the stack stopped (`./dev-stack.ps1 -Stop`), or leave it out to start empty.

Install Git, nvm-windows and Vite+ (`vp`), then the Node version in the root `package.json` `engines` field:

```powershell
nvm install 26.13.1
```

```powershell
nvm use 26.13.1
```

Clone this repo from `G:\Sorted\Code`:

```powershell
git clone -b treflex-main https://github.com/Tgoh/t3code.git t3code
```

```powershell
git -C t3code remote add upstream https://github.com/pingdotgg/t3code.git
```

```powershell
git -C t3code remote set-url --push upstream no_push
```

From `t3code`, run `vp i`, then start the stack with `./dev-stack.ps1`, which builds this client and, the first time, the stock client.

The Claude setup lives outside the repo: copy `~/.claude/CLAUDE.md`, `G:\Sorted\Code\CLAUDE.md`, and the `commit`, `build` and `syncupstream` skills from `~/.claude/skills`. Claude Alt, with its own config folder, needs the same files there.
