import type { ResolvedKeybindingsConfig } from "@t3tools/contracts";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";
import {
  findProjectByPath,
  inferProjectTitleFromPath,
} from "@t3tools/client-runtime/state/projects";
import {
  getLatestThreadForProject,
  planPinnedReorder,
} from "@t3tools/client-runtime/state/thread-sort";
import {
  bind,
  entity,
  generateGuid,
  type IActionGenerator,
  type IEntity,
  isEnded,
  type IOpenGenerator,
  type ISelectorGenerator,
  leading,
  open,
  openResource,
  receiver,
  registerDataSource,
  resource,
  select,
  start,
  startTimer,
  stopTimer,
  workTag,
} from "treflex";
import { createEntityFeature } from "treflex-solid";
import {
  resolveSideThreadOpenTarget,
  type SideThreadOpenIntent,
  sideThreadKindOf,
} from "@t3tools/client-runtime/side-thread";

import { followActivity, reportActivity } from "./Activity";
import { address, type IAddress } from "./Infrastructure/address";
import type { IDeviceActivity } from "./Infrastructure/clientActivity";
import {
  cloneControlEffect,
  forkThreadEffect,
  type INewProject,
  type IProjectCommand,
  type IThreadCommand,
  type IWireModelSelection,
  newProjectEffect,
  openInEditorEffect,
  openInFileManagerEffect,
  projectCommandEffect,
  startCloneEffect,
  threadCommandEffect,
  withCommandId,
} from "./Infrastructure/commandEffects";
import {
  storeDraftEffect,
  storedNewThreadEffect,
  storeDraftFilesEffect,
} from "./Infrastructure/draftMemory";
import { rememberedModelsEffect } from "./Infrastructure/modelMemory";
import { addProjectSettingsOf, type IAddProjectSettings } from "./addProjectPaths";
import { editorChoices, type IEditors } from "./editors";
import { getDefaultGitWork, type IGitWork } from "./GitWork";
import { newThreadModelOverride } from "./newThreadDefaults";
import {
  clockNowEffect,
  type IPreferences,
  storedEditorEffect,
  storedPreferencesEffect,
  storeEditorEffect,
} from "./Infrastructure/preferences";
import {
  colorScheme,
  followDevice,
  projectSort,
  setAppearanceMode,
  setPreferences,
  setProjectHidden,
  showMoreSettled,
  sidebarLayout,
  toggleFolder,
  toggleProjectScope,
  toggleShelf,
  toggleViewportDebug,
} from "./Preferences";
import { type IShelves, SETTLED_PAGE } from "./sidebarLayout";
import { getDefaultTerminal, type ITerminal } from "./Terminal";
import { type IWireClientSettings, storedClientSettingsEffect } from "./Infrastructure/settings";
import { rememberTerminalEffect } from "./Infrastructure/terminalMemory";
import {
  getDefaultOpenThread,
  type IOpenThread,
  openThreadStream,
  resumeThread,
  retainThread,
} from "./OpenThread";
import {
  applyConfigEvent,
  applyNotificationMode,
  autoRefreshLimits,
  chooseNotificationMode,
  confirmThreadArchive,
  confirmThreadDelete,
  confirmThreadUnpin,
  openView,
  sendShortcut,
  showView,
  syncAddress,
  timestampFormat,
  toggleModelFavorite,
  updateServerSettings,
  wordWrap,
  writeSetting,
} from "./Settings";
import { compactionDismissalKey, dismissedIn } from "./compaction";
import {
  dropDictation,
  getDefaultDictation,
  type IDictation,
  openDictation,
  refuseTranscript,
  setVoiceDestination,
  startDictation,
} from "./Dictation";
import type { IWireProject } from "./Infrastructure/wire";
import { minute } from "./Infrastructure/clock";
import { serverError } from "./Infrastructure/serverError";
import { toast } from "./Infrastructure/toasts";
import { lookUpLineageTitles } from "./lineageTitles";
import { toSortableThread } from "./projectOrder";
import {
  getDefaultShell,
  type IShell,
  openShellStream,
  trackTitleRegenerations,
  visitShown,
} from "./Shell";
import {
  applyTranscript,
  checkRewind,
  detachThread,
  followCheckout,
  followWorkspace,
  getDefaultThreadSession,
  hideSide,
  type IPanels,
  panels,
  type IReplica,
  type ISelection,
  type IThreadSession,
  reattachThread,
  restoreDraft,
  settleQuestions,
  threadProjectId,
} from "./ThreadSession";

declare module "treflex" {
  interface IResourceRegistry {
    "Project/Clones": { Type: "projectClones" };
    "Server/Config": { Type: "serverConfigStream" };
    "Notify/Device": { Type: "threadNotifier" };
    "Device/History": { Type: "addressHistory" };
  }
  interface ITimerRegistry {
    "Server/ConfigReopen": {};
  }
}

const CONFIG_REOPEN_MS = 1_000;

export interface IEnvironment extends IEntity {
  EnvironmentId: string;
  Label: string;
  FileAttachmentLimit: number | null;
  Replica: IReplica;
  Local: ISelection & {
    ThreadSessions: Record<string, IThreadSession>;
    ClientSettings: IWireClientSettings | null;
    Preferences: IPreferences;
    Shelves: IShelves;
    SystemDark: boolean;
    Activity: IDeviceActivity;
    ViewportDebug: boolean;
    /** The editor this device last opened with, as stock stores it. */
    Editor: string | null;
    Dictation: IDictation;
  };
}

