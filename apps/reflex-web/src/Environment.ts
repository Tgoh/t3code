import {
  closeResource,
  fork,
  generateGuid,
  type IActionGenerator,
  type IEntity,
  type ISelectorGenerator,
  openResource,
  receiver,
  registerDataSource,
  subscribe,
} from "reflex";
import { createFeatureContext } from "reflex-solid";

import { addressThread, setAddressThread } from "./Infrastructure/address";
import { serverProvidersEffect } from "./Infrastructure/commandEffects";
import { rememberTerminalEffect } from "./Infrastructure/terminalMemory";
import { getDefaultOpenThread, type IOpenThread, openThreadStream } from "./OpenThread";
import { getDefaultShell, openShellStream } from "./Shell";
import {
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

export function getDefaultEnvironment(environmentId: string, label: string): IEnvironment {
  return {
    $Id: `environment:${environmentId}`,
    EnvironmentId: environmentId,
    Label: label,
    Replica: {
      $Id: `replica:${environmentId}`,
      Providers: [],
      Shell: getDefaultShell(`shell:${environmentId}`, environmentId),
      OpenThreads: {},
    },
    Local: { $Id: `local:${environmentId}`, SelectedThreadId: null, ThreadSessions: {} },
  };
}

export function* init(draft: IEnvironment): IActionGenerator {
  yield* registerDataSource(draft, "Replica", draft.Replica);
  yield* subscribe(draft, "Thread/Deleted", EnvironmentReceiver);
  yield* subscribe(draft, "Thread/Started", EnvironmentReceiver);
  yield* openShellStream(draft.Replica.Shell);
  yield* fork(loadProviders, draft);
  const selected = yield* addressThread();
  if (selected !== null) yield* selectThread(draft, selected);
}

export function* loadProviders(draft: IEnvironment): IActionGenerator {
  draft.Replica.Providers = yield* serverProvidersEffect({ EnvironmentId: draft.EnvironmentId });
}

function* sessionOf(
  draft: IEnvironment,
  threadId: string,
  newThreadProjectId: string | null = null,
): IActionGenerator<IThreadSession> {
  const held = draft.Local.ThreadSessions[threadId];
  if (held !== undefined) return held;
  draft.Local.ThreadSessions[threadId] = getDefaultThreadSession(
    draft.EnvironmentId,
    threadId,
    newThreadProjectId,
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
  draft.Replica.OpenThreads[threadId] = getDefaultOpenThread(
    `open-thread:${draft.EnvironmentId}:${threadId}`,
    draft.EnvironmentId,
    threadId,
  );
  yield* openThreadStream(draft.Replica.OpenThreads[threadId]!);
  yield* fork(restoreTerminal, session.$Id);
}

export function* closeThread(draft: IEnvironment, threadId: string): IActionGenerator {
  delete draft.Replica.OpenThreads[threadId];
  const session = draft.Local.ThreadSessions[threadId];
  if (session === undefined) return;
  session.Terminal.Status = null;
  yield* closeResource(session, "Terminal/Session");
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
    delete draft.Replica.OpenThreads[ThreadId];
    delete draft.Replica.Shell.Threads[ThreadId];
    delete draft.Local.ThreadSessions[ThreadId];
    yield* rememberTerminalEffect({ ThreadId, Launch: null });
    if (draft.Local.SelectedThreadId === ThreadId) {
      draft.Local.SelectedThreadId = null;
      yield* setAddressThread(null);
    }
  },
  *"Thread/Started"(draft, { ThreadId }) {
    if (draft.Local.SelectedThreadId !== ThreadId) return;
    yield* openThread(draft, ThreadId);
    yield* setAddressThread(ThreadId);
  },
});

export default createFeatureContext<IEnvironment>(import.meta.url)(
  { selectThread, newThread },
  { selectedOpenThread, selectedDraftSession, currentProjectId },
);
