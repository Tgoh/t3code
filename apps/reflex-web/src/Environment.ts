import {
  bind,
  entity,
  generateGuid,
  type IActionGenerator,
  type IEntity,
  type IOpenGenerator,
  type ISelectorGenerator,
  open,
  openResource,
  receiver,
  registerDataSource,
  start,
} from "treflex";
import { createEntityFeature } from "treflex-solid";

import { addressThread, setAddressThread } from "./Infrastructure/address";
import {
  type IProjectCommand,
  type IThreadCommand,
  projectCommandEffect,
  serverProvidersEffect,
  threadCommandEffect,
  withCommandId,
} from "./Infrastructure/commandEffects";
import { rememberTerminalEffect } from "./Infrastructure/terminalMemory";
import { getDefaultOpenThread, type IOpenThread, openThreadStream } from "./OpenThread";
import { dropThreadRow, getDefaultShell, type IShell, openShellStream } from "./Shell";
import {
  detachTerminal,
  getDefaultThreadSession,
  type IReplica,
  type IThreadSession,
  restoreTerminal,
} from "./ThreadSession";

export interface IEnvironment extends IEntity {
  EnvironmentId: string;
  Label: string;
  Replica: IReplica;
  Local: IEntity & {
    SelectedThreadId: string | null;
    ThreadSessions: Record<string, IThreadSession>;
  };
}

export function* newEnvironment(
  environmentId: string,
  label: string,
): IActionGenerator<IEnvironment> {
  const shell = yield* entity<IShell>(getDefaultShell(environmentId));
  const replica = yield* entity<IReplica>({ Providers: [], Shell: shell, OpenThreads: {} });
  const local = yield* entity<IEnvironment["Local"]>({
    SelectedThreadId: null,
    ThreadSessions: {},
  });
  return yield* entity<IEnvironment>({
    EnvironmentId: environmentId,
    Label: label,
    Replica: replica,
    Local: local,
  });
}

export function* init(draft: IEnvironment): IActionGenerator {
  yield* registerDataSource(draft, "Replica", draft.Replica);
  bind(draft, EnvironmentReceiver);
  yield* openShellStream(draft.Replica.Shell);
  yield* start(loadProviders, draft);
  const selected = yield* addressThread();
  if (selected !== null) yield* selectThread(draft, selected);
}

export function* loadProviders(draft: IEnvironment): IOpenGenerator {
  const environmentId = draft.EnvironmentId;
  const providers = yield* open(serverProvidersEffect({ EnvironmentId: environmentId }));
  draft.Replica.Providers = providers;
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
  return session;
}

export function* openThread(draft: IEnvironment, threadId: string): IActionGenerator {
  if (draft.Replica.OpenThreads[threadId] !== undefined) return;
  const session = yield* sessionOf(draft, threadId);
  draft.Replica.OpenThreads[threadId] = yield* entity<IOpenThread>(
    getDefaultOpenThread(draft.EnvironmentId, threadId),
  );
  yield* openThreadStream(draft.Replica.OpenThreads[threadId]!);
  yield* start(restoreTerminal, session.$Id);
}

export function* closeThread(draft: IEnvironment, threadId: string): IActionGenerator {
  delete draft.Replica.OpenThreads[threadId];
  const session = draft.Local.ThreadSessions[threadId];
  if (session !== undefined) yield* start(detachTerminal, session);
}

export function* selectThread(draft: IEnvironment, threadId: string): IActionGenerator {
  const previous = draft.Local.SelectedThreadId;
  if (previous === threadId) return;
  draft.Local.SelectedThreadId = threadId;
  if (previous !== null) yield* closeThread(draft, previous);
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
  const threadId = existing?.ThreadId ?? (yield* generateGuid());
  yield* sessionOf(draft, threadId, projectId);
  yield* selectThread(draft, threadId);
}

function* forgetThread(draft: IEnvironment, threadId: string): IActionGenerator {
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

export function* projectCommand(
  draft: IEnvironment,
  projectId: string | null,
  command: IProjectCommand,
): IOpenGenerator {
  const environmentId = draft.EnvironmentId;
  const target = projectId ?? (yield* generateGuid());
  yield* open(
    withCommandId((commandId) =>
      projectCommandEffect({
        EnvironmentId: environmentId,
        ProjectId: target,
        CommandId: commandId,
        Command: command,
      }),
    ),
  );
  if (command.Kind === "create") yield* newThread(draft, target);
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

export const EnvironmentReceiver = receiver<IEnvironment>("EnvironmentReceiver")({
  *"Thread/Deleted"(draft, { ThreadId }) {
    yield* forgetThread(draft, ThreadId);
  },
  *"Thread/Started"(draft, { ThreadId }) {
    if (draft.Local.SelectedThreadId !== ThreadId) return;
    yield* openThread(draft, ThreadId);
    yield* setAddressThread(ThreadId);
  },
});

export default createEntityFeature<IEnvironment>(import.meta.url)(
  { selectThread, newThread, threadCommand, projectCommand },
  { selectedOpenThread, selectedDraftSession, currentProjectId },
);