export function* newEnvironment(
  environmentId: string,
  label: string,
  fileAttachmentLimit: number | null,
): IActionGenerator<IEnvironment> {
  const shell = yield* entity<IShell>(getDefaultShell(environmentId));
  const replica = yield* entity<IReplica>({
    Providers: [],
    ModelFavorites: [],
    Shell: shell,
    OpenThreads: {},
    Config: null,
  });
  const dictation = yield* entity<IDictation>(getDefaultDictation());
  const local = yield* entity<IEnvironment["Local"]>({
    SelectedThreadId: null,
    ThreadSessions: {},
    View: null,
    ClientSettings: yield* storedClientSettingsEffect(),
    Preferences: yield* storedPreferencesEffect(),
    Shelves: {
      WorkingOpen: false,
      SnoozedOpen: false,
      SettledOpen: false,
      SettledShown: SETTLED_PAGE,
    },
    SystemDark: false,
    Activity: { Visible: false, Focused: false, RecentlyInteracted: false },
    ViewportDebug: false,
    Editor: yield* storedEditorEffect(),
    Dictation: dictation,
  });
  return yield* entity<IEnvironment>({
    EnvironmentId: environmentId,
    Label: label,
    FileAttachmentLimit: fileAttachmentLimit,
    Replica: replica,
    Local: local,
  });
}

// Follows the effect in apps/web/src/components/ChatView.tsx that persists a resume compaction's
// "Don't ask again" answer, so the offer stays off for that provider in every thread.
function* rememberCompactionDismissal(draft: IEnvironment, threadId: string): IActionGenerator {
  const open = draft.Replica.OpenThreads[threadId];
  if (open?.Thread == null || !dismissedIn(open)) return;
  const activeId = open.Thread.activeProviderThreadId;
  const instanceId =
    (activeId == null ? undefined : open.ProviderThreads[activeId]?.providerInstanceId) ??
    open.Thread.modelSelection.instanceId;
  const key = compactionDismissalKey(draft.EnvironmentId, instanceId);
  const held = draft.Local.Preferences.CompactionDismissed;
  if (held.includes(key)) return;
  yield* setPreferences(draft, { CompactionDismissed: [...held, key] });
}

function* openConfigStream(draft: IEnvironment): IActionGenerator {
  yield* openResource(draft, "Server/Config", EnvironmentReceiver, {
    Type: "serverConfigStream",
    EnvironmentId: draft.EnvironmentId,
  });
}

export function* init(draft: IEnvironment): IActionGenerator {
  yield* registerDataSource(draft, "Replica", draft.Replica);
  yield* registerDataSource(draft, "Selection", draft.Local);
  bind(draft, EnvironmentReceiver);
  yield* followDevice(draft);
  yield* followActivity(draft);
  yield* openResource(draft, "Notify/Device", EnvironmentReceiver, { Type: "threadNotifier" });
  yield* applyNotificationMode(draft);
  yield* openShellStream(draft.Replica.Shell);
  yield* openResource(draft, "Project/Clones", {
    Type: "projectClones",
    EnvironmentId: draft.EnvironmentId,
  });
  yield* openResource(draft.Replica.Shell, "Project/Favicons", {
    Type: "projectFavicons",
    EnvironmentId: draft.EnvironmentId,
  });
  yield* openConfigStream(draft);
  yield* openDictation(draft.Local.Dictation);
  // A restored address isn't an open, and its thread's row hasn't arrived yet: the shell
  // receiver visits a due completion once the row lands and no page covers it.
  const held = yield* address();
  if (held.NewThreadIn !== null) {
    yield* showThread(draft, yield* newThreadSession(draft, held.NewThreadIn));
  } else if (held.Thread !== null) yield* showThread(draft, held.Thread);
  if (held.View !== null) yield* showView(draft, held.View);
  yield* syncAddress(draft, false);
  yield* openResource(draft, "Device/History", EnvironmentReceiver, { Type: "addressHistory" });
}

function* followAddress(draft: IEnvironment, held: IAddress): IActionGenerator {
  const threadId =
    held.NewThreadIn !== null ? yield* newThreadSession(draft, held.NewThreadIn) : held.Thread;
  if (held.View === null && threadId !== null) yield* selectThread(draft, threadId);
  else {
    const previous = draft.Local.SelectedThreadId;
    if (threadId !== null && threadId !== previous) yield* showThread(draft, threadId);
    if (threadId === null && previous !== null) {
      draft.Local.SelectedThreadId = null;
      yield* leaveThread(draft, previous);
    }
    yield* openView(draft, held.View);
  }
  yield* syncAddress(draft, false);
}

function* sessionOf(
  draft: IEnvironment,
  threadId: string,
  newThreadProjectId: string | null = null,
): IActionGenerator<IThreadSession> {
  const held = draft.Local.ThreadSessions[threadId];
  if (held !== undefined) return held;
  const environmentId = draft.EnvironmentId;
  const git = yield* entity<IGitWork>(getDefaultGitWork(environmentId, threadId));
  const terminal = yield* entity<ITerminal>(getDefaultTerminal(environmentId, threadId));
  draft.Local.ThreadSessions[threadId] = yield* entity<IThreadSession>({
    ...getDefaultThreadSession(environmentId, threadId, newThreadProjectId),
    Git: git,
    Terminal: terminal,
  });
  const session = draft.Local.ThreadSessions[threadId]!;
  yield* openResource(session, "Composer/Files", {
    Type: "composerFiles",
    EnvironmentId: draft.EnvironmentId,
  });
  yield* restoreDraft(session);
  return session;
}

export function* openThread(draft: IEnvironment, threadId: string): IActionGenerator {
  const session = yield* sessionOf(draft, threadId);
  const held = draft.Replica.OpenThreads[threadId];
  if (held !== undefined) yield* resumeThread(held);
  else {
    draft.Replica.OpenThreads[threadId] = yield* entity<IOpenThread>(
      getDefaultOpenThread(draft.EnvironmentId, threadId),
    );
    yield* openThreadStream(draft.Replica.OpenThreads[threadId]!);
  }
  yield* start(reattachThread, session.$Id);
}

