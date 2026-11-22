import {
  findProjectByPath,
  inferProjectTitleFromPath,
} from "@t3tools/client-runtime/state/projects";
import { getLatestThreadForProject } from "@t3tools/client-runtime/state/thread-sort";
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
  start,
  startTimer,
  stopTimer,
} from "treflex";
import { createEntityFeature } from "treflex-solid";

import { followActivity } from "./Activity";
import { addressThread, addressView, setAddressThread } from "./Infrastructure/address";
import type { IDeviceActivity } from "./Infrastructure/clientActivity";
import {
  cloneControlEffect,
  type INewProject,
  type IProjectCommand,
  type IThreadCommand,
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
import { editorChoices, type IEditors } from "./editors";
import { getDefaultGitWork, type IGitWork } from "./GitWork";
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
import { type IWireClientSettings, storedClientSettingsEffect } from "./Infrastructure/settings";
import { rememberTerminalEffect } from "./Infrastructure/terminalMemory";
import {
  getDefaultOpenThread,
  type IOpenThread,
  latestDiffTurn,
  openThreadStream,
  resumeThread,
  retainThread,
} from "./OpenThread";
import {
  applyConfigEvent,
  archivedThreadCommand,
  autoRefreshLimits,
  loadUsage,
  openView,
  refreshUsage,
  showView,
  toggleModelFavorite,
  updateServerSettings,
  writeSetting,
} from "./Settings";
import { compactionDismissalKey, dismissedIn } from "./compaction";
import {
  cancelDictation,
  dictation,
  dropDictation,
  openDictation,
  refuseTranscript,
  sendAfterDictation,
  setVoiceDestination,
  startDictation,
  stopDictation,
} from "./Dictation";
import { serverError } from "./Infrastructure/serverError";
import { lookUpLineageTitles } from "./lineageTitles";
import { toSortableThread } from "./projectOrder";
import { getDefaultShell, type IShell, openShellStream, visitShown } from "./Shell";
import {
  checkRewind,
  detachThread,
  getDefaultThreadSession,
  type IReplica,
  type ISelection,
  type IThreadSession,
  reattachThread,
  restoreDraft,
  settleQuestions,
} from "./ThreadSession";

declare module "treflex" {
  interface IResourceRegistry {
    "Project/Clones": { Type: "projectClones" };
    "Server/Keybindings": { Type: "serverKeybindings" };
    "Server/Config": { Type: "serverConfigStream" };
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
    Archived: null,
    Usage: null,
  });
  const local = yield* entity<IEnvironment["Local"]>({
    SelectedThreadId: null,
    ThreadSessions: {},
    View: null,
    ClientSettings: yield* storedClientSettingsEffect(),
    Preferences: yield* storedPreferencesEffect(),
    Shelves: { SnoozedOpen: false, SettledOpen: false, SettledShown: SETTLED_PAGE },
    Now: yield* clockNowEffect(),
    SystemDark: false,
    Activity: { Visible: false, Focused: false, RecentlyInteracted: false },
    ViewportDebug: false,
    Editor: yield* storedEditorEffect(),
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
  yield* openShellStream(draft.Replica.Shell);
  yield* openResource(draft, "Project/Clones", {
    Type: "projectClones",
    EnvironmentId: draft.EnvironmentId,
  });
  yield* openResource(draft.Replica.Shell, "Project/Favicons", {
    Type: "projectFavicons",
    EnvironmentId: draft.EnvironmentId,
  });
  yield* openResource(draft, "Server/Keybindings", {
    Type: "serverKeybindings",
    EnvironmentId: draft.EnvironmentId,
  });
  yield* openConfigStream(draft);
  yield* openDictation(draft);
  // A restored address isn't an open, and its thread's row hasn't arrived yet: the shell
  // receiver visits a due completion once the row lands and no page covers it.
  const selected = yield* addressThread();
  if (selected !== null) yield* showThread(draft, selected);
  const view = yield* addressView();
  if (view !== null) yield* showView(draft, view);
}

function* sessionOf(
  draft: IEnvironment,
  threadId: string,
  newThreadProjectId: string | null = null,
): IActionGenerator<IThreadSession> {
  const held = draft.Local.ThreadSessions[threadId];
  if (held !== undefined) return held;
  const git = yield* entity<IGitWork>(getDefaultGitWork());
  draft.Local.ThreadSessions[threadId] = yield* entity<IThreadSession>({
    ...getDefaultThreadSession(draft.EnvironmentId, threadId, newThreadProjectId),
    Git: git,
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

function* leaveThread(draft: IEnvironment, threadId: string): IActionGenerator {
  const held = draft.Replica.OpenThreads[threadId];
  if (held !== undefined) yield* retainThread(held);
  const session = draft.Local.ThreadSessions[threadId];
  if (session !== undefined) yield* start(detachThread, session);
}

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
  if (changed || covered) {
    const options = searchQuery ? { Opened: true, SearchQuery: searchQuery } : { Opened: true };
    yield* start(visitShown, draft.Replica.Shell, options);
  }
}

function* showThread(draft: IEnvironment, threadId: string): IActionGenerator {
  const previous = draft.Local.SelectedThreadId;
  draft.Local.SelectedThreadId = threadId;
  if (previous !== null) yield* leaveThread(draft, previous);
  if (draft.Local.ThreadSessions[threadId]?.NewThreadProjectId != null) {
    yield* setAddressThread(null);
    return;
  }
  yield* openThread(draft, threadId);
  yield* setAddressThread(threadId);
}

export function* newThread(draft: IEnvironment, projectId: string): IActionGenerator {
  const existing = Object.values(draft.Local.ThreadSessions).find(
    (session) => session.NewThreadProjectId === projectId,
  );
  const threadId =
    existing?.ThreadId ??
    (yield* storedNewThreadEffect({ ProjectId: projectId })) ??
    (yield* generateGuid());
  const session = yield* sessionOf(draft, threadId, projectId);
  if (existing === undefined && session.ModelSelection === null) {
    const last = (yield* rememberedModelsEffect()).Last;
    const offered = draft.Replica.Providers.some(
      (provider) =>
        provider.InstanceId === last?.instanceId &&
        provider.Models.some((model) => model.Slug === last.model),
    );
    if (offered) session.ModelSelection = last;
  }
  yield* selectThread(draft, threadId);
}

/** Drops what only this client holds for a deleted thread; the streams remove its replica rows. */
function* forgetSession(draft: IEnvironment, threadId: string): IActionGenerator {
  yield* storeDraftEffect({ ThreadId: threadId, Draft: null });
  yield* storeDraftFilesEffect({ ThreadId: threadId, Files: [] });
  yield* dropDictation(draft, threadId);
  delete draft.Local.ThreadSessions[threadId];
  yield* rememberTerminalEffect({ ThreadId: threadId, Launch: null });
  if (draft.Local.SelectedThreadId === threadId) {
    draft.Local.SelectedThreadId = null;
    yield* setAddressThread(null);
  }
}

export function* threadCommand(
  draft: IEnvironment,
  threadId: string,
  command: IThreadCommand,
): IOpenGenerator {
  const environmentId = draft.EnvironmentId;
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
  // Only an open thread's stream reports a deletion; the shell doesn't say why a row left.
  if (command.Kind === "delete") yield* forgetSession(draft, threadId);
}

// Follows attemptSettle and planForwardNavigation in apps/web/src/components/Sidebar.tsx.
/** Settles a thread and, when it's the open one, moves on to the next unparked row or a new thread. */
export function* settleThread(draft: IEnvironment, threadId: string): IOpenGenerator {
  const advance =
    draft.Local.SelectedThreadId === threadId ? yield* threadAfterSettling(draft, threadId) : null;
  yield* threadCommand(draft, threadId, { Kind: "settle" });
  if (advance === null || draft.Local.SelectedThreadId !== threadId) return;
  if (advance.ThreadId !== null) yield* selectThread(draft, advance.ThreadId);
  else yield* newThread(draft, advance.ProjectId);
}

function* threadAfterSettling(
  draft: IEnvironment,
  threadId: string,
): IActionGenerator<{ ThreadId: string | null; ProjectId: string } | null> {
  const thread = draft.Replica.Shell.Threads[threadId];
  if (thread === undefined) return null;
  const { Order, Sections } = yield* sidebarLayout(draft);
  const parked = new Set<string>([...Sections.Settled, ...Sections.Snoozed].map((row) => row.id));
  const index = Order.indexOf(threadId);
  const next =
    index === -1
      ? undefined
      : [...Order.slice(index + 1), ...Order.slice(0, index)].find((id) => !parked.has(id));
  return { ThreadId: next ?? null, ProjectId: thread.projectId };
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

export function* projectCommand(
  draft: IEnvironment,
  projectId: string,
  command: IProjectCommand,
): IOpenGenerator {
  yield* sendProjectCommand(draft.EnvironmentId, projectId, command);
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

export function* openInFileManager(draft: IEnvironment, path: string): IOpenGenerator {
  yield* open(openInFileManagerEffect({ EnvironmentId: draft.EnvironmentId, Path: path }));
}

export function* openInEditor(
  draft: IEnvironment,
  path: string,
  projectRoot: string | null,
): IOpenGenerator {
  const stored = draft.Local.Editor;
  const opened = yield* open(
    openInEditorEffect({
      EnvironmentId: draft.EnvironmentId,
      Path: path,
      ProjectRoot: projectRoot,
      Stored: stored,
    }),
  );
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

export function* cloneControl(
  draft: IEnvironment,
  projectId: string,
  kind: "cancel" | "retry",
): IOpenGenerator {
  const environmentId = draft.EnvironmentId;
  yield* open(
    cloneControlEffect({ EnvironmentId: environmentId, ProjectId: projectId, Kind: kind }),
  );
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

export interface IPanelShortcuts {
  SessionId: string;
  /** The details card has a checkout to show. */
  Details: boolean;
  Terminal: boolean;
  /** The thread has a turn to diff. */
  Diff: boolean;
  DiffOpen: boolean;
  RightPanelOpen: boolean;
}

/** The thread view's panels, for the panel shortcuts; null while no thread view is on screen. */
export function* panelShortcuts(draft: IEnvironment): ISelectorGenerator<IPanelShortcuts | null> {
  const id = draft.Local.SelectedThreadId;
  if (draft.Local.View !== null || id === null) return null;
  const thread = draft.Replica.OpenThreads[id];
  const session = draft.Local.ThreadSessions[id];
  if (thread === undefined || session === undefined) return null;
  const row = thread.Thread;
  return {
    SessionId: session.$Id,
    Details: row != null && draft.Replica.Shell.Projects[row.projectId] !== undefined,
    Terminal: row !== null,
    Diff: latestDiffTurn(thread) !== null,
    DiffOpen: session.Panels.Diff.Open,
    RightPanelOpen: session.Panels.Diff.Open || session.Panels.Launcher.Open,
  };
}

export function* currentProjectId(draft: IEnvironment): ISelectorGenerator<string | null> {
  const id = draft.Local.SelectedThreadId;
  if (id === null) return null;
  return (
    draft.Local.ThreadSessions[id]?.NewThreadProjectId ??
    draft.Replica.Shell.Threads[id]?.projectId ??
    null
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
  *"Thread/Deleted"(draft, { ThreadId }) {
    delete draft.Replica.OpenThreads[ThreadId];
    yield* forgetSession(draft, ThreadId);
  },
  *"Thread/RequestsSettled"(draft, { ThreadId, PendingIds, UnansweredIds }) {
    const session = draft.Local.ThreadSessions[ThreadId];
    if (session !== undefined) yield* start(settleQuestions, session, PendingIds, UnansweredIds);
    yield* rememberCompactionDismissal(draft, ThreadId);
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
    if (draft.Local.SelectedThreadId !== ThreadId) yield* closeThread(draft, ThreadId);
  },
  *"Dictation/TranscriptRefused"(draft, { ThreadId }) {
    yield* refuseTranscript(draft, ThreadId);
  },
  *"Thread/Started"(draft, { ThreadId }) {
    if (draft.Local.SelectedThreadId !== ThreadId) return;
    yield* openThread(draft, ThreadId);
    yield* setAddressThread(ThreadId);
  },
});

export default createEntityFeature<IEnvironment>(import.meta.url)(
  {
    selectThread,
    newThread,
    threadCommand,
    settleThread,
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
    updateServerSettings,
    archivedThreadCommand,
    loadUsage,
    refreshUsage,
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
    stopDictation,
    cancelDictation,
    sendAfterDictation,
    setVoiceDestination,
  },
  {
    dictation,
    sidebarLayout,
    colorScheme,
    selectedOpenThread,
    selectedDraftSession,
    panelShortcuts,
    currentProjectId,
    currentProjectRoot,
    editors,
  },
);
