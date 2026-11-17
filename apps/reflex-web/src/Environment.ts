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
  inFlight,
  type IOpenGenerator,
  type ISelectorGenerator,
  leading,
  open,
  openResource,
  receiver,
  registerDataSource,
  resource,
  start,
} from "treflex";
import { createEntityFeature } from "treflex-solid";

import {
  addressThread,
  addressView,
  type IAddressView,
  setAddressThread,
} from "./Infrastructure/address";
import {
  cloneControlEffect,
  type INewProject,
  type IProjectCommand,
  type IThreadCommand,
  modelFavoritesEffect,
  newProjectEffect,
  openInEditorEffect,
  openInFileManagerEffect,
  projectCommandEffect,
  serverProvidersEffect,
  setModelFavoriteEffect,
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
} from "./Preferences";
import { type IShelves, SETTLED_PAGE } from "./sidebarLayout";
import type { IWireClientSettings } from "./Infrastructure/settings";
import type { IProjectFaviconTarget } from "./projectIcon";
import { rememberTerminalEffect } from "./Infrastructure/terminalMemory";
import {
  getDefaultOpenThread,
  type IOpenThread,
  openThreadStream,
  resumeThread,
  retainThread,
} from "./OpenThread";
import {
  archivedThreadCommand,
  loadUsage,
  openView,
  refreshingUsage,
  refreshUsage,
  savingSettings,
  updateServerSettings,
  writeSetting,
} from "./Settings";
import { dropThreadRow, getDefaultShell, type IShell, openShellStream } from "./Shell";
import {
  detachTerminal,
  getDefaultThreadSession,
  type IReplica,
  type ISelection,
  type IThreadSession,
  restoreDraft,
  restoreTerminal,
  settleQuestions,
} from "./ThreadSession";

declare module "treflex" {
  interface IResourceRegistry {
    "Project/Clones": { Type: "projectClones" };
    "Project/Favicons": { Type: "projectFavicons" };
    "Server/Keybindings": { Type: "serverKeybindings" };
  }
}

export interface IEnvironment extends IEntity {
  EnvironmentId: string;
  Label: string;
  FileAttachmentLimit: number | null;
  Replica: IReplica;
  Local: ISelection & {
    ThreadSessions: Record<string, IThreadSession>;
    View: IAddressView | null;
    ClientSettings: IWireClientSettings | null;
    Preferences: IPreferences;
    Shelves: IShelves;
    /** The clock the sidebar reads, a minute at a time. */
    Now: number;
    SystemDark: boolean;
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
    ClientSettings: null,
    Preferences: yield* storedPreferencesEffect(),
    Shelves: { SnoozedOpen: false, SettledOpen: false, SettledShown: SETTLED_PAGE },
    Now: yield* clockNowEffect(),
    SystemDark: false,
  });
  return yield* entity<IEnvironment>({
    EnvironmentId: environmentId,
    Label: label,
    FileAttachmentLimit: fileAttachmentLimit,
    Replica: replica,
    Local: local,
  });
}

export function* init(draft: IEnvironment): IActionGenerator {
  yield* registerDataSource(draft, "Replica", draft.Replica);
  yield* registerDataSource(draft, "Selection", draft.Local);
  bind(draft, EnvironmentReceiver);
  yield* followDevice(draft);
  yield* openShellStream(draft.Replica.Shell);
  yield* openResource(draft, "Project/Clones", {
    Type: "projectClones",
    EnvironmentId: draft.EnvironmentId,
  });
  yield* openResource(draft, "Project/Favicons", {
    Type: "projectFavicons",
    EnvironmentId: draft.EnvironmentId,
  });
  yield* openResource(draft, "Server/Keybindings", {
    Type: "serverKeybindings",
    EnvironmentId: draft.EnvironmentId,
  });
  yield* start(loadProviders, draft);
  const selected = yield* addressThread();
  if (selected !== null) yield* selectThread(draft, selected);
  const view = yield* addressView();
  if (view !== null) yield* openView(draft, view);
}