/** `retain` is false for a thread that stays on screen beside the new selection. */
function* leaveThread(draft: IEnvironment, threadId: string, retain = true): IActionGenerator {
  const held = draft.Replica.OpenThreads[threadId];
  if (held !== undefined && retain) yield* retainThread(held);
  const session = draft.Local.ThreadSessions[threadId];
  if (session !== undefined) yield* start(detachThread, session);
  yield* releaseSide(draft, session);
}

function* releaseSide(draft: IEnvironment, host: IThreadSession | undefined): IActionGenerator {
  const side = host?.Panels.Side?.ThreadId;
  if (side !== undefined && side !== draft.Local.SelectedThreadId) yield* leaveThread(draft, side);
}

function sideOfSelected(draft: IEnvironment): string | null {
  const selected = draft.Local.ThreadSessions[draft.Local.SelectedThreadId ?? ""];
  return selected?.Panels.Side?.ThreadId ?? null;
}

// Follows openSideThread in apps/web/src/lib/sideChatPane.ts and the parent check in
// onOpenThread in apps/web/src/components/chat/useThreadLifecycle.tsx.
/** Opens a subagent or side chat beside the selected thread, or in its place, by the setting and `intent`. */
export function* openSideThread(
  draft: IEnvironment,
  threadId: string,
  intent: SideThreadOpenIntent,
): IActionGenerator {
  const hostId = draft.Local.SelectedThreadId;
  const host = hostId === null ? undefined : draft.Local.ThreadSessions[hostId];
  const parentId =
    hostId === null
      ? null
      : (draft.Replica.OpenThreads[hostId]?.Thread?.lineage.parentThreadId ?? null);
  const panelAvailable =
    host !== undefined &&
    host.NewThreadProjectId === null &&
    threadId !== hostId &&
    threadId !== parentId;
  const target = resolveSideThreadOpenTarget({
    preference: draft.Local.ClientSettings?.sideThreadOpenTarget ?? "panel",
    intent,
    panelAvailable,
  });
  if (target === "main" || host === undefined) {
    if (host?.Panels.Side?.ThreadId === threadId) host.Panels.Side = null;
    yield* selectThread(draft, threadId);
    return;
  }
  yield* showSideThread(draft, host, threadId);
}

function* showSideThread(
  draft: IEnvironment,
  host: IThreadSession,
  threadId: string,
): IActionGenerator {
  const held = host.Panels.Side?.ThreadId;
  if (held === threadId) return;
  host.Panels.Side = { ThreadId: threadId };
  host.Panels.Diff = null;
  host.Panels.Launcher.Open = false;
  if (held !== undefined) yield* hideSideThread(draft, held, true);
  if (host.ThreadId === draft.Local.SelectedThreadId) yield* openThread(draft, threadId);
}

function* hideSideThread(
  draft: IEnvironment,
  threadId: string,
  discard: boolean,
): IActionGenerator {
  if (threadId !== draft.Local.SelectedThreadId) yield* leaveThread(draft, threadId);
  if (!discard) return;
  const thread =
    draft.Replica.OpenThreads[threadId]?.Thread ?? draft.Replica.Shell.Threads[threadId];
  if (sideThreadKindOf(thread) === "side-chat") yield* start(discardSideChat, draft, threadId);
}

function* discardSideChat(draft: IEnvironment, threadId: string): IOpenGenerator {
  try {
    yield* threadCommand(draft, threadId, { Kind: "delete", OnlyIfUnused: true });
  } catch (error) {
    serverError(error);
  }
}

export function* closeSideThread(draft: IEnvironment): IActionGenerator {
  const host = draft.Local.ThreadSessions[draft.Local.SelectedThreadId ?? ""];
  if (host !== undefined) yield* start(hideSide, host, true);
}

// Follows resolveThreadOpenRoute in apps/web/src/lib/sideChatPane.ts.
/** A link to a thread opens it, or for a side chat, its parent with the side chat beside it. */
export function* openThreadLink(draft: IEnvironment, threadId: string): IActionGenerator {
  const lineage = draft.Replica.Shell.Threads[threadId]?.lineage;
  const parentId = lineage?.sideChat === true ? lineage.parentThreadId : null;
  yield* selectThread(draft, parentId ?? threadId);
  const host = parentId === null ? undefined : draft.Local.ThreadSessions[parentId];
  if (host !== undefined) yield* showSideThread(draft, host, threadId);
}

// Follows useSideChat in apps/web/src/components/chat/useSideChat.ts, which always opens the
// side chat beside its thread.
/** Forks the selected thread's latest stable point into a side chat, carrying the composer's picks. */
export function* startSideChat(draft: IEnvironment): IOpenGenerator {
  const hostId = draft.Local.SelectedThreadId;
  const picked = hostId === null ? undefined : draft.Local.ThreadSessions[hostId];
  if (hostId === null || picked === undefined) return;
  delete picked.SideChatError;
  const picks = JSON.parse(
    JSON.stringify({ ModelSelection: picked.ModelSelection, RuntimeMode: picked.RuntimeMode }),
  ) as Pick<IThreadSession, "ModelSelection" | "RuntimeMode">;
  const targetThreadId = yield* generateGuid();
  const environmentId = draft.EnvironmentId;
  try {
    yield* open(
      withCommandId((commandId) =>
        forkThreadEffect({
          EnvironmentId: environmentId,
          CommandId: commandId,
          SourceThreadId: hostId,
          TargetThreadId: targetThreadId,
          RunId: null,
          Title: "Side chat",
        }),
      ),
    );
  } catch (error) {
    const held = draft.Local.ThreadSessions[hostId];
    if (held !== undefined) held.SideChatError = serverError(error).message;
    return;
  }
  const side = yield* sessionOf(draft, targetThreadId);
  side.ModelSelection = picks.ModelSelection;
  side.RuntimeMode = picks.RuntimeMode;
  const host = draft.Local.ThreadSessions[hostId];
  if (host !== undefined) yield* showSideThread(draft, host, targetThreadId);
}
leading(startSideChat);

