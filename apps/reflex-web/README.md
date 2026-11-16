# Reflex client

A t3code web client built on treflex (the framework in [the reflex repo](file:///G:/Sorted/Code/reflex)) and Solid, against the stock t3code server. It's Tam's daily driver, and a test of treflex on an app it wasn't designed around.

Log gaps and problems in [docs/issues.md](./docs/issues.md).

## Decisions

| Decision           | Choice                                                                                                                                                                                          |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repo               | Private `Tgoh/t3code`, not a public fork, because treflex is unpublished                                                                                                                        |
| Branches           | `main` only tracks upstream. `reflex-main` is the working copy the daily driver runs from; changes go on worktree branches and merge back once they pass the gates, and a bad merge is reverted |
| Location           | `apps/reflex-web`. Avoid editing upstream's files so merges stay easy                                                                                                                           |
| Renderer           | Solid, through `treflex-solid`                                                                                                                                                                  |
| Reused             | `packages/contracts`, `packages/shared`, and `client-runtime`'s `connection/` and `rpc/`                                                                                                        |
| Replaced           | `client-runtime/src/state`, the Zustand stores, and the web components                                                                                                                          |
| Server             | No server changes. If something seems to need one, log it in `issues.md` first                                                                                                                  |
| State              | Hold the wire format in the tree, with no decoded `DateTime`, to meet treflex's plain-data rule                                                                                                 |
| Reducer            | Written as treflex actions that mutate the tree, not a port of the immutable reducer                                                                                                            |
| Tests              | Headless, with a scripted server at the effect boundary                                                                                                                                         |
| Terminal emulator  | `@xterm/xterm` and its fit addon, loaded on first open. Stock's libghostty WASM surface isn't reusable from a non-React app without its build and surface code                                  |
| Treflex dependency | `file:` paths to `packages/core` and `packages/solid` through each checkout's `.t3/treflex` junction to the pin                                                                                 |

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
   │  └─ OpenThreads: runs, messages, turn items, requests
   └─ Local              (only this client knows it)
      └─ ThreadSessions: draft, attachments, panels, terminal UI
```

- **Only what arrives from the server writes to the replica:** the stream receivers, history pages and the provider list, plus opening and closing a thread. Commands change it only through what the stream delivers next. A thread's own commands are `ThreadSession` actions, so their draft can't reach the replica. An answer runs on its runtime request's entity, but writes only a transient error, which sits in the `TransientState` root rather than the replica. `Model.test.ts` pins the writers that remain.
- **Data about running work isn't state.** Busy marks are `inFlight` reads of `leading` or `latest` actions, stream sync and terminal status are transients, and a stream's end is read from its resource status.
- **A failure with its own place on screen is caught where it happens,** as a send's or an answer's is. Anything else below `Root` throws to `Root`'s `Action/Error` boundary, which shows the latest one in the sidebar until it's dismissed. `Root`'s own `load` failing reaches the empty `onError`. Every caught throw, taken or not, is logged from the runtime's `failure` event in `index.tsx`.
- **Entities stop at the open thread, except its runtime requests and its history window,** whose busy marks have to be their own (see `issues.md`). `reconcileEntities` and `putEntity` in `rows.ts` mint new requests and fold held ones in place. Runs, messages, turn items and shell rows are plain wire data, held by `id` in records and folded in place with `reconcile` in `rows.ts`. The timeline holds item ids, and each row joins itself with `timelineItem` and decides its own visibility, so a delta costs the same at any thread length. Grouping is laid out per response (a prompt to the next), from per-row facts that stay equal through text deltas, so a delta re-lays only its own response. A parent selector over the rows also leaves deltas alone if it returns stable references, because `<For>` remounts on new objects, but it walks the list on every added row, which only shows on very long threads.
- **Local state doesn't sit under replica threads.** Treflex treats removal as disposal, and a thread can be trimmed from the shell while it still exists. A draft also exists before its server thread does.
- **Deleting a thread is two linked steps.** `thread.deleted` removes the replica row, and a receiver removes the matching `ThreadSession`.
- **A session joins the replica through the `Replica` data source,** which `Environment` registers, in selectors. An action reads those selectors with `select`, because a direct `getData` in an action copies the whole replica.
- **Terminal and command output never enter state.** The `terminalSession` resource owns the emulator and its socket traffic and emits only lifecycle status. `commandOutput` exposes its text and lives only while its row is expanded. Hiding the panel or selecting another thread detaches, and `localStorage` remembers each open panel's launch so a return or a reload reattaches.
- **Applying one delta stays under a frame (16 ms) and doesn't grow with thread length.** `vp run bench` measures it.

### Mismatches with the server

1. **A missing row doesn't mean a thread is gone.** The shell leaves out idle subagents and older settled threads, so absence can't drive disposal or deletion.
2. **Whole-row replacement.** `*.updated` events replace whole rows, and reconnects can deliver snapshots. Assigning a payload over a held node replaces the node, so views over it remount, and treflex has no `merge`. These go through `reconcile` in `rows.ts`, which keeps the nodes of rows the payload still carries.
3. **One item in several places.** Items appear in `turnItems` and `visibleTurnItems[].item`, and inherited rows come from other threads. An entity has one parent, so use id references and selector joins.
4. **Events apply as in-place actions.** Assigning a new projection walks the whole thread on every event.
5. **An action holds its entity.** Other work on that entity queues behind it, so every network wait in an action on a session, environment, open thread or runtime request is wrapped in `open(...)`. Other work runs during the wait, so what follows re-checks its premises, as a diff does, and re-finds nodes on the draft.
6. **Turn items are a discriminated union on `type`.**

## Reference code

- **Treflex concepts:** in the pin, `docs\usage\introduction.md`, then `docs\advanced\live-sources.md`, `views.md` and `testing.md`. The worked demo is `demos\kitchen`.
- **Conventions at scale:** `G:\Sorted\Code\solidportal\docs\exemplars.md` and `Concepts.md`.

## Logic copied from stock

Code imported from `@t3tools/*` follows upstream through the typecheck. These parts were rewritten by hand from stock, so an upstream change to the source on the right changes nothing here until it's ported:

| Here                                                                                         | Stock source                                                                                                                                                                                                                                               |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OpenThread.ts` `applyEvent`, `restoreQueuedUserRows`                                        | `packages/client-runtime/src/state/orchestrationV2Projection.ts`, `applyOrchestrationV2ThreadVisit` in `packages/contracts/src/orchestrationV2.ts`                                                                                                         |
| `Shell.ts` `runtimeStatus`, `workingStartedAt`                                               | `packages/client-runtime/src/state/models.ts`                                                                                                                                                                                                              |
| `Shell.ts` `sidebarStatus`, `hasUnseenRunFailure`, `needsVisit`                              | `apps/web/src/components/Sidebar.logic.ts`, `packages/client-runtime/src/state/threadSettled.ts`, `packages/client-runtime/src/state/threadVisits.ts`                                                                                                      |
| `ThreadCard.tsx` status labels, `TimelineRows.tsx` `rowKind`                                 | `apps/web/src/components/sidebar/SidebarThreadRow.tsx`, `apps/web/src/session-logic.ts`                                                                                                                                                                    |
| `Shell.ts` `isSnoozed`, `canSnooze`, `failureEdgeAt`, `runCompletedAt`                       | `packages/client-runtime/src/state/threadSettled.ts`, `packages/client-runtime/src/state/threadInbox.ts`, `apps/web/src/components/threadActionMenu.logic.ts`                                                                                              |
| `Shell.ts` `subagentRequests`                                                                | `packages/client-runtime/src/state/threadShell.ts`                                                                                                                                                                                                         |
| `Shell.ts` `projectFolders`, `sidebarSections`                                               | `apps/web/src/components/Sidebar.logic.ts`                                                                                                                                                                                                                 |
| `RuntimeRequest.ts` `canAnswer`, `RequestViews.tsx`                                          | `apps/web/src/components/chat/usePendingThreadRequests.ts`, `packages/client-runtime/src/state/threadRequests.ts`, `apps/web/src/components/chat/TimelinePendingApprovalRow.tsx`, `apps/web/src/components/chat/ComposerPendingUserInputPanel.tsx`         |
| `turnItemView.ts`                                                                            | `apps/web/src/session-logic.ts`                                                                                                                                                                                                                            |
| `workLog.ts`                                                                                 | `apps/web/src/session-logic.ts` (`projectedWorkEntry`, the status checks), `apps/web/src/components/chat/MessagesTimeline.logic.ts` (labels), `apps/web/src/filePathDisplay.ts`                                                                            |
| `timelineLayout.ts`, `TimelineResponse.tsx`                                                  | `apps/web/src/components/chat/MessagesTimeline.logic.ts` (`deriveTurnFolds`, `deriveMessagesTimelineRows`, `attachTrailingToolGroupsToAssistant`, `liveAnswerPreview`), `TimelineWorkGroupRows.tsx`, `TimelineWorkGroupRows.logic.ts`                      |
| `sanitize.ts`                                                                                | `packages/shared/src/markdownPipeline.ts`                                                                                                                                                                                                                  |
| `addProjectPaths.ts` `browsePlatform`, `filterPinnedBrowseEntries`                           | `apps/web/src/components/CommandPalette.logic.ts`                                                                                                                                                                                                          |
| `addProjectPaths.ts` folder steps and defaults, `Environment.ts` `addFolder`, `cloneProject` | `apps/web/src/components/CommandPalette.tsx`                                                                                                                                                                                                               |
| `addProjectPalette.ts`, `AddProject.tsx` views and key handling                              | `apps/web/src/components/CommandPalette.tsx` (`buildAddProjectSourceGroups`, `handleKeyDown`, `willCreateProjectPath`, `submitActionLabel`)                                                                                                                |
| `Environment.ts` `newProject`                                                                | `apps/web/src/hooks/useNewProject.ts`                                                                                                                                                                                                                      |
| `ProjectClone.tsx` `useProjectClone`                                                         | `apps/web/src/state/projectClones.ts`                                                                                                                                                                                                                      |
| `ProjectClone.tsx` `cloneSendBlock`, `ProjectCloneBanner`                                    | `apps/web/src/components/chat/useProjectCloneBanner.tsx`                                                                                                                                                                                                   |
| `attachmentIntake.ts`                                                                        | `apps/web/src/components/chat/composerAttachmentFiles.ts`, `apps/web/src/components/chat/useComposerAttachmentIntake.ts` (`addComposerAttachments`, `foldPastedText`), `apps/web/src/components/chat/workspaceFileDrop.ts`                                 |
| `composerFiles.ts` uploads                                                                   | `apps/web/src/lib/attachmentUploadQueue.ts`                                                                                                                                                                                                                |
| `Composer.tsx` paste handling, `FileDropSection`, attachment strip                           | `apps/web/src/components/chat/ChatComposer.tsx` (`onComposerPaste`), `apps/web/src/components/ChatView.tsx`, `apps/web/src/components/chat/TimelineOverlays.tsx`, `apps/web/src/components/chat/ComposerAttachmentStrip.tsx`                               |
| `TimelineRows.tsx` `AttachmentFile`                                                          | `apps/web/src/components/chat/TimelineUserMessageRow.tsx` (`UserFileCard`)                                                                                                                                                                                 |
| `modelOptions.ts`                                                                            | `apps/web/src/components/chat/ComposerModelEffort.tsx`, `TraitsPicker.tsx`, `composerProviderState.tsx`, `runtimeModeConfig.ts`, `apps/web/src/providerModels.ts`, `getStartedThreadModelChangeBlockReason` in `apps/web/src/components/ChatView.logic.ts` |
| `ComposerMenus.tsx`                                                                          | `apps/web/src/components/chat/ModelPickerContent.tsx`, `ComposerModelEffort.tsx`, `ComposerFooterControls.tsx` (`ComposerPermissionsSection`), `runtimeModeConfig.ts`                                                                                      |
| `ThreadSession.ts` `setModelSelection`, `chooseModel`, `send`'s runtime mode                 | `apps/web/src/components/chat/useApplyThreadModelPick.ts`, `useComposerSelection.ts`, `persistThreadSettingsForNextTurn` in `apps/web/src/components/ChatView.tsx`                                                                                         |

Add a row whenever stock logic is copied rather than imported. A `Follows …` comment in `src` that names a source missing here is a missing row.

## Running it

Run everything from the repo root with `./dev-stack.ps1`. It starts the server on 13773 without its file watcher, because a watcher restart interrupts running turns, plus this client on 5734 and the stock UI on 5733, as hidden processes that outlive the terminal. `-Status` shows what's up and `-Stop` stops what it started. State and logs are in `G:\Sorted\Code\t3code-dev-home`.

The server looks for a built web client in `apps/web/dist` once, at startup, and `claude mcp login` needs it for the approval page. Build it with `vp build` in `apps/web`, with no `VITE_HTTP_URL` or `VITE_WS_URL` set, and restart the server if a sign-in says no static directory is configured.

The session cookie isn't tied to a port, so a browser paired on 5733 is already paired on 5734. Otherwise open `localhost:5734/#token=…` with a token from `node apps/server/src/bin.ts pair`.

From `apps/reflex-web`, `vp run test` runs the headless suite and `vp run bench` prints the benchmark against `applyOrchestrationV2ProjectionEvent`, on a generated long thread. Run them from there: from the repo root, vitest misses this app's Solid resolve conditions.

## Making changes

The client in the main checkout is the daily driver, so nobody edits files there. Each change gets a worktree off `reflex-main`, anywhere on disk. T3's worktree setup links `.t3/treflex` and installs, or run `node scripts/setup-worktree.ts` with `T3CODE_PROJECT_ROOT` set to the main checkout. Then, from the worktree's `apps/reflex-web`, run its client against the same server:

```powershell
$env:REFLEX_WEB_PORT = 5735; vp run dev
```

Keep test clients on 5735: `localStorage` is per port, so choices such as grouping by project stay set there across worktrees. The test client works on the driver's real threads, so a send there runs a real turn. The driver changes only when the branch merges into `reflex-main`.

Treflex is pinned to commit `2cd7ce0` through a detached checkout at `G:\Sorted\Code\reflex-t3code-treflex`, so work in the reflex repo doesn't reach this client. To move it, check out another commit there, run `vp i`, and update this line.

To bring in upstream changes, use the `/syncupstream` skill: it merges on a worktree, ports the logic copied from stock, tests the client live, and fast-forwards `reflex-main` only when it all holds. `apps/reflex-web/scripts/sync-upstream.ps1` alone fast-forwards `main` and pushes it to `origin` (`-DryRun` previews).

`upstream` is fetch-only. Actions is disabled on `Tgoh/t3code`, because upstream's workflows include release and deploy jobs. Keep it disabled.

## Setting up a machine

Three folders sit side by side under `G:\Sorted\Code`, because `dev-stack.ps1` finds the data folder by relative path, and `scripts/setup-worktree.ts` and the Claude skills use absolute ones:

- `t3code`: this repo, on `reflex-main`.
- `reflex-t3code-treflex`: the treflex pin.
- `t3code-dev-home`: the driver's data (threads, settings, attachments, stored secrets, T3's worktrees). Copy it from the old machine with the stack stopped (`./dev-stack.ps1 -Stop`), or leave it out to start empty.

Install Git, PowerShell 7, nvm-windows and Vite+ (`vp`), then the Node version in the root `package.json` `engines` field:

```powershell
nvm install 26.13.1
```

```powershell
nvm use 26.13.1
```

Clone this repo and the treflex pin from `G:\Sorted\Code`:

```powershell
git clone -b reflex-main https://github.com/Tgoh/t3code.git t3code
```

```powershell
git -C t3code remote add upstream https://github.com/pingdotgg/t3code.git
```

```powershell
git -C t3code remote set-url --push upstream no_push
```

```powershell
git clone https://github.com/Tgoh/reflex.git reflex-t3code-treflex
```

```powershell
git -C reflex-t3code-treflex checkout --detach 2cd7ce0
```

Link the pin into the checkout, which worktree setup does on its own:

```powershell
New-Item -ItemType Junction -Path t3code\.t3\treflex -Target (Resolve-Path reflex-t3code-treflex)
```

From `t3code`, run `vp i`, build the stock client with `vp build` in `apps/web`, and start the stack with `./dev-stack.ps1`.

The Claude setup lives outside the repo: copy `~/.claude/CLAUDE.md`, `G:\Sorted\Code\CLAUDE.md`, and the `commit`, `build` and `syncupstream` skills from `~/.claude/skills`.