export function* loadProviders(draft: IEnvironment, fresh = false): IOpenGenerator {
  const environmentId = draft.EnvironmentId;
  const providers = yield* open(
    serverProvidersEffect({ EnvironmentId: environmentId, Fresh: fresh }),
  );
  draft.Replica.Providers = providers;
  yield* loadModelFavorites(draft);
}

function* loadModelFavorites(draft: IEnvironment): IOpenGenerator {
  const environmentId = draft.EnvironmentId;
  const favorites = yield* open(modelFavoritesEffect({ EnvironmentId: environmentId }));
  draft.Replica.ModelFavorites = favorites;
}

export function* toggleModelFavorite(
  draft: IEnvironment,
  provider: string,
  model: string,
): IOpenGenerator {
  const favorite = !draft.Replica.ModelFavorites.some(
    (held) => held.Provider === provider && held.Model === model,
  );
  const environmentId = draft.EnvironmentId;
  yield* open(
    setModelFavoriteEffect({
      EnvironmentId: environmentId,
      Provider: provider,
      Model: model,
      Favorite: favorite,
    }),
  );
  yield* loadModelFavorites(draft);
}

function* sessionOf(
  draft: IEnvironment,
  threadId: string,
  newThreadProjectId: string | null = null,
): IActionGenerator<IThreadSession> {
  const held = draft.Local.ThreadSessions[threadId];
  if (held !== undefined) return held;
  draft.Local.ThreadSessions[threadId] = yield* entity<IThreadSession>(
    getDefaultThreadSession(draft.EnvironmentId, threadId, newThreadProjectId),
  );
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
  yield* start(restoreTerminal, session.$Id);
}

function* leaveThread(draft: IEnvironment, threadId: string): IActionGenerator {
  const held = draft.Replica.OpenThreads[threadId];
  if (held !== undefined) yield* retainThread(held);
  const session = draft.Local.ThreadSessions[threadId];
  if (session !== undefined) yield* start(detachTerminal, session);
}

export function* closeThread(draft: IEnvironment, threadId: string): IActionGenerator {
  delete draft.Replica.OpenThreads[threadId];
  const session = draft.Local.ThreadSessions[threadId];
  if (session !== undefined) yield* start(detachTerminal, session);
}