export function* closeThread(draft: IEnvironment, threadId: string): IActionGenerator {
  delete draft.Replica.OpenThreads[threadId];
  const session = draft.Local.ThreadSessions[threadId];
  if (session !== undefined) yield* start(detachThread, session);
}

/** `searchQuery` is the palette query that picked the thread, which the server learns for ranking. */
export function* selectThread(
  draft: IEnvironment,
  threadId: string,
  searchQuery?: string,
): IActionGenerator {
  const covered = draft.Local.View !== null;
  if (covered) yield* showView(draft, null);
  const changed = draft.Local.SelectedThreadId !== threadId;
  if (changed) yield* showThread(draft, threadId);
  yield* syncAddress(draft);
  if (!changed && covered) {
    const session = draft.Local.ThreadSessions[threadId];
    if (session !== undefined) yield* start(followCheckout, session);
  }
  if (changed || covered) {
    const options = searchQuery ? { Opened: true, SearchQuery: searchQuery } : { Opened: true };
    yield* start(visitShown, draft.Replica.Shell, options);
  }
}

function* showThread(draft: IEnvironment, threadId: string): IActionGenerator {
  const previous = draft.Local.SelectedThreadId;
  draft.Local.SelectedThreadId = threadId;
  yield* resource(draft, "Notify/Device").opened(threadId);
  if (previous !== null) yield* leaveThread(draft, previous, previous !== sideOfSelected(draft));
  if (draft.Local.ThreadSessions[threadId]?.NewThreadProjectId != null) return;
  yield* openThread(draft, threadId);
  const side = sideOfSelected(draft);
  if (side !== null) yield* openThread(draft, side);
}

function carriedModel(draft: IEnvironment, destination: string): IWireModelSelection | null {
  const source = draft.Local.SelectedThreadId;
  if (source === null || source === destination) return null;
  const session = draft.Local.ThreadSessions[source];
  if (session?.ModelSelection != null) return session.ModelSelection;
  if (session?.NewThreadProjectId != null) return session.SeededModel;
  return (
    draft.Replica.OpenThreads[source]?.Thread?.modelSelection ??
    draft.Replica.Shell.Threads[source]?.modelSelection ??
    null
  );
}

/** `reseed` is the New thread action's; returning to a held draft keeps its seed, as stock's route does. */
function* newThreadSession(
  draft: IEnvironment,
  projectId: string,
  reseed = false,
): IActionGenerator<string> {
  const existing = Object.values(draft.Local.ThreadSessions).find(
    (session) => session.NewThreadProjectId === projectId,
  );
  const threadId =
    existing?.ThreadId ??
    (yield* storedNewThreadEffect({ ProjectId: projectId })) ??
    (yield* generateGuid());
  const carry = carriedModel(draft, threadId);
  const session = yield* sessionOf(draft, threadId, projectId);
  if (session.ModelSelection !== null || (existing !== undefined && !reseed)) return threadId;
  const last = (yield* rememberedModelsEffect()).Last;
  const offered = draft.Replica.Providers.some(
    (provider) =>
      provider.InstanceId === last?.instanceId &&
      provider.Models.some((model) => model.Slug === last.model),
  );
  const config = draft.Replica.Config;
  const override =
    config === null
      ? carry
      : newThreadModelOverride(
          {
            Config: config,
            ProjectId: projectId,
            Project: draft.Replica.Shell.Projects[projectId],
            Now: yield* clockNowEffect(),
          },
          carry,
          offered,
        );
  const chosen = override ?? (offered ? last : null);
  session.SeededModel = chosen === null ? null : JSON.parse(JSON.stringify(chosen));
  return threadId;
}

export function* newThread(draft: IEnvironment, projectId: string): IActionGenerator {
  yield* selectThread(draft, yield* newThreadSession(draft, projectId, true));
}

/** Drops what only this client holds for a deleted thread; the streams remove its replica rows. */
function* forgetSession(draft: IEnvironment, threadId: string): IActionGenerator {
  yield* storeDraftEffect({ ThreadId: threadId, Draft: null });
  yield* storeDraftFilesEffect({ ThreadId: threadId, Files: [] });
  yield* dropDictation(draft.Local.Dictation, threadId);
  if (draft.Local.SelectedThreadId === threadId)
    yield* releaseSide(draft, draft.Local.ThreadSessions[threadId]);
  delete draft.Local.ThreadSessions[threadId];
  for (const session of Object.values(draft.Local.ThreadSessions)) {
    if (session.Panels.Side?.ThreadId === threadId) session.Panels.Side = null;
  }
  yield* rememberTerminalEffect({ ThreadId: threadId, Launch: null });
  if (draft.Local.SelectedThreadId === threadId) {
    draft.Local.SelectedThreadId = null;
    yield* syncAddress(draft, false);
  }
}

// Follows the failure toasts of the thread actions in apps/web/src/components/Sidebar.tsx and
// ArchivedThreadsPanel.tsx.
const COMMAND_FAILURES: Partial<Record<IThreadCommand["Kind"], string>> = {
  settle: "Failed to settle thread",
  unsettle: "Failed to un-settle thread",
  snooze: "Failed to snooze thread",
  unsnooze: "Failed to wake thread",
  pin: "Failed to pin thread",
  unpin: "Failed to unpin thread",
  reorderPin: "Failed to reorder pinned threads",
  rename: "Failed to rename thread",
  regenerateTitle: "Failed to regenerate thread title",
  markUnread: "Failed to mark thread unread",
  archive: "Failed to archive thread",
  unarchive: "Failed to unarchive thread",
  delete: "Failed to delete thread",
};

/** Sends a thread command; a refusal shows as a toast, and the result says whether it went through. */
export function* threadCommand(
  draft: IEnvironment,
  threadId: string,
  command: IThreadCommand,
): IOpenGenerator<boolean> {
  const environmentId = draft.EnvironmentId;
  try {
    yield* open(
      withCommandId((commandId) =>
        threadCommandEffect({
          EnvironmentId: environmentId,
          ThreadId: threadId,
          CommandId: commandId,
          Command: command,
        }),
      ),
    );
  } catch (error) {
    yield* toast({
      Kind: "error",
      Title: COMMAND_FAILURES[command.Kind] ?? "That didn't work",
      Description: serverError(error).message,
    });
    return false;
  }
  // Only an open thread's stream reports a deletion; the shell doesn't say why a row left.
  if (command.Kind === "delete" && command.OnlyIfUnused !== true)
    yield* forgetSession(draft, threadId);
  return true;
}

// Follows the reorder-pinned plan in apps/web/src/components/Sidebar.tsx, which writes the moved
// thread's key between its new neighbours, or respreads the keys when they leave no room.
/** Moves a pinned thread to its place in `order`, the pinned threads it now sits among. */
export function* reorderPin(
  draft: IEnvironment,
  threadId: string,
  order: string[],
): IOpenGenerator {
  const keysById = new Map(
    Object.values(draft.Replica.Shell.Threads)
      .filter((thread) => thread.pinnedAt != null)
      .map((thread) => [thread.id, thread.pinOrderKey] as const),
  );
  const writes = planPinnedReorder({ orderedIds: order, keysById, movedId: threadId });
  for (const write of writes) {
    if (!(yield* threadCommand(draft, write.id, { Kind: "reorderPin", OrderKey: write.orderKey })))
      return;
  }
}

// Follows attemptSettle and planForwardNavigation in apps/web/src/components/Sidebar.tsx.
/** Settles a thread and, when it's the open one, moves on to the next unparked row or a new thread. */
export function* settleThread(draft: IEnvironment, threadId: string): IOpenGenerator {
  yield* settleThreads(draft, [threadId]);
}

// Follows settleThreads in apps/web/src/components/Sidebar.tsx, whose co-settling threads the
// open one's move skips.
export function* settleThreads(draft: IEnvironment, threadIds: string[]): IOpenGenerator {
  const unsettled = threadIds.filter(
    (id) => draft.Replica.Shell.Threads[id]?.settledOverride !== "settled",
  );
  const openId = draft.Local.SelectedThreadId;
  const advance =
    openId !== null && unsettled.includes(openId)
      ? yield* threadAfterSettling(draft, openId, new Set(unsettled))
      : null;
  for (const threadId of unsettled) {
    const settled = yield* threadCommand(draft, threadId, { Kind: "settle" });
    if (threadId !== openId || !settled || advance === null) continue;
    if (draft.Local.SelectedThreadId !== threadId) continue;
    if (advance.ThreadId !== null) yield* selectThread(draft, advance.ThreadId);
    else yield* newThread(draft, advance.ProjectId);
  }
}

function* threadAfterSettling(
  draft: IEnvironment,
  threadId: string,
  settling: ReadonlySet<string>,
): IActionGenerator<{ ThreadId: string | null; ProjectId: string } | null> {
  const thread = draft.Replica.Shell.Threads[threadId];
  if (thread === undefined) return null;
  const { Order, Sections } = yield* sidebarLayout(draft);
  const parked = new Set<string>([
    ...settling,
    ...[...Sections.Settled, ...Sections.Snoozed].map((row) => row.id),
  ]);
  const index = Order.indexOf(threadId);
  const next =
    index === -1
      ? undefined
      : [...Order.slice(index + 1), ...Order.slice(0, index)].find((id) => !parked.has(id));
  return { ThreadId: next ?? null, ProjectId: thread.projectId };
}

// Follows archiveThread in apps/web/src/hooks/useThreadActions.ts.
/** Archives a thread; the open one gives way to a new thread in its project. */
export function* archiveThread(draft: IEnvironment, threadId: string): IOpenGenerator {
  const projectId = draft.Replica.Shell.Threads[threadId]?.projectId;
  const wasOpen = draft.Local.SelectedThreadId === threadId;
  if (!(yield* threadCommand(draft, threadId, { Kind: "archive" }))) return;
  if (wasOpen && projectId !== undefined && draft.Local.SelectedThreadId === threadId)
    yield* newThread(draft, projectId);
}

// Follows the regenerate-title actions in apps/web/src/components/Sidebar.tsx and
// useThreadActionMenu.ts, which skip a thread whose title is already regenerating.
export function* regenerateTitles(draft: IEnvironment, threadIds: string[]): IOpenGenerator {
  const sent: Array<{ ThreadId: string; RequestId: string }> = [];
  for (const threadId of threadIds) {
    const row = draft.Replica.Shell.Threads[threadId];
    if (row === undefined || row.titleRegeneration != null) continue;
    const requestId = yield* generateGuid();
    if (yield* threadCommand(draft, threadId, { Kind: "regenerateTitle", RequestId: requestId }))
      sent.push({ ThreadId: threadId, RequestId: requestId });
  }
  if (sent.length > 0) yield* start(trackTitleRegenerations, draft.Replica.Shell, sent);
}