export function* selectThread(draft: IEnvironment, threadId: string): IActionGenerator {
  if (draft.Local.View !== null) yield* openView(draft, null);
  const previous = draft.Local.SelectedThreadId;
  if (previous === threadId) return;
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

function* forgetThread(draft: IEnvironment, threadId: string): IActionGenerator {
  yield* storeDraftEffect({ ThreadId: threadId, Draft: null });
  yield* storeDraftFilesEffect({ ThreadId: threadId, Files: [] });
  delete draft.Replica.OpenThreads[threadId];
  delete draft.Local.ThreadSessions[threadId];
  yield* start(dropThreadRow, draft.Replica.Shell, threadId);
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
    // A visit is bookkeeping the user didn't ask for, and the next one covers it.
    if (command.Kind === "visit") return;
    throw error;
  }
  // The shell doesn't say why a row left, and only an open thread's stream reports a deletion.
  if (command.Kind === "delete") yield* forgetThread(draft, threadId);
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
  for (const threadId of drafts) yield* forgetThread(draft, threadId);
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

// Follows removeMembers in apps/web/src/components/settings/ProjectSettingsPanel.tsx.
export function* removeProject(
  draft: IEnvironment,
  projectId: string,
): IOpenGenerator<string | null> {
  try {
    yield* sendProjectCommand(draft.EnvironmentId, projectId, { Kind: "delete", Force: true });
  } catch (error) {
    return errorText(error);
  }
  // The server deleted the project's threads too, and the shell doesn't say why a row left.
  const threadIds = new Set<string>(
    Object.values(draft.Replica.Shell.Threads)
      .filter((thread) => thread.projectId === projectId)
      .map((thread) => thread.id),
  );
  for (const session of Object.values(draft.Local.ThreadSessions)) {
    if (session.NewThreadProjectId === projectId) threadIds.add(session.ThreadId);
  }
  for (const threadId of threadIds) yield* forgetThread(draft, threadId);
  return null;
}
leading(removeProject);

export function* removingProject(draft: IEnvironment): ISelectorGenerator<boolean> {
  return yield* inFlight(removeProject, draft);
}

export function* requestProjectFavicon(
  draft: IEnvironment,
  target: IProjectFaviconTarget,
): IActionGenerator {
  yield* resource(draft, "Project/Favicons").request(target);
}

export function* openInFileManager(draft: IEnvironment, path: string): IOpenGenerator {
  yield* open(openInFileManagerEffect({ EnvironmentId: draft.EnvironmentId, Path: path }));
}

export function* openInEditor(
  draft: IEnvironment,
  path: string,
  projectRoot: string | null,
): IOpenGenerator {
  const stored = yield* storedEditorEffect();
  const opened = yield* open(
    openInEditorEffect({
      EnvironmentId: draft.EnvironmentId,
      Path: path,
      ProjectRoot: projectRoot,
      Stored: stored,
    }),
  );
  if (opened !== stored) yield* storeEditorEffect({ Editor: opened });
}

// Follows handleAddProjectForEnvironment in apps/web/src/components/CommandPalette.tsx.
export function* addFolder(
  draft: IEnvironment,
  workspaceRoot: string,
): IOpenGenerator<string | null> {
  const environmentId = draft.EnvironmentId;
  const existing = findProjectByPath(Object.values(draft.Replica.Shell.Projects), workspaceRoot);
  const projectId = existing?.id ?? (yield* generateGuid());
  try {
    if (existing === undefined) {
      yield* sendProjectCommand(environmentId, projectId, {
        Kind: "create",
        Title: inferProjectTitleFromPath(workspaceRoot),
        WorkspaceRoot: workspaceRoot,
      });
    } else if (existing.archivedAt != null) {
      yield* sendProjectCommand(environmentId, projectId, { Kind: "unarchive" });
    }
  } catch (error) {
    return errorText(error);
  }
  const latest =
    existing === undefined
      ? null
      : getLatestThreadForProject(
          Object.values(draft.Replica.Shell.Threads).map((thread) => ({
            ...thread,
            archivedAt: thread.archivedAt ?? null,
          })),
          existing.id,
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
    return errorText(error);
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
    return { Error: errorText(error) };
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

export function* addingProject(draft: IEnvironment): ISelectorGenerator<boolean> {
  return yield* inFlight([addFolder, cloneProject, newProject], draft);
}

export function* cloneControlling(draft: IEnvironment): ISelectorGenerator<boolean> {
  return yield* inFlight(cloneControl, draft);
}

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
  *"Thread/Deleted"(draft, { ThreadId }) {
    yield* forgetThread(draft, ThreadId);
  },
  *"Thread/RequestsSettled"(draft, { ThreadId, PendingIds, UnansweredIds }) {
    const session = draft.Local.ThreadSessions[ThreadId];
    if (session !== undefined) yield* start(settleQuestions, session, PendingIds, UnansweredIds);
  },
  *"Thread/Expired"(draft, { ThreadId }) {
    if (draft.Local.SelectedThreadId !== ThreadId) yield* closeThread(draft, ThreadId);
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
    projectCommand,
    addFolder,
    cloneProject,
    newProject,
    cloneControl,
    toggleModelFavorite,
    removeProject,
    openInFileManager,
    openInEditor,
    requestProjectFavicon,
    openView,
    writeSetting,
    updateServerSettings,
    archivedThreadCommand,
    loadUsage,
    refreshUsage,
    setPreferences,
    setProjectHidden,
    toggleFolder,
    toggleProjectScope,
    toggleShelf,
    showMoreSettled,
    setAppearanceMode,
  },
  {
    sidebarLayout,
    colorScheme,
    selectedOpenThread,
    selectedDraftSession,
    currentProjectId,
    currentProjectRoot,
    addingProject,
    cloneControlling,
    removingProject,
    savingSettings,
    refreshingUsage,
  },
);