/** The shortcut's toggle: un-settles the open thread when it's settled, else settles and moves on. */
export function* toggleSettleOpenThread(draft: IEnvironment): IOpenGenerator {
  const threadId = draft.Local.SelectedThreadId;
  const thread = threadId === null ? undefined : draft.Replica.Shell.Threads[threadId];
  if (thread === undefined) return;
  if (thread.settledOverride === "settled")
    yield* threadCommand(draft, thread.id, { Kind: "unsettle" });
  else yield* settleThread(draft, thread.id);
}

function* sendProjectCommand(
  environmentId: string,
  projectId: string,
  command: IProjectCommand,
): IOpenGenerator {
  yield* open(
    withCommandId((commandId) =>
      projectCommandEffect({
        EnvironmentId: environmentId,
        ProjectId: projectId,
        CommandId: commandId,
        Command: command,
      }),
    ),
  );
}

// Follows the project failure toasts in apps/web/src/components/settings/ProjectSettingsPanel.tsx,
// apps/web/src/hooks/useProjectGroupUpdate.ts and useRemoveClonedProject.ts.
const PROJECT_FAILURES: Partial<Record<IProjectCommand["Kind"], string>> = {
  pin: "Failed to pin project",
  unpin: "Failed to unpin project",
  archive: "Failed to archive project",
  unarchive: "Failed to unarchive project",
  rename: "Failed to rename project",
  delete: "Failed to remove project",
};

/** Sends a project command; a refusal shows as a toast. */
export function* projectCommand(
  draft: IEnvironment,
  projectId: string,
  command: IProjectCommand,
): IOpenGenerator {
  try {
    yield* sendProjectCommand(draft.EnvironmentId, projectId, command);
  } catch (error) {
    yield* toast({
      Kind: "error",
      Title: PROJECT_FAILURES[command.Kind] ?? "That didn't work",
      Description: serverError(error).message,
    });
    return;
  }
  if (command.Kind !== "delete") return;
  const drafts = Object.values(draft.Local.ThreadSessions)
    .filter((session) => session.NewThreadProjectId === projectId)
    .map((session) => session.ThreadId);
  for (const threadId of drafts) yield* forgetSession(draft, threadId);
}

// Follows removeMembers in apps/web/src/components/settings/ProjectSettingsPanel.tsx.
export function* removeProject(
  draft: IEnvironment,
  projectId: string,
): IOpenGenerator<string | null> {
  // Read before the wait: the shell stream can remove the project's rows while it runs.
  const threadIds = new Set<string>(
    Object.values(draft.Replica.Shell.Threads)
      .filter((thread) => thread.projectId === projectId)
      .map((thread) => thread.id),
  );
  for (const session of Object.values(draft.Local.ThreadSessions)) {
    if (session.NewThreadProjectId === projectId) threadIds.add(session.ThreadId);
  }
  try {
    yield* sendProjectCommand(draft.EnvironmentId, projectId, { Kind: "delete", Force: true });
  } catch (error) {
    return serverError(error).message;
  }
  for (const threadId of threadIds) yield* forgetSession(draft, threadId);
  return null;
}
leading(removeProject);

// Follows "Unable to reveal file" in apps/web/src/components/chat/MarkdownFileLink.tsx.
export function* openInFileManager(draft: IEnvironment, path: string): IOpenGenerator {
  try {
    yield* open(openInFileManagerEffect({ EnvironmentId: draft.EnvironmentId, Path: path }));
  } catch (error) {
    yield* toast({
      Kind: "error",
      Title: "Unable to reveal file",
      Description: serverError(error).message,
    });
  }
}

// Follows "Unable to open file" in apps/web/src/components/chat/MarkdownFileLink.tsx.
export function* openInEditor(
  draft: IEnvironment,
  path: string,
  projectRoot: string | null,
): IOpenGenerator {
  const stored = draft.Local.Editor;
  let opened: string;
  try {
    opened = yield* open(
      openInEditorEffect({
        EnvironmentId: draft.EnvironmentId,
        Path: path,
        ProjectRoot: projectRoot,
        Stored: stored,
      }),
    );
  } catch (error) {
    yield* toast({
      Kind: "error",
      Title: "Unable to open file",
      Description: serverError(error).message,
    });
    return;
  }
  if (opened !== stored) yield* preferEditor(draft, opened);
}

export function* preferEditor(draft: IEnvironment, editor: string): IActionGenerator {
  draft.Local.Editor = editor;
  yield* storeEditorEffect({ Editor: editor });
}

/** The editors the server reports installed, which change only with a server restart. */
export function* editors(draft: IEnvironment): ISelectorGenerator<IEditors> {
  return editorChoices(
    draft.Replica.Config?.availableEditors ?? [],
    draft.Local.Editor,
    typeof navigator === "undefined" ? "" : navigator.platform,
  );
}

// Follows handleAddProjectForEnvironment in apps/web/src/components/CommandPalette.tsx.
export function* addFolder(
  draft: IEnvironment,
  workspaceRoot: string,
): IOpenGenerator<string | null> {
  const environmentId = draft.EnvironmentId;
  const existing = findProjectByPath(Object.values(draft.Replica.Shell.Projects), workspaceRoot);
  const created = existing === undefined;
  const archived = existing?.archivedAt != null;
  const projectId = existing?.id ?? (yield* generateGuid());
  try {
    if (created) {
      yield* sendProjectCommand(environmentId, projectId, {
        Kind: "create",
        Title: inferProjectTitleFromPath(workspaceRoot),
        WorkspaceRoot: workspaceRoot,
      });
    } else if (archived) {
      yield* sendProjectCommand(environmentId, projectId, { Kind: "unarchive" });
    }
  } catch (error) {
    return serverError(error).message;
  }
  const project = draft.Replica.Shell.Projects[projectId];
  if (!created && project === undefined) {
    return "This project was removed while it was being added.";
  }
  const latest =
    project === undefined || created
      ? null
      : getLatestThreadForProject(
          Object.values(draft.Replica.Shell.Threads).map(toSortableThread),
          project.id,
          "updated_at",
        );
  if (latest !== null && latest.settledOverride !== "settled")
    yield* selectThread(draft, latest.id);
  else yield* newThread(draft, projectId);
  return null;
}
leading(addFolder);

// Follows submitAddProjectCloneFlow in apps/web/src/components/CommandPalette.tsx.
export function* cloneProject(
  draft: IEnvironment,
  remoteUrl: string,
  destinationPath: string,
): IOpenGenerator<string | null> {
  const environmentId = draft.EnvironmentId;
  const projectId = yield* generateGuid();
  try {
    yield* open(
      startCloneEffect({
        EnvironmentId: environmentId,
        ProjectId: projectId,
        Title: inferProjectTitleFromPath(destinationPath),
        RemoteUrl: remoteUrl,
        DestinationPath: destinationPath,
      }),
    );
  } catch (error) {
    return serverError(error).message;
  }
  yield* newThread(draft, projectId);
  return null;
}
leading(cloneProject);

// Follows useNewProject in apps/web/src/hooks/useNewProject.ts.
export function* newProject(
  draft: IEnvironment,
  name: string,
): IOpenGenerator<{ Error: string } | INewProject> {
  const environmentId = draft.EnvironmentId;
  let created: INewProject;
  try {
    created = yield* open(newProjectEffect({ EnvironmentId: environmentId, Name: name }));
  } catch (error) {
    return { Error: serverError(error).message };
  }
  yield* newThread(draft, created.ProjectId);
  return created;
}
leading(newProject);
export const AddingProject = workTag("Environment/AddingProject");
AddingProject.mark(addFolder, cloneProject, newProject);

export function* cloneControl(
  draft: IEnvironment,
  projectId: string,
  kind: "cancel" | "retry",
): IOpenGenerator {
  const environmentId = draft.EnvironmentId;
  try {
    yield* open(
      cloneControlEffect({ EnvironmentId: environmentId, ProjectId: projectId, Kind: kind }),
    );
  } catch (error) {
    // Follows runCloneAction in apps/web/src/components/ProjectCloneToastCoordinator.tsx.
    yield* toast({
      Kind: "error",
      Title: kind === "cancel" ? "Failed to cancel clone" : "Failed to retry clone",
      Description: serverError(error).message,
    });
  }
}
leading(cloneControl);

export function* selectedOpenThread(draft: IEnvironment): ISelectorGenerator<IOpenThread | null> {
  const id = draft.Local.SelectedThreadId;
  return id === null ? null : (draft.Replica.OpenThreads[id] ?? null);
}

export function* selectedDraftSession(
  draft: IEnvironment,
): ISelectorGenerator<IThreadSession | null> {
  const id = draft.Local.SelectedThreadId;
  const session = id === null ? undefined : draft.Local.ThreadSessions[id];
  return session?.NewThreadProjectId == null ? null : session;
}

export interface IPanelShortcuts extends IPanels {
  SessionId: string;
}

/** Null while no thread view is on screen. */
export function* panelShortcuts(draft: IEnvironment): ISelectorGenerator<IPanelShortcuts | null> {
  const id = draft.Local.SelectedThreadId;
  if (draft.Local.View !== null || id === null) return null;
  const session = draft.Local.ThreadSessions[id];
  if (draft.Replica.OpenThreads[id] === undefined || session === undefined) return null;
  const shown = yield* select(panels, (held: IEnvironment) => held.Local.ThreadSessions[id]!);
  return { SessionId: session.$Id, ...shown };
}

export function* currentProjectId(draft: IEnvironment): ISelectorGenerator<string | null> {
  const id = draft.Local.SelectedThreadId;
  if (id === null) return null;
  return threadProjectId(draft.Replica, id, draft.Local.ThreadSessions[id]?.NewThreadProjectId);
}

/** The user's keybindings, merged with the defaults by the server. */
export function* keybindings(draft: IEnvironment): ISelectorGenerator<ResolvedKeybindingsConfig> {
  const held = draft.Replica.Config?.keybindings as unknown as
    | ResolvedKeybindingsConfig
    | undefined;
  return held ?? DEFAULT_RESOLVED_KEYBINDINGS;
}

export function* addProjectSettings(
  draft: IEnvironment,
): ISelectorGenerator<IAddProjectSettings | null> {
  const config = draft.Replica.Config;
  return config === null ? null : addProjectSettingsOf(config);
}

export function* activeProjects(draft: IEnvironment): ISelectorGenerator<IWireProject[]> {
  return Object.values(draft.Replica.Shell.Projects).filter(
    (project) => project.archivedAt == null,
  );
}

export function* currentProjectRoot(draft: IEnvironment): ISelectorGenerator<string | null> {
  const projectId = yield* currentProjectId(draft);
  return projectId === null
    ? null
    : (draft.Replica.Shell.Projects[projectId]?.workspaceRoot ?? null);
}

export const EnvironmentReceiver = receiver<IEnvironment>("EnvironmentReceiver")({
  *"Server/Config"(draft, message) {
    if (!isEnded(message)) applyConfigEvent(draft, message.Item);
    // A batch the receiver failed would fail again on every reopen.
    else if (message.$Ended.Reason !== "receiver-failed") {
      yield* startTimer(draft, "Server/ConfigReopen", EnvironmentReceiver, CONFIG_REOPEN_MS);
    }
  },
  *"Server/ConfigReopen"(draft) {
    yield* stopTimer(draft, "Server/ConfigReopen");
    yield* openConfigStream(draft);
  },
  *"Shell/Notify"(draft, { Notes }) {
    const inApp = draft.Local.ClientSettings?.inAppNotificationsEnabled === true;
    for (const note of Notes) {
      const viewing = draft.Local.SelectedThreadId === note.ThreadId && draft.Local.View === null;
      yield* resource(draft, "Notify/Device").show({ ...note, InApp: inApp, Viewing: viewing });
    }
  },
  *"Notify/Device"(draft, message) {
    if (isEnded(message)) return;
    yield* start(selectThread, draft, message.Opened);
  },
  *"Thread/Deleted"(draft, { ThreadId }) {
    delete draft.Replica.OpenThreads[ThreadId];
    yield* forgetSession(draft, ThreadId);
  },
  // Follows ThreadRouteView in apps/web/src/components/ThreadRouteView.tsx, which leaves a
  // missing thread for home, replacing its address.
  *"Thread/Missing"(draft, { ThreadId }) {
    if (draft.Local.SelectedThreadId === ThreadId)
      yield* releaseSide(draft, draft.Local.ThreadSessions[ThreadId]);
    yield* closeThread(draft, ThreadId);
    for (const session of Object.values(draft.Local.ThreadSessions)) {
      if (session.Panels.Side?.ThreadId === ThreadId) session.Panels.Side = null;
    }
    if (draft.Local.SelectedThreadId !== ThreadId) return;
    draft.Local.SelectedThreadId = null;
    yield* syncAddress(draft, false);
  },
  *"Thread/RequestsSettled"(draft, { ThreadId, PendingIds, UnansweredIds }) {
    const session = draft.Local.ThreadSessions[ThreadId];
    if (session !== undefined) yield* start(settleQuestions, session, PendingIds, UnansweredIds);
    yield* rememberCompactionDismissal(draft, ThreadId);
  },
  *"Thread/CheckoutChanged"(draft, { ThreadId }) {
    const session = draft.Local.ThreadSessions[ThreadId];
    if (session !== undefined) yield* start(followCheckout, session);
  },
  *"Thread/WorkspaceChanged"(draft, { ThreadId }) {
    const session = draft.Local.ThreadSessions[ThreadId];
    if (session?.Panels.Diff != null) yield* start(followWorkspace, session);
  },
  *"Shell/ProjectsChanged"(draft) {
    const session = draft.Local.ThreadSessions[draft.Local.SelectedThreadId ?? ""];
    if (session !== undefined) yield* start(followCheckout, session);
  },
  *"Details/Pinned"(draft, { Open }) {
    yield* setPreferences(draft, { DetailsOpen: Open });
  },
  *"Side/Hidden"(draft, { ThreadId, Discard }) {
    yield* hideSideThread(draft, ThreadId, Discard);
  },
  *"Git/StatusFollowed"(draft) {
    yield* start(reportActivity, draft);
  },
  *"Thread/RewindProgress"(draft, { ThreadId }) {
    const session = draft.Local.ThreadSessions[ThreadId];
    if (session !== undefined) yield* start(checkRewind, session);
  },
  *"Thread/Forked"(draft, { ThreadId }) {
    yield* selectThread(draft, ThreadId);
  },
  *"Thread/MergedBack"(draft, { ThreadId }) {
    yield* selectThread(draft, ThreadId);
  },
  *"Shell/ThreadsDropped"(draft) {
    for (const thread of Object.values(draft.Replica.OpenThreads))
      yield* start(lookUpLineageTitles, thread);
  },
  *"Thread/Expired"(draft, { ThreadId }) {
    if (draft.Local.SelectedThreadId !== ThreadId && sideOfSelected(draft) !== ThreadId)
      yield* closeThread(draft, ThreadId);
  },
  *"Dictation/TranscriptRefused"(draft, { ThreadId }) {
    yield* start(refuseTranscript, draft.Local.Dictation, ThreadId);
  },
  *"Dictation/Commit"(draft, { ThreadId, Before, Text, Mode }) {
    const session = draft.Local.ThreadSessions[ThreadId];
    if (session === undefined) yield* start(refuseTranscript, draft.Local.Dictation, ThreadId);
    else yield* start(applyTranscript, session, Before, Text, Mode);
  },
  *"Thread/Started"(draft, { ThreadId }) {
    if (draft.Local.SelectedThreadId !== ThreadId) return;
    yield* openThread(draft, ThreadId);
    yield* syncAddress(draft, false);
  },
  *"Device/History"(draft, message) {
    if (!isEnded(message)) yield* followAddress(draft, message.Address);
  },
});

export default createEntityFeature<IEnvironment>("Environment")(
  {
    selectThread,
    openSideThread,
    openThreadLink,
    closeSideThread,
    startSideChat,
    newThread,
    threadCommand,
    reorderPin,
    settleThread,
    settleThreads,
    archiveThread,
    regenerateTitles,
    toggleSettleOpenThread,
    projectCommand,
    addFolder,
    cloneProject,
    newProject,
    cloneControl,
    toggleModelFavorite,
    removeProject,
    openInFileManager,
    openInEditor,
    preferEditor,
    openView,
    writeSetting,
    chooseNotificationMode,
    updateServerSettings,
    autoRefreshLimits,
    setPreferences,
    setProjectHidden,
    toggleFolder,
    toggleProjectScope,
    toggleShelf,
    toggleViewportDebug,
    showMoreSettled,
    setAppearanceMode,
    startDictation,
    setVoiceDestination,
  },
  {
    sidebarLayout,
    projectSort,
    minute,
    colorScheme,
    selectedOpenThread,
    selectedDraftSession,
    panelShortcuts,
    currentProjectId,
    currentProjectRoot,
    activeProjects,
    keybindings,
    addProjectSettings,
    editors,
    timestampFormat,
    wordWrap,
    confirmThreadUnpin,
    confirmThreadArchive,
    confirmThreadDelete,
    sendShortcut,
  },
);
