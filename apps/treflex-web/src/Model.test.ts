import { applyOrchestrationV2ProjectionEvent } from "@t3tools/client-runtime/state/orchestration-v2-projection";
import {
  CHECKPOINT_DIFF_TRUNCATED_MARKER,
  DEFAULT_CLIENT_SETTINGS,
  DEFAULT_SERVER_SETTINGS,
  type KeybindingCommand,
  type OrchestrationV2ThreadProjection,
  ServerSettings,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import {
  CLAUDE_RESUME_COMPACTION_NEVER_ANSWER,
  formatClaudeResumeCompactionQuestion,
} from "@t3tools/shared/claudeCompaction";
import { createEffect, createMemo, createRoot } from "solid-js";
import {
  createTestRuntime,
  defineEffect,
  EntityReplacedError,
  type IActionGenerator,
  type IEffect,
  type IEntity,
  type IFailureEvent,
  inFlight,
  type IRuntime,
  type ISelectorGenerator,
  type ITestRuntimeOptions,
  settled,
} from "treflex";
import { pinOrderKeyBetween } from "@t3tools/shared/pinOrderKey";
import { describe, expect, it, onTestFinished } from "vite-plus/test";

import {
  addFolder,
  addProjectSettings,
  archiveThread,
  cloneProject,
  closeSideThread,
  closeThread,
  editors,
  EnvironmentReceiver,
  type IEnvironment,
  keybindings,
  openMode,
  newProject,
  newThread,
  openSideThread,
  openThread,
  openThreadLink,
  panelShortcuts,
  preferEditor,
  projectCommand,
  regenerateTitles,
  removeProject,
  reorderPin,
  selectThread,
  settleThread,
  settleThreads,
  startSideChat,
  threadCommand,
  toggleSettleOpenThread,
} from "./Environment";
import { ActivityReceiver } from "./Activity";
import type { IReportActivity } from "./Infrastructure/clientActivity";
import { adjacentThread } from "./keybindings";
import {
  cancelDictation,
  DictationReceiver,
  type IRecording,
  MISSING_MODEL,
  recording,
  sendAfterDictation,
  setVoiceDestination,
  STALE_DRAFT,
  startDictation,
} from "./Dictation";
import { downloadModel, POLL_MS, selectModel, VoiceModelsReceiver } from "./VoiceModels";
import { pull, runGitAction } from "./GitWork";
import { loadEarlier } from "./HistoryWindow";
import {
  autoRefreshLimits,
  chooseNotificationMode,
  openView,
  toggleModelFavorite,
  updateServerSettings,
  writeSetting,
} from "./Settings";
import type { IAddress, IAddressView } from "./Infrastructure/address";
import { type IRememberedTerminal, readRememberedTerminal } from "./Infrastructure/terminalMemory";
import { threadHistoryPage } from "./Infrastructure/threadHistory";
import type {
  IWireHistoryPage,
  IWireProjection,
  IWireShellItem,
  IWireThreadEvent,
  IWireThreadItem,
  IWireTurnItem,
} from "./Infrastructure/wire";
import type { Tokens } from "marked";

import { assistantHtml, containsHtml, createMarkdownLexer } from "./markdownTokens";
import type {
  IForkThread,
  ILinkAnswer,
  IMergeBack,
  IQueueCommand,
  IRespondRequest,
  IRewind,
  ISecretAnswer,
  IStartClone,
  IStartTurn,
  IStopThread,
  IThreadCommand,
  IThreadDiff,
  ITurnItemRequest,
  IWireModelSelection,
} from "./Infrastructure/commandEffects";
import type { IPickedFile } from "./Infrastructure/composerFiles";
import type { IStoredAttachment, IStoredDraft } from "./Infrastructure/draftMemory";
import { serverFailure } from "./Infrastructure/serverError";
import type { IToastRequest } from "./Infrastructure/toasts";
import type { IRememberedModels } from "./Infrastructure/modelMemory";
import type { IPreferences } from "./Infrastructure/preferences";
import {
  colorScheme,
  PreferencesReceiver,
  setAppearanceMode,
  setPreferences,
  setProjectHidden,
  sidebarLayout,
  toggleFolder,
  toggleProjectScope,
  toggleShelf,
} from "./Preferences";
import type { IAppearanceMode, IColorScheme } from "./colorScheme";
import { type IShelves, layoutSidebar } from "./sidebarLayout";
import {
  diffTurnOf,
  diffTurns,
  fileChangeCounts,
  type IOpenThread,
  isRowVisible,
  latestDiffTurn,
  latestRun,
  pendingApprovalIds,
  RETAIN_MS,
  folderIsRepository,
  gitRepositories,
  requestItems,
  ThreadReceiver,
  threadSynchronized,
  timelineEntries,
  timelineIds,
} from "./OpenThread";
import { registerReceivers } from "./receivers";
import { getDefaultRoot, type IRoot, load } from "./Root";
import { type IQuestion, questionProgress } from "./questions";
import {
  answerRequest,
  canAnswer,
  dismissRequest,
  type IRuntimeRequest,
  Responding,
} from "./RuntimeRequest";
import { answerLink, answerSecret, itemAnswerError } from "./ItemRequest";
import {
  activityAt,
  canSnooze,
  projectFolders,
  ShellReceiver,
  sidebarSections,
  sidebarRowThreadId,
  sidebarStatus,
  sidebarThreads,
  subagentRequests,
  unhiddenThreads,
  workingStartedAt,
} from "./Shell";
import {
  addAttachments,
  chooseModel,
  chooseRewind,
  closeDetailsPopover,
  closeDiff,
  closeRightPanel,
  openLauncher,
  editFromHere,
  forkFromRun,
  type IRewindChoice,
  mergeBack,
  revertTargets,
  rewindConfirm,
  threadWorking,
  diffLoading,
  detailsOpen,
  compactionOffer,
  effectiveModel,
  effectiveRuntimeMode,
  fitDetails,
  type IThreadSession,
  openAttachment,
  openDiff,
  openFile,
  closeFile,
  fileLoading,
  reloadFile,
  queueAction,
  runScript,
  selectDiffRepository,
  setDiffFilesCollapsed,
  toggleDiffWhitespace,
  heldSend,
  holdSend,
  removeAttachment,
  send,
  setDraft,
  setModelSelection,
  setQuestionCustomAnswer,
  chooseQuestionOption,
  setQuestionIndex,
  setRuntimeMode,
  STOP_PENDING_MAX_MS,
  StopReceiver,
  stoppingRun,
  stopRun,
  codeWrapped,
  toggleCodeWrap,
  toggleKeepFullHistory,
  toggleQuestionOption,
  toggleDetails,
  toggleRightPanel,
  toggleRowExpanded,
  sendAppMessage,
} from "./ThreadSession";
import {
  activateShell,
  addTerminal,
  closeTerminal,
  endShell,
  openTerminal,
  restartShell,
  setTerminalHeight,
  TerminalShellReceiver,
} from "./Terminal";
import { loadBranches } from "./ThreadDetails";
import {
  assistantItem,
  commandItem,
  emptyProjection,
  event,
  localRow,
  longThread,
  message,
  REPLICA_WRITERS,
  run,
  snapshotOf,
  tapReplicaWriters,
  THREAD_ID,
  thread,
} from "./testing/threadFixture";
import type { IProjectFaviconTarget } from "./projectIcon";
import { type IProjectSort, orderFolders } from "./projectOrder";
import type { INotificationShow } from "./Infrastructure/notifications";
import { type INotificationMode, threadNotificationTag } from "./threadNotifications";
import { runPanelShortcut } from "./shortcuts";
import { reconcile } from "./rows";

const ENV = "env-1";

const wireProvider = (
  instanceId: string,
  models: Array<Record<string, unknown>>,
  extra: Record<string, unknown> = {},
) => ({
  instanceId,
  driver: instanceId,
  displayName: instanceId,
  enabled: true,
  installed: true,
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-11-17T00:00:00.000Z",
  slashCommands: [],
  skills: [],
  models,
  ...extra,
});

const replayProvider = (extra: Record<string, unknown> = {}) =>
  wireProvider("devReplay", [{ slug: "showcase", name: "Showcase", isDefault: true }], extra);

const WIRE_SETTINGS = {
  ...Schema.encodeSync(ServerSettings)(DEFAULT_SERVER_SETTINGS),
  providerInstances: { devReplay: { driver: "devReplay", enabled: true } },
};

const configSnapshot = (
  providers: unknown[],
  settings: Record<string, unknown> = { ...WIRE_SETTINGS, favorites: [] },
) => ({
  version: 1,
  type: "snapshot",
  config: { settings, providers, keybindings: [], issues: [] },
});

const inFlightOf = (
  runtime: IRuntime<IRoot>,
  reading: Parameters<typeof inFlight>[0],
  owner: () => IEntity,
) =>
  runtime.processSelector(function* (draft: IEntity): ISelectorGenerator<boolean> {
    return yield* inFlight(reading, draft);
  }, owner);

const storedPreferences: IPreferences = {
  GroupByProject: true,
  ClosedFolders: [],
  ProjectOrder: [],
  HiddenProjects: [],
  ProjectScope: [],
  SidebarCollapsed: false,
  SidebarWidth: null,
  DetailsOpen: true,
  CompactionDismissed: [],
  AppearanceMode: "system",
  Usage: { Metric: "limits", Days: 30 },
  VoiceDestination: "server",
  RenderMarkdown: false,
};

interface IStoredDrafts {
  Drafts: Map<string, IStoredDraft>;
  Files: Map<string, IStoredAttachment[]>;
}

async function connect(
  historyPage?: (cursor: string) => Promise<IWireHistoryPage>,
  initialAddress: string | null = null,
  commands: Record<string, (effect: never) => unknown> = {},
  stored: IStoredDrafts = { Drafts: new Map(), Files: new Map() },
  resources?: ITestRuntimeOptions["resources"],
  preferences: IPreferences = storedPreferences,
  allowFailures?: ITestRuntimeOptions["allowFailures"],
) {
  const history = {
    entries: [{ Thread: initialAddress, NewThreadIn: null, View: null }] as IAddress[],
    index: 0,
  };
  const address = {
    history,
    get thread() {
      return history.entries[history.index]!.Thread;
    },
    get newThreadIn() {
      return history.entries[history.index]!.NewThreadIn;
    },
    get view() {
      return history.entries[history.index]!.View;
    },
  };
  const terminals = new Map<string, IRememberedTerminal>();
  const toasts: IToastRequest[] = [];
  const models: IRememberedModels = { Last: null, OptionsByModel: {} };
  const device = {
    Preferences: preferences,
    Editor: null as string | null,
    Now: 0,
    Applied: [] as IColorScheme[],
    Schemes: [] as IColorScheme[],
    Favicons: [] as IProjectFaviconTarget[],
    NotifyModes: [] as INotificationMode[],
    InApp: [] as boolean[],
    Notified: [] as INotificationShow[],
    Opened: [] as string[],
    KeybindingReports: [] as unknown[][],
  };
  let guid = 0;
  const runtime = createTestRuntime<IRoot>(
    getDefaultRoot("Root"),
    {
      environmentInfo: () => ({
        Authenticated: true,
        BootstrapMethods: ["one-time-token"],
        EnvironmentId: ENV,
        Label: "Test",
        FileAttachmentLimit: null,
        Hostname: "localhost",
      }),
      generateGuid: () => `guid-${(guid += 1)}`,
      address: () => copy(history.entries[history.index]!),
      writeAddress: (effect: { Address: IAddress; Push: boolean }) => {
        const next = copy(effect.Address);
        if (JSON.stringify(next) === JSON.stringify(history.entries[history.index])) return;
        if (!effect.Push) history.entries[history.index] = next;
        else {
          history.entries.splice(history.index + 1, Infinity, next);
          history.index += 1;
        }
      },
      storedClientSettings: () => null,
      rememberedModels: () => models,
      rememberModel: (effect: { Selection: IWireModelSelection }) => {
        models.Last = effect.Selection;
      },
      // Selecting a thread sends a visit.
      threadCommand: () => {},
      refreshVcsStatus: () => {},
      reportActivity: () => {},
      ...commands,
      threadHistoryPage: (effect: { Cursor: string }) => historyPage!(effect.Cursor),
      storedDraft: (effect: { ThreadId: string }) => stored.Drafts.get(effect.ThreadId) ?? null,
      storedNewThread: (effect: { ProjectId: string }) =>
        [...stored.Drafts].find(([, held]) => held.NewThreadProjectId === effect.ProjectId)?.[0] ??
        null,
      storeDraft: (effect: { ThreadId: string; Draft: IStoredDraft | null }) => {
        if (effect.Draft === null) stored.Drafts.delete(effect.ThreadId);
        else stored.Drafts.set(effect.ThreadId, effect.Draft);
      },
      storedDraftFiles: (effect: { ThreadId: string }) => stored.Files.get(effect.ThreadId) ?? [],
      storeDraftFiles: (effect: { ThreadId: string; Files: IStoredAttachment[] }) => {
        if (effect.Files.length === 0) stored.Files.delete(effect.ThreadId);
        else stored.Files.set(effect.ThreadId, effect.Files);
      },
      storedPreferences: () => copy(device.Preferences),
      storePreferences: (effect: { Patch: Partial<IPreferences> }) => {
        device.Preferences = { ...device.Preferences, ...copy(effect.Patch) };
      },
      storedEditor: () => device.Editor,
      storeEditor: (effect: { Editor: string }) => {
        device.Editor = effect.Editor;
      },
      clockNow: () => device.Now,
      toast: ({ Type: _type, ...request }: IToastRequest & { Type: string }) => {
        toasts.push(request);
      },
      rememberedTerminal: (effect: { ThreadId: string }) => terminals.get(effect.ThreadId) ?? null,
      rememberTerminal: (effect: { ThreadId: string; Terminal: IRememberedTerminal | null }) => {
        if (effect.Terminal === null) terminals.delete(effect.ThreadId);
        else terminals.set(effect.ThreadId, copy(effect.Terminal));
      },
    },
    {
      allowFailures,
      resources: {
        ...resources,
        methods: {
          "Terminal/Session": {
            setScheme: (_ctx: unknown, scheme: IColorScheme) => void device.Schemes.push(scheme),
          },
          "Device/Appearance": {
            apply: (_ctx: unknown, scheme: IColorScheme) => void device.Applied.push(scheme),
          },
          "Project/Favicons": {
            request: (_ctx: unknown, target: IProjectFaviconTarget) =>
              void device.Favicons.push(target),
          },
          "Notify/Device": {
            setMode: (_ctx: unknown, mode: INotificationMode, inApp: boolean) => {
              device.NotifyModes.push(mode);
              device.InApp.push(inApp);
            },
            show: (_ctx: unknown, note: INotificationShow) => void device.Notified.push(note),
            opened: (_ctx: unknown, threadId: string) => void device.Opened.push(threadId),
          },
          "Keybindings/Warning": {
            report: (_ctx: unknown, ...report: unknown[]) =>
              void device.KeybindingReports.push(report),
          },
          ...resources?.methods,
        },
      },
    },
  );
  const clock = runtime.provideExternal("Minute", { read: () => device.Now });
  const strayWriters = new Set<string | null>();
  tapReplicaWriters(runtime, (name) => {
    if (!REPLICA_WRITERS.has(name)) strayWriters.add(name);
  });
  onTestFinished(() => expect([...strayWriters], "actions that wrote the replica").toEqual([]));
  const failures: IFailureEvent[] = [];
  runtime.on("failure", (failure) => failures.push(failure));
  registerReceivers(runtime);
  await runtime.dispatch(load, "Root");
  await settled();
  const environment = () => runtime.state.Environments[0] as IEnvironment;
  const sendConfig = (Item: Record<string, unknown>) =>
    runtime.dispatch(
      EnvironmentReceiver.handle,
      environment().$Id,
      { Type: "Server/Config", Item: Item as never },
      { publisher: { Id: environment().$Id } },
    );
  await sendConfig(configSnapshot([replayProvider()]));
  expect(environment().Replica.Providers).toHaveLength(1);
  if (initialAddress !== null) expect(address.thread).toBe(initialAddress);
  else expect(runtime.resources().some((row) => row.Key === "Shell/Stream")).toBe(true);
  const session = (threadId = THREAD_ID) =>
    environment().Local.ThreadSessions[threadId] as IThreadSession;
  const thread = () => environment().Replica.OpenThreads[THREAD_ID] as IOpenThread;
  const envId = () => environment().$Id;
  const openId = () => thread().$Id;
  const shellId = () => environment().Replica.Shell.$Id;
  /** Moves through the history as the back (-1) and forward (1) buttons do. */
  const go = async (delta: number) => {
    history.index += delta;
    await runtime.dispatch(
      EnvironmentReceiver.handle,
      environment().$Id,
      { Type: "Device/History", Address: copy(history.entries[history.index]!) },
      { publisher: { Id: environment().$Id } },
    );
    await settled();
  };
  return {
    runtime,
    takeFailures: () => failures.splice(0),
    takeToasts: () => toasts.splice(0),
    clock,
    address,
    go,
    terminals,
    models,
    device,
    stored,
    environment,
    session,
    thread,
    envId,
    sessionId: (threadId = THREAD_ID) => session(threadId).$Id,
    terminalId: (threadId = THREAD_ID) => session(threadId).Terminal.$Id,
    terminalShellId: (terminalId = "term-1", threadId = THREAD_ID) =>
      session(threadId).Terminal.Shells[terminalId]!.$Id,
    openId,
    shellId,
    open: () => runtime.dispatch(openThread, envId(), THREAD_ID),
    sendThread: (Item: IWireThreadItem) =>
      runtime.dispatch(
        ThreadReceiver.handle,
        openId(),
        { Type: "Thread/Stream", Item },
        { publisher: { Id: openId() } },
      ),
    sendShell: (Item: IWireShellItem) =>
      runtime.dispatch(
        ShellReceiver.handle,
        shellId(),
        { Type: "Shell/Stream", Item },
        { publisher: { Id: shellId() } },
      ),
    sendConfig,
    disposed: (id: string) =>
      new Promise<void>((resolve) => {
        runtime.on("record", (record) => {
          if (record.Kind === "entity:dispose" && record.EntityId === id) resolve();
        });
      }),
  };
}

function projectionOf(thread: IOpenThread) {
  return {
    thread: thread.Thread,
    runs: sorted(Object.values(thread.Runs)),
    messages: sorted(Object.values(thread.Messages)),
    turnItems: sorted(Object.values(thread.TurnItems)),
    providerTurns: sorted(Object.values(thread.ProviderTurns)),
    rows: timelineEntries(thread),
  };
}

const sorted = <T extends { id: string }>(rows: T[]) =>
  [...rows].sort((a, b) => a.id.localeCompare(b.id));

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));

describe("thread events", () => {
  it("matches the immutable reducer over a run's worth of events", async () => {
    const server = await connect();
    await server.open();
    const first = assistantItem("a-1", "run-1", 1, "one", "m-1");
    const start = {
      ...emptyProjection(),
      runs: [run("run-1", 1)],
      messages: [message("m-1", "run-1", "one")],
      turnItems: [first],
      visibleTurnItems: [localRow(first, 0)],
    };
    await server.sendThread(snapshotOf(copy(start), 1));

    const providerTurn = { id: "pt-1", status: "running", tokenUsage: { usedTokens: 5 } };
    const events = [
      event("run.created", run("run-2", 2, "running"), "2026-06-20T01:00:00.000Z"),
      event("message.updated", message("m-2", "run-2", "he", true)),
      event("turn-item.updated", assistantItem("a-2", "run-2", 4, "he", "m-2", true)),
      event("message.updated", message("m-2", "run-2", "hello", true)),
      event("turn-item.updated", {
        ...assistantItem("a-2", "run-2", 4, "", "m-2", true),
        textOmitted: true,
      }),
      event("turn-item.updated", commandItem("c-1", "run-2", 3)),
      event("turn-item.updated", commandItem("c-2", "run-2", 4)),
      event("turn-item.updated", commandItem("c-1", "run-2", 9)),
      event("provider-turn.updated", providerTurn),
      event("provider-turn.updated", { id: "pt-1", status: "completed" }),
      event("thread.visited", { ...start.thread, title: "Visited" }, "2026-06-20T09:00:00.000Z"),
      event("thread.visit-recorded", { lastVisitedAt: "2026-06-20T09:30:00.000Z" }),
      event("thread.visit-recorded", {
        lastVisitedAt: "2026-06-20T09:45:00.000Z",
        opens: { openedAt: 1, score: 2, picks: [{ query: "vis", at: 1 }] },
      }),
      event("run.updated", run("run-2", 2, "rolled_back")),
      event("turn-item.updated", commandItem("c-3", "run-2", 10)),
      event("turn-item.updated", commandItem("c-4", "run-1", 2)),
      event("run.created", run("run-3", 3, "cancelled")),
      event("turn-item.updated", {
        ...commandItem("queued", "run-3", 11),
        type: "user_message",
        inputIntent: "queued_turn",
        text: "never sent",
        attachments: [],
      }),
      event("run.created", run("run-4", 4, "running")),
      event("turn-item.updated", {
        ...commandItem("interrupted", "run-4", 12),
        type: "run_interrupt_result",
        nodeId: "node-4",
        message: "stopped",
      }),
      event("run-attempt.created", {
        id: "attempt-4",
        runId: "run-4",
        rootNodeId: "node-4",
        status: "running",
      }),
      event("run-attempt.updated", {
        id: "attempt-4",
        runId: "run-4",
        rootNodeId: "node-4",
        status: "superseded",
      }),
      event("run.created", run("run-5", 5, "running")),
      event("turn-item.updated", {
        ...commandItem("request", "run-5", 13),
        type: "run_interrupt_request",
        message: "stop",
      }),
      event("turn-item.updated", {
        ...commandItem("paired", "run-5", 14),
        type: "run_interrupt_result",
        nodeId: "node-5",
        message: "stopped",
      }),
      event("run-attempt.created", {
        id: "attempt-5",
        runId: "run-5",
        rootNodeId: "node-5",
        status: "superseded",
      }),
    ];

    let expected = copy(start) as unknown as OrchestrationV2ThreadProjection;
    let sequence = 1;
    for (const next of events) {
      expected = applyOrchestrationV2ProjectionEvent(expected, copy(next) as never)!;
      sequence += 1;
      await server.sendThread({ kind: "event", sequence, event: copy(next) } as IWireThreadItem);
      const wire = expected as unknown as typeof start;
      expect(copy(projectionOf(server.thread()))).toEqual(
        copy({
          thread: wire.thread,
          runs: sorted(wire.runs),
          messages: sorted(wire.messages),
          turnItems: sorted(wire.turnItems),
          providerTurns: sorted((expected.providerTurns as unknown as { id: string }[]) ?? []),
          rows: wire.visibleTurnItems.map(
            ({ position, visibility, sourceThreadId, sourceItemId, item }) => ({
              position,
              sourceItemId,
              visibility,
              sourceThreadId,
              item,
            }),
          ),
        }),
      );
    }
  });

  it.each([
    ["starts", "starting", false],
    ["fails in a partial window", "failed", true],
  ])(
    "matches the immutable reducer when a queued run %s and a provider thread takes over",
    async (_, to, partial) => {
      const server = await connect();
      await server.open();
      const queued = {
        ...commandItem("queued", "run-1", 1),
        type: "user_message",
        inputIntent: "queued_turn",
        text: "later",
        attachments: [],
      } as IWireTurnItem;
      const start = {
        ...emptyProjection(),
        runs: [run("run-1", 1, "queued")],
        turnItems: [queued],
      };
      const window = { partialTimeline: true, latestLocalTurnOrdinal: 1 };
      await server.sendThread({
        ...snapshotOf(copy(start), 1),
        ...(partial
          ? { historyCursor: "c0", hasMoreHistory: true, latestLocalTurnOrdinal: 1 }
          : {}),
      });
      const providerThread = {
        id: "pt-1",
        appThreadId: start.thread.id,
        status: "loaded",
        firstRunOrdinal: 1,
        nativeThreadRef: null,
        providerSessionId: null,
      };
      const events = [
        event("provider-thread.updated", {
          ...providerThread,
          id: "pt-0",
          status: "not_loaded",
          firstRunOrdinal: null,
        }),
        event("provider-thread.updated", providerThread),
        event("run.updated", run("run-1", 1, to)),
      ];
      let expected = copy(start) as unknown as OrchestrationV2ThreadProjection;
      let sequence = 1;
      for (const next of events) {
        expected = applyOrchestrationV2ProjectionEvent(
          expected,
          copy(next) as never,
          partial ? window : undefined,
        )!;
        sequence += 1;
        await server.sendThread({ kind: "event", sequence, event: copy(next) } as IWireThreadItem);
        const wire = expected as unknown as IWireProjection;
        expect(copy(server.thread().Thread)).toEqual(copy(wire.thread));
        expect(timelineEntries(server.thread()).map((row) => row.item.id)).toEqual(
          wire.visibleTurnItems.map((row) => row.item.id),
        );
      }
    },
  );

  it("applies the visibility rule per row, so a hidden row comes back when the rule allows", async () => {
    const server = await connect();
    await server.open();
    const result = {
      ...commandItem("result", "run-1", 1),
      type: "run_interrupt_result",
      nodeId: "node-1",
      message: "stopped",
    };
    await server.sendThread(
      snapshotOf(
        {
          ...emptyProjection(),
          runs: [run("run-1", 1), run("run-2", 2)],
          attempts: [{ id: "attempt", runId: "run-1", rootNodeId: "node-1", status: "superseded" }],
        } as never,
        1,
      ),
    );
    const send = (sequence: number, type: IWireThreadItem["kind"] | string, payload: unknown) =>
      server.sendThread({
        kind: "event",
        sequence,
        event: event(type as never, payload),
      } as IWireThreadItem);
    await send(2, "turn-item.updated", result);
    await send(3, "turn-item.updated", commandItem("command", "run-2", 2));
    expect(server.thread().Timeline).toEqual(["result", "command"]);
    expect(isRowVisible(server.thread(), "result")).toBe(false);
    expect(isRowVisible(server.thread(), "command")).toBe(true);

    await send(4, "turn-item.updated", {
      ...commandItem("request", "run-1", 3),
      type: "run_interrupt_request",
      message: "stop",
    });
    expect(isRowVisible(server.thread(), "result")).toBe(true);

    await send(5, "run.updated", run("run-2", 2, "rolled_back"));
    expect(isRowVisible(server.thread(), "command")).toBe(false);
    await send(6, "run.updated", run("run-2", 2, "completed"));
    expect(isRowVisible(server.thread(), "command")).toBe(true);
  });

  it("keeps a run's submitted output through lifecycle updates that don't carry it", async () => {
    const server = await connect();
    await server.open();
    await server.sendThread(
      snapshotOf({ ...emptyProjection(), runs: [run("run-1", 1)] } as never, 1),
    );
    const output = { value: { ok: true }, submittedAt: "2026-01-01T00:00:00.000Z" };
    const send = (sequence: number, type: string, payload: unknown) =>
      server.sendThread({
        kind: "event",
        sequence,
        event: event(type as never, payload),
      } as IWireThreadItem);
    await send(2, "run.output-submitted", { runId: "run-1", output });
    expect(server.thread().Runs["run-1"]).toMatchObject({ output });
    await send(3, "run.updated", run("run-1", 1, "completed"));
    expect(server.thread().Runs["run-1"]).toMatchObject({ status: "completed", output });
  });

  it("drops a live update to history outside a bounded window", async () => {
    const server = await connect();
    await server.open();
    const held = commandItem("c-5", "run-1", 5);
    const item = {
      ...snapshotOf(
        {
          ...emptyProjection(),
          runs: [run("run-1", 1)],
          turnItems: [held],
          visibleTurnItems: [localRow(held, 0)],
        },
        1,
      ),
      historyCursor: "older",
      hasMoreHistory: true,
      latestLocalTurnOrdinal: 5,
    };
    await server.sendThread(item);
    await server.sendThread({
      kind: "event",
      sequence: 2,
      event: event("turn-item.updated", commandItem("c-2", "run-1", 2)),
    } as IWireThreadItem);
    expect(server.thread().TurnItems["c-2"]).toBeUndefined();
    expect(server.thread().Timeline).toEqual(["c-5"]);
  });

  it("carries turn items as a union: a new type's fields replace the old type's", async () => {
    const server = await connect();
    await server.open();
    const before = assistantItem("x", "run-1", 1, "text");
    await server.sendThread(snapshotOf({ ...emptyProjection(), turnItems: [before] }, 1));
    await server.sendThread({
      kind: "event",
      sequence: 2,
      event: event("turn-item.updated", commandItem("x", "run-1", 1)),
    } as IWireThreadItem);
    const after = server.thread().TurnItems["x"]!;
    expect(after.type).toBe("command_execution");
    expect("text" in after).toBe(false);
  });

  it("a delta re-runs only the reads of what it changed", async () => {
    const server = await connect();
    await server.open();
    await server.sendThread(snapshotOf(longThread(9), 1));
    const thread = server.thread();
    const runs = { changed: 0, other: 0, selector: 0, ids: 0 };
    const dispose = createRoot((disposeRoot) => {
      createEffect(
        () => {
          runs.selector += 1;
          timelineEntries(thread);
        },
        () => {},
      );
      createEffect(
        () => {
          runs.ids += 1;
          server.runtime.processSelector(timelineIds, () => thread);
        },
        () => {},
      );
      createEffect(
        () => {
          runs.changed += 1;
          void (thread.TurnItems["item-6"] as { text?: string }).text;
        },
        () => {},
      );
      createEffect(
        () => {
          runs.other += 1;
          void (thread.TurnItems["item-0"] as { text?: string }).text;
        },
        () => {},
      );
      return disposeRoot;
    });
    expect(runs).toEqual({ changed: 1, other: 1, selector: 1, ids: 1 });
    await server.sendThread({
      kind: "event",
      sequence: 2,
      event: event(
        "turn-item.updated",
        assistantItem("item-6", "run-2", 6, "changed", "message-2"),
      ),
    } as IWireThreadItem);
    await Promise.resolve();
    expect(runs).toEqual({ changed: 2, other: 1, selector: 1, ids: 1 });
    dispose();
  });
});

describe("random event traces", () => {
  const RUNS = ["r1", "r2", "r3"];
  const ITEMS = ["i1", "i2", "i3", "i4", "i5", "i6", "i7", "i8"];
  const TERMINAL_RUN = ["completed", "rolled_back", "cancelled"];

  const randomOf = (seed: number) => {
    let state = seed >>> 0;
    return (limit: number) => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return Math.floor((state / 2 ** 32) * limit);
    };
  };

  // Statuses only move forward and a request never follows a superseded attempt, because this client
  // deliberately brings a row back in those cases where the reducer has already dropped it.
  function randomEvent(
    pick: (limit: number) => number,
    ended: Set<string>,
    superseded: Set<string>,
    canHide: boolean,
  ) {
    const runId = RUNS[pick(RUNS.length)]!;
    const kind = pick(7);
    if (kind === 0 && !ended.has(runId)) {
      const statuses = canHide ? ["running", "waiting", ...TERMINAL_RUN] : ["running", "completed"];
      const status = statuses[pick(statuses.length)]!;
      if (TERMINAL_RUN.includes(status)) ended.add(runId);
      return event("run.updated", run(runId, RUNS.indexOf(runId) + 1, status));
    }
    if (kind === 1 && canHide && !superseded.has(runId)) {
      const status = ["running", "superseded"][pick(2)]!;
      if (status === "superseded") superseded.add(runId);
      return event("run-attempt.updated", {
        id: `a-${runId}`,
        runId,
        rootNodeId: `n-${runId}`,
        status,
      });
    }
    if (kind === 2 && !superseded.has(runId)) {
      return event("turn-item.updated", {
        ...commandItem(`request-${runId}`, runId, 40 + pick(5)),
        type: "run_interrupt_request",
        message: "stop",
      });
    }
    const id = ITEMS[pick(ITEMS.length)]!;
    const itemRun = pick(6) === 0 ? null : runId;
    const base = commandItem(id, itemRun, 10 + pick(25), `v${pick(1000)}`);
    const variant = pick(5);
    if (variant === 0) {
      return event("turn-item.updated", {
        ...base,
        type: "run_interrupt_result",
        message: "stopped",
        nodeId: `n-${itemRun}`,
      });
    }
    if (variant === 1) {
      return event("turn-item.updated", {
        ...base,
        type: "user_message",
        text: "hi",
        messageId: `m-${id}`,
        inputIntent: "queued_turn",
        attachments: [],
      });
    }
    return event("turn-item.updated", base);
  }

  const rowOf = (row: {
    sourceItemId: string;
    visibility: string;
    item: { ordinal: number; type: string };
  }) => [row.sourceItemId, row.visibility, row.item.ordinal, row.item.type];

  async function runTrace(seed: number, partial: boolean) {
    const pick = randomOf(seed);
    const server = await connect();
    await server.open();
    const seedItem = commandItem("i0", "r1", 20);
    const inherited = { ...commandItem("p1", "r0", 1), threadId: "parent" } as IWireTurnItem;
    const start = {
      ...emptyProjection(),
      runs: [run("r1", 1, "running"), run("r2", 2, "running"), run("r3", 3, "running")],
      turnItems: [seedItem],
      visibleTurnItems: [
        { ...localRow(inherited, 0), visibility: "inherited" as const },
        localRow(seedItem, 1),
      ],
    };
    await server.sendThread({
      ...snapshotOf(copy(start), 1),
      ...(partial ? { historyCursor: "c0", hasMoreHistory: true, latestLocalTurnOrdinal: 20 } : {}),
    });
    let expected = copy(start) as unknown as OrchestrationV2ThreadProjection;
    const { ids, dispose } = createRoot((disposeRoot) => ({
      ids: createMemo(() => server.runtime.processSelector(timelineIds, () => server.thread())),
      dispose: disposeRoot,
    }));
    let watermark: number | null = 20;
    const ended = new Set<string>();
    const superseded = new Set<string>();
    for (let step = 0; step < 40; step += 1) {
      const next = randomEvent(pick, ended, superseded, !partial);
      const before = expected;
      expected = applyOrchestrationV2ProjectionEvent(
        expected,
        copy(next) as never,
        partial ? { partialTimeline: true, latestLocalTurnOrdinal: watermark } : undefined,
      )!;
      if (partial && next.type === "turn-item.updated" && expected !== before) {
        watermark = Math.max(watermark ?? 0, (next.payload as { ordinal: number }).ordinal);
      }
      await server.sendThread({
        kind: "event",
        sequence: step + 2,
        event: copy(next),
      } as IWireThreadItem);
      const context = `seed ${seed}, partial ${partial}, step ${step}, ${next.type}`;
      expect(copy(timelineEntries(server.thread()).map(rowOf)), context).toEqual(
        copy((expected.visibleTurnItems as unknown as Parameters<typeof rowOf>[0][]).map(rowOf)),
      );
      expect(ids(), context).toEqual([...server.thread().Timeline]);
    }
    const orders = [
      ["a", "b", "c"],
      ["c", "a", "b"],
      ["c", "a", "d"],
    ];
    for (const [index, order] of orders.entries()) {
      const items = order.map((id, ordinal) => commandItem(id, "r1", ordinal));
      await server.sendThread(
        snapshotOf(
          copy({
            ...start,
            turnItems: items,
            visibleTurnItems: items.map((item, position) => localRow(item, position)),
          }),
          100 + index,
        ),
      );
      expect(server.thread().Timeline).toEqual(order);
      expect(ids(), `seed ${seed}, partial ${partial}, snapshot ${order}`).toEqual(order);
    }
    dispose();
  }

  it("match the immutable reducer", async () => {
    for (const partial of [false, true]) {
      for (let seed = 1; seed <= 15; seed += 1) await runTrace(seed, partial);
    }
  });

  it("keep a row in a partial window that the reducer loses after hiding it", async () => {
    const server = await connect();
    await server.open();
    const item = commandItem("x", "r1", 24);
    const start = {
      ...emptyProjection(),
      runs: [run("r1", 1, "running"), run("r2", 2, "completed")],
      turnItems: [item],
      visibleTurnItems: [localRow(item, 0)],
    };
    await server.sendThread({
      ...snapshotOf(copy(start), 1),
      historyCursor: "c0",
      hasMoreHistory: true,
      latestLocalTurnOrdinal: 30,
    });
    let expected = copy(start) as unknown as OrchestrationV2ThreadProjection;
    const events = [
      event("run.updated", run("r1", 1, "rolled_back")),
      event("turn-item.updated", commandItem("x", "r2", 24)),
    ];
    for (const [index, next] of events.entries()) {
      expected = applyOrchestrationV2ProjectionEvent(expected, copy(next) as never, {
        partialTimeline: true,
        latestLocalTurnOrdinal: 30,
      })!;
      await server.sendThread({
        kind: "event",
        sequence: index + 2,
        event: copy(next),
      } as IWireThreadItem);
    }
    expect(expected.visibleTurnItems).toEqual([]);
    expect(timelineEntries(server.thread()).map((row) => row.sourceItemId)).toEqual(["x"]);
  });
});

describe("markdown", () => {
  it("keeps the tokens of unchanged blocks across a delta", () => {
    const lex = createMarkdownLexer(false);
    const first = lex("One para.\n\nTwo\n\n- item");
    const second = lex("One para.\n\nTwo more\n\n- item");
    expect(second.Blocks.map((token) => token.type)).toEqual(["paragraph", "paragraph", "list"]);
    expect(second.Blocks[0]).toBe(first.Blocks[0]);
    expect(second.Blocks[1]).not.toBe(first.Blocks[1]);
    expect(second.Blocks[2]).toBe(first.Blocks[2]);
  });

  it("finds raw HTML anywhere in a block, and only an assistant's block-level HTML spans blocks", () => {
    const lex = createMarkdownLexer(false);
    expect(containsHtml(lex("Press <kbd>x</kbd> now").Blocks[0]!)).toBe(true);
    expect(containsHtml(lex("- a <b>list</b>").Blocks[0]!)).toBe(true);
    expect(containsHtml(lex("| h |\n| - |\n| <i>c</i> |").Blocks[0]!)).toBe(true);
    expect(containsHtml(lex("`<b>` is code").Blocks[0]!)).toBe(false);
    expect(lex("Press <kbd>x</kbd> now").WholeHtml).toBeNull();
    expect(lex("<details>\n\nbody\n\n</details>").WholeHtml).not.toBeNull();
    expect(createMarkdownLexer(true)("<details>\n\nbody\n\n</details>").WholeHtml).toBeNull();
  });

  it("escapes a raw-text tag in an assistant's HTML, so it can't swallow what follows", () => {
    const { Blocks } = createMarkdownLexer(false)("Mention of <style> in prose");
    expect(assistantHtml(Blocks)).toContain("&lt;style&gt;");
  });

  it("starts a numbered list that follows a one-line label directly, whatever its first number", () => {
    const shape = (text: string) =>
      createMarkdownLexer(false)(text).Blocks.map((token) =>
        token.type === "list" ? `list@${(token as Tokens.List).start}` : token.type,
      );
    expect(shape("Intro.\n\n**Today**\n2. Ceiling\n3. Roof tile")).toEqual([
      "paragraph",
      "paragraph",
      "list@2",
    ]);
    expect(shape("**Calls**\n4. Skin check")).toEqual(["paragraph", "list@4"]);
    expect(shape("A sentence that wraps onto\nanother line before\n2024. Not a list")).toEqual([
      "paragraph",
    ]);
    expect(shape("1. One\n2. Two")).toEqual(["list@1"]);
    expect(shape("```\n**Label**\n2. code\n```")).toEqual(["code"]);
  });
});

describe("snapshots and identity", () => {
  it("treflex refuses a fresh node over a live $Id, so a reconnect snapshot merges in place", async () => {
    function* replace(draft: IEnvironment): IActionGenerator {
      draft.Replica.OpenThreads[THREAD_ID] = { ...copy(draft.Replica.OpenThreads[THREAD_ID]!) };
    }
    const server = await connect(undefined, null, {}, undefined, undefined, undefined, [replace]);
    await server.open();
    await expect(server.runtime.dispatch(replace, server.envId())).rejects.toThrow(
      EntityReplacedError,
    );
    expect(server.takeFailures().map((failure) => failure.Label)).toEqual(["replace"]);

    const start = longThread(6);
    await server.sendThread(snapshotOf(copy(start), 1));
    const node = server.thread();
    const item = node.TurnItems["item-0"];
    const reconnect = longThread(3);
    await server.sendThread(snapshotOf(reconnect, 9));
    expect(server.thread()).toBe(node);
    expect(server.thread().TurnItems["item-0"]).toBe(item);
    expect(server.thread().TurnItems["item-5"]).toBeUndefined();

    function* foldParsed(draft: IOpenThread): IActionGenerator {
      const parsed = JSON.parse(
        JSON.stringify(run("run-0", 1, "failed")).replace("{", '{"__proto__":{"x":1},'),
      );
      reconcile(draft.Runs["run-0"]!, parsed);
    }
    await server.runtime.dispatch(foldParsed, server.openId());
    expect(server.thread().Runs["run-0"]).toMatchObject({ id: "run-0", status: "failed" });
    expect("x" in server.thread().Runs["run-0"]!).toBe(false);
    expect(server.thread().Timeline).toEqual(["item-0", "item-1", "item-2"]);
    expect(server.thread().LastSequence).toBe(9);
  });

  it("holds an item shared by turnItems and a row once, and an inherited row's item apart", async () => {
    const server = await connect();
    await server.open();
    const local = commandItem("local", "run-1", 1);
    const parentItem = {
      ...commandItem("parent", "run-0", 0),
      threadId: "parent-thread",
    } as IWireTurnItem;
    await server.sendThread(
      snapshotOf(
        {
          ...emptyProjection(),
          turnItems: [local],
          visibleTurnItems: [
            { ...localRow(parentItem, 0), visibility: "inherited" },
            localRow(local, 1),
          ],
        },
        1,
      ),
    );
    expect(Object.keys(server.thread().TurnItems)).toEqual(["local"]);
    expect(Object.keys(server.thread().InheritedItems)).toEqual(["parent"]);
    const entries = timelineEntries(server.thread());
    expect(entries.map((entry) => entry.sourceItemId)).toEqual(["parent", "local"]);
  });
});

describe("lifetimes", () => {
  it("a row missing from the shell leaves the thread and its session alone", async () => {
    const server = await connect();
    await server.open();
    await server.runtime.dispatch(setDraft, server.sessionId(), "half a thought");
    const shellThread = { id: THREAD_ID, title: "T" };
    await server.sendShell({
      kind: "snapshot",
      snapshot: { snapshotSequence: 1, projects: [], threads: [shellThread], archivedThreads: [] },
    } as unknown as IWireShellItem);
    expect(server.environment().Replica.Shell.Threads[THREAD_ID]).toBeDefined();
    await server.sendShell({
      kind: "snapshot",
      snapshot: { snapshotSequence: 2, projects: [], threads: [], archivedThreads: [] },
    } as unknown as IWireShellItem);
    expect(server.environment().Replica.Shell.Threads[THREAD_ID]).toBeUndefined();
    expect(server.thread()).toBeDefined();
    expect(server.environment().Local.ThreadSessions[THREAD_ID]!.Draft).toBe("half a thought");
  });

  it("closing keeps the session and retires the stream; reopening resumes nothing stale", async () => {
    const server = await connect();
    await server.open();
    expect(server.runtime.resources().some((row) => row.Key === "Thread/Stream")).toBe(true);
    await server.runtime.dispatch(setDraft, server.sessionId(), "kept");
    await server.runtime.dispatch(closeThread, server.envId(), THREAD_ID);
    expect(server.thread()).toBeUndefined();
    expect(server.runtime.resources().some((row) => row.Key === "Thread/Stream")).toBe(false);
    expect(server.environment().Local.ThreadSessions[THREAD_ID]!.Draft).toBe("kept");
  });

  it("thread.deleted removes the replica row and the session", async () => {
    const server = await connect();
    await server.open();
    await server.sendThread(snapshotOf(emptyProjection(), 1));
    const gone = server.disposed(server.sessionId());
    await server.sendThread({
      kind: "event",
      sequence: 2,
      event: event("thread.deleted", {}),
    } as IWireThreadItem);
    await gone;
    expect(server.thread()).toBeUndefined();
    expect(server.environment().Local.ThreadSessions[THREAD_ID]).toBeUndefined();
  });

  it("reopens a stream that ended on a timer, unless the receiver failed it", async () => {
    const server = await connect();
    await server.open();
    const opened: string[] = [];
    server.runtime.on("record", (record) => {
      if (record.Kind === "effect" && record.Type === "openResource")
        opened.push((record.Descriptor as { Key: string }).Key);
    });
    const deliver = (message: object) =>
      server.runtime.dispatch(ThreadReceiver.handle, server.openId(), message as never, {
        publisher: { Id: server.openId() },
      });
    await deliver({ Type: "Thread/Stream", $Ended: { Reason: "failed" } });
    expect(server.runtime.timers(server.openId())).toMatchObject([{ Key: "Thread/Reopen" }]);
    await deliver({ Type: "Thread/Reopen" });
    expect(server.runtime.timers(server.openId())).toEqual([]);
    expect(opened).toEqual(["Thread/Stream"]);
    await deliver({ Type: "Thread/Stream", $Ended: { Reason: "receiver-failed" } });
    expect(server.runtime.timers(server.openId())).toEqual([]);

    const deliverShell = (message: object) =>
      server.runtime.dispatch(ShellReceiver.handle, server.shellId(), message as never, {
        publisher: { Id: server.shellId() },
      });
    await deliverShell({ Type: "Shell/Stream", $Ended: { Reason: "failed" } });
    expect(server.runtime.timers(server.shellId())).toMatchObject([{ Key: "Shell/Reopen" }]);
    await deliverShell({ Type: "Shell/Reopen" });
    expect(server.runtime.timers(server.shellId())).toEqual([]);
    expect(opened).toEqual(["Thread/Stream", "Shell/Stream"]);
    await deliverShell({ Type: "Shell/Stream", $Ended: { Reason: "receiver-failed" } });
    expect(server.runtime.timers(server.shellId())).toEqual([]);

    const deliverConfig = (message: object) =>
      server.runtime.dispatch(EnvironmentReceiver.handle, server.envId(), message as never, {
        publisher: { Id: server.envId() },
      });
    const configTimers = () =>
      server.runtime.timers(server.envId()).filter((row) => row.Key === "Server/ConfigReopen");
    await deliverConfig({ Type: "Server/Config", $Ended: { Reason: "failed" } });
    expect(configTimers()).toHaveLength(1);
    await deliverConfig({ Type: "Server/ConfigReopen" });
    expect(configTimers()).toEqual([]);
    expect(opened).toEqual(["Thread/Stream", "Shell/Stream", "Server/Config"]);
    await deliverConfig({ Type: "Server/Config", $Ended: { Reason: "receiver-failed" } });
    expect(configTimers()).toEqual([]);
  });
});

describe("runs", () => {
  it("treats the active run as latest, past a later cancelled queued run", async () => {
    const server = await connect();
    await server.open();
    await server.sendThread(
      snapshotOf(
        {
          ...emptyProjection(),
          runs: [run("r5", 5, "running"), run("r6", 6, "cancelled"), run("r7", 7, "queued")],
        },
        1,
      ),
    );
    const latest = () => server.runtime.processSelector(latestRun, () => server.thread())?.id;
    expect(latest()).toBe("r5");
    await server.sendThread({
      kind: "event",
      sequence: 2,
      event: event("run.updated", run("r5", 5, "completed")),
    } as IWireThreadItem);
    expect(latest()).toBe("r6");
  });
});

describe("history pages", () => {
  const window = () => {
    const held = commandItem("c-9", "run-1", 9);
    return {
      ...snapshotOf(
        {
          ...emptyProjection(),
          runs: [run("run-1", 1)],
          turnItems: [held],
          visibleTurnItems: [localRow(held, 0)],
        },
        1,
      ),
      historyCursor: "older",
      hasMoreHistory: true,
      latestLocalTurnOrdinal: 9,
    };
  };
  const pageOf = (id: string, nextCursor: string | null): IWireHistoryPage =>
    ({
      snapshotSequence: 1,
      items: [localRow(commandItem(id, "run-1", 1), 0)],
      nextCursor,
      hasMoreHistory: nextCursor !== null,
    }) as unknown as IWireHistoryPage;

  const gated = () => {
    let release!: (page: IWireHistoryPage) => void;
    const promise = new Promise<IWireHistoryPage>((resolve) => {
      release = resolve;
    });
    return { promise, release };
  };

  const historyId = (server: Awaited<ReturnType<typeof connect>>) => server.thread().History!.$Id;
  const loadingOf = (server: Awaited<ReturnType<typeof connect>>) =>
    inFlightOf(server.runtime, loadEarlier, () => server.thread().History!);

  it("prepends a page, and a live update made during the wait wins over it", async () => {
    const gate = gated();
    const server = await connect(() => gate.promise);
    await server.open();
    await server.sendThread(window());
    const loading = server.runtime.dispatch(loadEarlier, historyId(server));
    const busy = () => loadingOf(server);
    expect(busy()).toBe(true);
    expect(await server.runtime.dispatch(loadEarlier, historyId(server))).toBeUndefined();
    await server.sendThread({
      kind: "event",
      sequence: 2,
      event: event("turn-item.updated", commandItem("c-9", "run-1", 9, "newer")),
    } as IWireThreadItem);
    gate.release({
      ...pageOf("c-1", null),
      items: [
        localRow(commandItem("c-1", "run-1", 1), 0),
        localRow(commandItem("c-9", "run-1", 9, "older"), 1),
      ],
    } as unknown as IWireHistoryPage);
    await loading;
    await settled();
    expect(server.thread().Timeline).toEqual(["c-1", "c-9"]);
    expect((server.thread().TurnItems["c-9"] as { input: string }).input).toBe("newer");
    expect(server.thread().History).toMatchObject({ HasMore: false, Cursor: null });
    expect(busy()).toBe(false);
  });

  it("drops a fetch at once when a reconnect snapshot replaces the window, keeps it through the same window, and clears a failure", async () => {
    const gate = gated();
    let fetchPage = () => gate.promise;
    const server = await connect(() => fetchPage());
    await server.open();
    await server.sendThread(window());
    const loading = server.runtime.dispatch(loadEarlier, historyId(server));
    await server.sendThread({ ...window(), snapshotSequence: 3 });
    expect(loadingOf(server)).toBe(true);
    await server.sendThread({ ...window(), snapshotSequence: 5, historyCursor: "fresher" });
    expect(loadingOf(server)).toBe(false);
    expect(await loading).toBeUndefined();
    gate.release(pageOf("c-1", null));
    await settled();
    expect(server.thread().Timeline).toEqual(["c-9"]);
    expect(server.thread().History!.Cursor).toBe("fresher");

    fetchPage = () => Promise.reject(serverFailure("socket closed"));
    await server.runtime.dispatch(loadEarlier, historyId(server));
    expect(server.thread().History!.Error).toBe("socket closed");
    await server.sendThread({ ...window(), snapshotSequence: 7, historyCursor: "fresher" });
    expect(server.thread().History!.Error).toBeUndefined();
  });

  it("drops a page that queued behind the snapshot replacing its window", async () => {
    const gate = gated();
    const held = gated();
    const server = await connect((cursor) => (cursor === "hold" ? held.promise : gate.promise));
    await server.open();
    await server.sendThread(window());
    const loading = server.runtime.dispatch(loadEarlier, historyId(server));
    function* hold(draft: IOpenThread): IActionGenerator {
      yield* threadHistoryPage(draft.ThreadId, "hold");
    }
    const holding = server.runtime.dispatch(hold, server.openId());
    const replaced = server.sendThread({
      ...window(),
      snapshotSequence: 5,
      historyCursor: "fresher",
    });
    gate.release(pageOf("c-1", null));
    await loading;
    held.release(pageOf("unused", null));
    await Promise.all([holding, replaced]);
    await settled();
    expect(server.thread().Timeline).toEqual(["c-9"]);
    expect(server.thread().History!.Cursor).toBe("fresher");
  });

  it("stops without writing when the thread closes during the wait", async () => {
    const gate = gated();
    const server = await connect(() => gate.promise);
    await server.open();
    await server.sendThread(window());
    const loading = server.runtime.dispatch(loadEarlier, historyId(server));
    await server.runtime.dispatch(closeThread, server.envId(), THREAD_ID);
    gate.release(pageOf("c-1", null));
    await loading;
    expect(server.thread()).toBeUndefined();
  });
});

describe("thread notifications", () => {
  const at = "2026-01-01T00:00:00.000Z";
  const shellRow = (status: string, extra: object = {}) => ({
    id: "t-1",
    projectId: "p-1",
    updatedAt: at,
    createdAt: at,
    title: "Fix the build",
    status,
    latestRunId: "run-1",
    activeRunId: status === "running" ? "run-1" : null,
    latestRunCompletedAt: status === "running" ? null : "2026-01-01T00:05:00.000Z",
    activeProviderThreadId: null,
    pendingRuntimeRequest: null,
    lineage: { rootThreadId: "t-1", parentThreadId: null, relationshipToParent: null },
    ...extra,
  });
  const update = (sequence: number, thread: object) =>
    ({ kind: "thread.updated", sequence, location: "active", thread }) as unknown as IWireShellItem;

  it("announce a finished run from the shell's status events, skip what a reconnect replays, and open the thread on a click", async () => {
    const server = await connect(undefined, null, {
      storeClientSettings: () => undefined,
      chooseNotificationMode: () => "granted",
    });
    expect(server.device.NotifyModes).toEqual(["off"]);
    await server.sendShell(update(1, shellRow("running")));
    await server.sendShell({ kind: "synchronized" } as unknown as IWireShellItem);
    await server.sendShell(update(2, shellRow("completed")));
    expect(server.device.Notified).toEqual([]);
    await server.sendShell(update(3, shellRow("running", { latestRunId: "run-2" })));

    expect(
      await server.runtime.dispatch(chooseNotificationMode, server.envId(), "notifications"),
    ).toBeNull();
    expect(server.environment().Local.ClientSettings?.notificationMode).toBe("notifications");
    expect(server.device.NotifyModes).toEqual(["off", "notifications"]);
    await server.sendShell(
      update(4, shellRow("completed", { latestRunCompletedAt: "2026-01-01T00:09:00.000Z" })),
    );
    expect(server.device.Notified).toEqual([
      {
        ThreadId: "t-1",
        Kind: "completion",
        Status: "completion",
        Title: "Thread completed",
        Body: "Fix the build",
        Tag: threadNotificationTag(ENV, "t-1"),
        InApp: false,
        Viewing: false,
      },
    ]);

    await server.runtime.dispatch(
      ShellReceiver.handle,
      server.shellId(),
      { Type: "Shell/Stream", Resubscribing: true } as never,
      { publisher: { Id: server.shellId() } },
    );
    const done = shellRow("completed", { latestRunCompletedAt: "2026-01-01T00:09:00.000Z" });
    await server.sendShell(
      update(5, {
        ...done,
        pendingRuntimeRequest: { id: "req-1", kind: "command_approval", createdAt: at },
      }),
    );
    await server.sendShell(update(6, done));
    await server.sendShell({ kind: "synchronized" } as unknown as IWireShellItem);
    expect(server.device.Notified).toHaveLength(1);

    await server.runtime.dispatch(
      EnvironmentReceiver.handle,
      server.envId(),
      { Type: "Notify/Device", Opened: "t-1" } as never,
      { publisher: { Id: server.envId() } },
    );
    expect(server.environment().Local.SelectedThreadId).toBe("t-1");
  });

  it("announce with In-app notifications on alone, saying the status and whether the thread is on screen", async () => {
    const server = await connect(undefined, null, { storeClientSettings: () => undefined });
    await server.sendShell(update(1, shellRow("running")));
    await server.sendShell({ kind: "synchronized" } as unknown as IWireShellItem);
    await server.runtime.dispatch(writeSetting, server.envId(), {
      Store: "client",
      Patch: { inAppNotificationsEnabled: true },
    });
    expect(server.device.InApp).toEqual([false, true]);
    await server.sendShell(update(2, shellRow("failed")));
    await server.runtime.dispatch(selectThread, server.envId(), "t-1");
    await server.sendShell(update(3, shellRow("completed", { latestRunId: "run-2" })));
    expect(
      server.device.Notified.map((note) => [note.Title, note.Status, note.InApp, note.Viewing]),
    ).toEqual([
      ["Thread failed", "failed", true, false],
      ["Thread completed", "completion", true, true],
    ]);
    expect(server.device.Opened).toEqual(["t-1"]);
  });

  it("keep the mode when the browser refuses to notify, and say why", async () => {
    const server = await connect(undefined, null, {
      storeClientSettings: () => undefined,
      chooseNotificationMode: () => "denied",
    });
    expect(
      await server.runtime.dispatch(chooseNotificationMode, server.envId(), "notifications"),
    ).toMatch(/^Allow notifications in your browser/);
    expect(server.environment().Local.ClientSettings?.notificationMode).toBeUndefined();
    expect(server.device.NotifyModes).toEqual(["off"]);
  });
});

describe("the sidebar", () => {
  const row = (id: string, projectId: string, updatedAt: string, extra: object = {}) => ({
    id,
    projectId,
    updatedAt,
    title: id,
    status: "idle",
    latestRunId: null,
    activeProviderThreadId: null,
    pendingRuntimeRequest: null,
    lineage: { rootThreadId: id, parentThreadId: null, relationshipToParent: null },
    ...extra,
  });

  it("an open thread without a row marks its nearest listed ancestor's row", async () => {
    const server = await connect();
    const under = (parentId: string, relationship: "subagent" | null, sideChat = false) => ({
      archivedAt: null,
      lineage: {
        rootThreadId: "parent",
        parentThreadId: parentId,
        relationshipToParent: relationship,
        ...(sideChat ? { sideChat } : {}),
      },
    });
    const delegated = (parentId: string, archivedAt: string | null = null) => ({
      archivedAt,
      delegatedFrom: { environmentId: ENV, threadId: parentId, title: parentId },
    });
    const at = "2026-01-01T00:00:00.000Z";
    await server.sendShell({
      kind: "snapshot",
      snapshot: {
        snapshotSequence: 1,
        projects: [{ id: "p-1", title: "One", workspaceRoot: "/1" }],
        threads: [
          row("parent", "p-1", at, { archivedAt: null }),
          row("subagent", "p-1", at, under("parent", "subagent")),
          row("nested", "p-1", at, under("subagent", "subagent")),
          row("side", "p-1", at, under("parent", null, true)),
          row("task", "p-1", at, delegated("parent")),
          row("archived", "p-1", at, { archivedAt: at }),
          row("orphan-task", "p-1", at, delegated("archived")),
          row("orphan", "p-1", at, under("missing", "subagent")),
        ],
        archivedThreads: [],
      },
    } as unknown as IWireShellItem);
    const rowOf = async (threadId: string) => {
      await server.runtime.dispatch(selectThread, server.envId(), threadId);
      return server.runtime.processSelector(
        sidebarRowThreadId,
        () => server.environment().Replica.Shell,
      );
    };
    expect(await rowOf("parent")).toBe("parent");
    expect(await rowOf("subagent")).toBe("parent");
    expect(await rowOf("nested")).toBe("parent");
    expect(await rowOf("side")).toBe("parent");
    expect(await rowOf("task")).toBe("parent");
    expect(await rowOf("orphan-task")).toBe("orphan-task");
    expect(await rowOf("orphan")).toBe("orphan");
    // The shell omits an idle subagent, so its row comes from the open thread.
    expect(await rowOf(THREAD_ID)).toBe(THREAD_ID);
    await server.sendThread(
      snapshotOf(
        {
          ...emptyProjection(),
          thread: { ...emptyProjection().thread, ...under("subagent", "subagent") } as never,
        },
        1,
      ),
    );
    expect(await rowOf(THREAD_ID)).toBe("parent");
  });

  it("lists top-level threads and leaves subagents out, live", async () => {
    const server = await connect();
    const requestsOf = () =>
      server.runtime.processSelector(subagentRequests, () => server.environment().Replica.Shell);
    const empty = requestsOf();
    expect(empty).toEqual({});
    expect(requestsOf()).toBe(empty);
    await server.sendShell({
      kind: "snapshot",
      snapshot: {
        snapshotSequence: 1,
        projects: [{ id: "p-1", title: "One", workspaceRoot: "/1" }],
        threads: [
          row("old", "p-1", "2026-01-01T00:00:00.000Z"),
          row("child", "p-1", "2026-01-09T00:00:00.000Z", {
            lineage: {
              rootThreadId: "old",
              parentThreadId: "old",
              relationshipToParent: "subagent",
            },
            status: "running",
            pendingRuntimeRequest: { id: "r", kind: "command" },
          }),
        ],
        archivedThreads: [],
      },
    } as unknown as IWireShellItem);
    const shell = server.environment().Replica.Shell;
    const read = () =>
      server.runtime
        .processSelector(sidebarThreads, () => shell)
        .map((thread) => thread.id)
        .sort();
    expect(read()).toEqual(["old"]);
    expect(server.runtime.processSelector(subagentRequests, () => shell)).toEqual({
      old: "approval",
    });
    await server.sendShell({
      kind: "thread.updated",
      sequence: 2,
      location: "active",
      thread: row("new", "p-1", "2026-01-05T00:00:00.000Z"),
    } as unknown as IWireShellItem);
    expect(read()).toEqual(["new", "old"]);

    const at = "2026-01-01T00:00:00.000Z";
    const child = (
      id: string,
      parentThreadId: string,
      kind: string | null,
      extra: { sideChat?: boolean; [field: string]: unknown } = {},
    ) => {
      const { sideChat, ...fields } = extra;
      return row(id, "p-1", at, {
        status: "running",
        lineage: {
          rootThreadId: parentThreadId,
          parentThreadId,
          relationshipToParent: sideChat ? null : "subagent",
          ...(sideChat ? { sideChat } : {}),
        },
        pendingRuntimeRequest: kind === null ? null : { id: `r-${id}`, kind },
        ...fields,
      });
    };
    await server.sendShell({
      kind: "snapshot",
      snapshot: {
        snapshotSequence: 3,
        projects: [{ id: "p-1", title: "One", workspaceRoot: "/1" }],
        threads: [
          child("side-question", "side-parent", "user_input", { sideChat: true }),
          child("subagent-question", "question-parent", "user_input"),
          child("native", "native-parent", "command", { creationSource: "provider" }),
          child("finished", "finished-parent", "command", { status: "completed" }),
          child("mid", "top", null),
          child("grandchild", "mid", "command"),
          child("both-subagent", "both", "command"),
          child("both-side", "both", "user_input", { sideChat: true }),
          child("user-only", "user-only-parent", "user_input", {
            pendingRuntimeRequest: { id: "r-user-only", kind: "user_input", userOnly: true },
          }),
        ],
        archivedThreads: [],
      },
    } as unknown as IWireShellItem);
    expect(server.runtime.processSelector(subagentRequests, () => shell)).toEqual({
      "side-parent": "user_input",
      mid: "approval",
      top: "approval",
      both: "approval",
      "user-only-parent": "user_input",
    });
  });

  it("sorts rows into pinned, active, snoozed and settled", () => {
    const at = "2026-01-01T00:00:00.000Z";
    const future = "2026-01-02T00:00:00.000Z";
    const now = Date.parse("2026-01-01T12:00:00.000Z");
    const threads = [
      row("active", "p", at),
      row("pinned", "p", at, { pinnedAt: at, pinOrderKey: "b" }),
      row("pinned-first", "p", at, { pinnedAt: at, pinOrderKey: "a" }),
      row("settled-old", "p", at, { settledOverride: "settled", settledAt: at }),
      row("settled-new", "p", at, { settledOverride: "settled", settledAt: future }),
      row("snoozed", "p", at, { snoozedUntil: future, snoozedAt: at }),
      row("woke", "p", at, { snoozedUntil: at, snoozedAt: at }),
      row("asked", "p", at, {
        snoozedUntil: future,
        snoozedAt: at,
        pendingRuntimeRequest: { id: "r", kind: "command" },
      }),
      row("failed-since", "p", at, {
        snoozedUntil: future,
        snoozedAt: at,
        status: "failed",
        latestRunId: "run",
        latestRunCompletedAt: "2026-01-01T06:00:00.000Z",
      }),
      row("failed-before", "p", at, {
        snoozedUntil: future,
        snoozedAt: "2026-01-01T06:00:00.000Z",
        status: "failed",
        latestRunId: "run",
        latestRunCompletedAt: at,
      }),
      row("failed-undated", "p", at, {
        snoozedUntil: future,
        snoozedAt: at,
        status: "failed",
        latestRunId: "run",
        latestRunCompletedAt: null,
      }),
      row("subagent-asked", "p", at, { snoozedUntil: future, snoozedAt: at }),
      row("question-before", "p", at, {
        snoozedUntil: future,
        snoozedAt: "2026-01-01T06:00:00.000Z",
        pendingRuntimeRequest: { id: "q", kind: "user_input", createdAt: at },
      }),
      row("question-after", "p", at, {
        snoozedUntil: future,
        snoozedAt: at,
        pendingRuntimeRequest: {
          id: "q",
          kind: "user_input",
          createdAt: "2026-01-01T06:00:00.000Z",
        },
      }),
    ];
    const sections = sidebarSections(threads as never, now, { "subagent-asked": "approval" });
    const ids = (list: { id: string }[]) => list.map((thread) => thread.id);
    expect(ids(sections.Pinned)).toEqual(["pinned-first", "pinned"]);
    expect(ids(sections.Active)).toEqual([
      "active",
      "woke",
      "asked",
      "failed-since",
      "subagent-asked",
      "question-after",
    ]);
    expect(ids(sections.Snoozed)).toEqual([
      "snoozed",
      "failed-before",
      "failed-undated",
      "question-before",
    ]);
    expect(ids(sections.Settled)).toEqual(["settled-new", "settled-old"]);

    const snoozable = (extra: object, subagent?: "approval") =>
      canSnooze(row("t", "p", at, { latestRunId: "run", ...extra }) as never, subagent, now);
    const sent = { latestUserMessageAt: "2026-01-01T11:59:00.000Z", status: "completed" };
    expect([
      snoozable({ status: "completed" }),
      snoozable({ status: "queued" }),
      snoozable({ ...sent, latestRunRequestedAt: "2026-01-01T11:00:00.000Z" }),
      snoozable({ ...sent, latestRunRequestedAt: "2026-01-01T11:59:30.000Z" }),
      snoozable({ ...sent, latestUserMessageAt: "2026-01-01T09:00:00.000Z" }),
      snoozable({ pendingRuntimeRequest: { id: "r", kind: "command" } }),
      snoozable({}, "approval"),
      snoozable({ pendingGuestMessageCount: 1 }),
      snoozable({ pendingRuntimeRequest: { id: "q", kind: "user_input", createdAt: at } }),
    ]).toEqual([true, false, false, true, true, false, false, false, true]);
  });

  it("folds active rows into a folder per open project, pinned first and archived last", () => {
    const at = "2026-01-01T00:00:00.000Z";
    const project = (id: string, title: string, extra: object = {}) => ({
      id,
      title,
      workspaceRoot: `/${id}`,
      ...extra,
    });
    const projects = {
      zed: project("zed", "Zed", { pinnedAt: "2026-01-02T00:00:00.000Z" }),
      apple: project("apple", "Apple", { pinnedAt: at }),
      mango: project("mango", "Mango"),
      banana: project("banana", "Banana"),
      idle: project("idle", "Idle"),
      old: project("old", "Old", { archivedAt: at }),
    };
    const active = [row("m1", "mango", at), row("o1", "old", at), row("b1", "banana", at)];
    active.push(row("m2", "mango", at), row("gone", "missing", at));
    const folders = orderFolders(
      projectFolders(active as never, projects as never),
      "manual",
      [],
      [],
    );
    expect(folders.map((folder) => [folder.ProjectId, folder.Threads.map((t) => t.id)])).toEqual([
      ["apple", []],
      ["zed", []],
      ["missing", ["gone"]],
      ["banana", ["b1"]],
      ["idle", []],
      ["mango", ["m1", "m2"]],
      ["old", ["o1"]],
    ]);
  });

  it("leaves a hidden project out of every section and its folder, except the selected thread", () => {
    const at = "2026-01-01T00:00:00.000Z";
    const later = "2099-01-01T00:00:00.000Z";
    const threads = [
      row("shown", "kept", at),
      row("pinned", "gone", at, { pinnedAt: at }),
      row("active", "gone", at),
      row("snoozed", "gone", at, { snoozedUntil: later, snoozedAt: at }),
      row("settled", "gone", at, { settledOverride: "settled", settledAt: at }),
      row("open", "gone", at),
    ];
    const projects = {
      kept: { id: "kept", title: "Kept", workspaceRoot: "/kept" },
      gone: { id: "gone", title: "Gone", workspaceRoot: "/gone" },
      quiet: { id: "quiet", title: "Quiet", workspaceRoot: "/quiet" },
    };
    const hidden = new Set(["gone", "quiet"]);
    const ids = (list: { id: string }[]) => list.map((thread) => thread.id);
    const sections = (selected: string | null) =>
      sidebarSections(unhiddenThreads(threads as never, hidden, selected), Date.parse(at), {});
    const none = sections(null);
    expect([none.Pinned, none.Active, none.Snoozed, none.Settled].map(ids)).toEqual([
      [],
      ["shown"],
      [],
      [],
    ]);
    const folders = (selected: string | null) =>
      projectFolders(sections(selected).Active, projects as never, hidden).map((folder) => [
        folder.ProjectId,
        ids(folder.Threads),
      ]);
    expect(folders(null)).toEqual([["kept", ["shown"]]]);
    expect(folders("open")).toEqual([
      ["kept", ["shown"]],
      ["gone", ["open"]],
    ]);
    expect(ids(sections("settled").Settled)).toEqual(["settled"]);
    expect(unhiddenThreads(threads as never, new Set(), null)).toBe(threads);
  });

  it("lists threads in the sidebar's order, from this device's choices", () => {
    const at = "2026-01-01T00:00:00.000Z";
    const later = "2099-01-01T00:00:00.000Z";
    const project = (id: string, title: string) => ({ id, title, workspaceRoot: `/${id}` });
    const projects = {
      a: project("a", "Alpha"),
      b: project("b", "Beta"),
      h: project("h", "Hidden"),
    };
    const threads = [
      row("a1", "a", at, { createdAt: at }),
      row("pin", "a", at, { pinnedAt: at, pinOrderKey: "n" }),
      row("b1", "b", at, { createdAt: "2026-01-03T00:00:00.000Z" }),
      row("first", "a", at, { pinnedAt: at, pinOrderKey: "c", createdAt: at }),
      row("h1", "h", at),
      row("nap", "b", at, { snoozedUntil: later, snoozedAt: at }),
      row("done", "a", at, { settledOverride: "settled", settledAt: at }),
    ];
    const layout = (
      preferences: Partial<IPreferences> = {},
      selectedId: string | null = null,
      shelves: Partial<IShelves> = {},
      projectSort: IProjectSort = "manual",
    ) =>
      layoutSidebar({
        Threads: threads as never,
        Projects: projects as never,
        SelectedId: selectedId,
        Now: Date.parse(at),
        Subagents: {},
        Preferences: { ...storedPreferences, HiddenProjects: ["h"], ...preferences },
        ProjectSort: projectSort,
        Inbox: null,
        Shelves: {
          WorkingOpen: false,
          SnoozedOpen: false,
          SettledOpen: false,
          SettledShown: 25,
          ...shelves,
        },
      });
    const order = (...args: Parameters<typeof layout>) => layout(...args).Order;

    const ids = (list: { id: string }[]) => list.map((thread) => thread.id);
    expect(order()).toEqual(["first", "pin", "a1", "b1"]);
    expect(layout().Folders.map((folder) => [folder.ProjectId, ids(folder.Threads)])).toEqual([
      ["a", ["first", "pin", "a1"]],
      ["b", ["b1"]],
    ]);
    expect(layout().Sections.Pinned).toEqual([]);
    expect(order({ GroupByProject: false })).toEqual(["first", "pin", "a1", "b1"]);
    expect(ids(layout({ GroupByProject: false }).Sections.Pinned)).toEqual(["first", "pin"]);
    expect(layout({ GroupByProject: false }).Folders).toEqual([]);
    expect(order({ ProjectOrder: ["b", "a"] })).toEqual(["b1", "first", "pin", "a1"]);
    expect(order({}, null, {}, "created_at")).toEqual(["b1", "first", "pin", "a1"]);
    expect(order({ ClosedFolders: ["a"] })).toEqual(["b1"]);
    expect(order({ ClosedFolders: ["a"] }, "a1")).toEqual(["a1", "b1"]);
    expect(order({}, "h1")).toEqual(["first", "pin", "a1", "b1", "h1"]);
    expect(order({ HiddenProjects: [] })).toEqual(["first", "pin", "a1", "b1", "h1"]);

    expect(order({ ProjectScope: ["b"] })).toEqual(["b1"]);
    expect(layout({ ProjectScope: ["b"] }).Visible.map((thread) => thread.id)).toEqual([
      "b1",
      "nap",
    ]);
    expect(layout({ ProjectScope: ["h"] }).Scope).toEqual([]);
    expect(order({ ProjectScope: ["h"] })).toEqual(order());

    expect(order({}, null, { SnoozedOpen: true })).toEqual(["first", "pin", "a1", "b1", "nap"]);
    expect(order({}, "nap")).toEqual(["first", "pin", "a1", "b1", "nap"]);
    expect(order({}, null, { SettledOpen: true })).toEqual(["first", "pin", "a1", "b1", "done"]);
    expect(order({}, null, { SettledOpen: true, SettledShown: 0 })).toEqual(order());
  });

  it("reorders a pinned thread with a key between its new neighbours, clear of other folders' keys", async () => {
    const commands: { ThreadId: string; Command: IThreadCommand }[] = [];
    const server = await connect(undefined, null, {
      threadCommand: (effect: { ThreadId: string; Command: IThreadCommand }) => {
        commands.push({ ThreadId: effect.ThreadId, Command: effect.Command });
      },
    });
    const at = "2026-01-01T00:00:00.000Z";
    const pinned = (id: string, projectId: string, pinOrderKey: string) =>
      row(id, projectId, at, { pinnedAt: at, pinOrderKey, createdAt: at });
    await server.sendShell({
      kind: "snapshot",
      snapshot: {
        snapshotSequence: 1,
        projects: [
          { id: "a", title: "Alpha", workspaceRoot: "/a" },
          { id: "b", title: "Beta", workspaceRoot: "/b" },
        ],
        threads: [
          pinned("x", "a", "b"),
          pinned("y", "a", "d"),
          pinned("z", "a", "f"),
          pinned("other", "b", "c"),
        ],
        archivedThreads: [],
      },
    } as unknown as IWireShellItem);
    await server.runtime.dispatch(reorderPin, server.envId(), "z", ["x", "z", "y"]);
    const key = pinOrderKeyBetween("c", "d")!;
    expect(commands).toEqual([{ ThreadId: "z", Command: { Kind: "reorderPin", OrderKey: key } }]);
    expect(key > "b" && key < "d" && key !== "c").toBe(true);
  });

  it("settles the open thread and moves to the sidebar's next unparked row, and the shortcut toggles", async () => {
    const commands: { ThreadId: string; Command: { Kind: string } }[] = [];
    let refusal: string | null = null;
    const server = await connect(
      undefined,
      null,
      {
        threadCommand: (effect: { ThreadId: string; Command: { Kind: string } }) => {
          if (effect.Command.Kind === "visit") return;
          if (refusal !== null) throw serverFailure(refusal);
          commands.push(effect);
        },
      },
      undefined,
      undefined,
      undefined,
      [toggleSettleOpenThread],
    );
    const at = "2026-01-01T00:00:00.000Z";
    await server.sendShell({
      kind: "snapshot",
      snapshot: {
        snapshotSequence: 1,
        projects: [
          { id: "a", title: "Alpha", workspaceRoot: "/a" },
          { id: "b", title: "Beta", workspaceRoot: "/b" },
          { id: "lone", title: "Lone", workspaceRoot: "/lone" },
        ],
        threads: [
          row("a1", "a", "2026-01-03T00:00:00.000Z"),
          row("a2", "a", "2026-01-02T00:00:00.000Z"),
          row("b1", "b", at),
          row("nap", "b", at, { snoozedUntil: "2099-01-01T00:00:00.000Z", snoozedAt: at }),
          row("done", "a", at, { settledOverride: "settled", settledAt: at }),
        ],
        archivedThreads: [],
      },
    } as unknown as IWireShellItem);
    const envId = server.envId();
    const selected = () => server.environment().Local.SelectedThreadId;
    const order = () => server.runtime.processSelector(sidebarLayout, server.environment).Order;
    const take = () => commands.splice(0).map((sent) => [sent.ThreadId, sent.Command.Kind]);

    await server.runtime.dispatch(selectThread, envId, "a1");
    const next = adjacentThread(order(), "a1", "next");
    expect(next).toBe("a2");
    await server.runtime.dispatch(toggleSettleOpenThread, envId);
    expect(take()).toEqual([["a1", "settle"]]);
    expect(selected()).toBe(next);

    await server.runtime.dispatch(toggleShelf, envId, "Snoozed");
    await server.runtime.dispatch(toggleShelf, envId, "Settled");
    await server.runtime.dispatch(selectThread, envId, "b1");
    expect(order()).toEqual(["a1", "a2", "b1", "nap", "done"]);
    await server.runtime.dispatch(settleThread, envId, "b1");
    expect(take()).toEqual([["b1", "settle"]]);
    expect(selected()).toBe("a1");

    await server.runtime.dispatch(selectThread, envId, "done");
    await server.runtime.dispatch(toggleSettleOpenThread, envId);
    expect(take()).toEqual([["done", "unsettle"]]);
    expect(selected()).toBe("done");

    await server.runtime.dispatch(settleThread, envId, "a2");
    expect(take()).toEqual([["a2", "settle"]]);
    expect(selected()).toBe("done");

    await server.runtime.dispatch(selectThread, envId, "a1");
    refusal = "The thread received another run before settlement.";
    await server.runtime.dispatch(toggleSettleOpenThread, envId);
    expect(server.takeToasts()).toEqual([
      { Kind: "error", Title: "Failed to settle thread", Description: refusal },
    ]);
    expect(selected()).toBe("a1");
    refusal = null;

    await server.sendShell({
      kind: "thread.updated",
      sequence: 2,
      location: "active",
      thread: row("only", "lone", at),
    } as unknown as IWireShellItem);
    await server.runtime.dispatch(toggleProjectScope, envId, "lone");
    await server.runtime.dispatch(selectThread, envId, "only");
    await server.runtime.dispatch(toggleSettleOpenThread, envId);
    expect(take()).toEqual([["only", "settle"]]);
    expect(server.environment().Local.ThreadSessions[selected()!]?.NewThreadProjectId).toBe("lone");
  });

  it("settles several threads at once, moving the open one past the others being settled", async () => {
    const commands: { ThreadId: string; Command: { Kind: string } }[] = [];
    const server = await connect(undefined, null, {
      threadCommand: (effect: { ThreadId: string; Command: { Kind: string } }) => {
        if (effect.Command.Kind !== "visit") commands.push(effect);
      },
    });
    const at = "2026-01-01T00:00:00.000Z";
    await server.sendShell({
      kind: "snapshot",
      snapshot: {
        snapshotSequence: 1,
        projects: [{ id: "a", title: "Alpha", workspaceRoot: "/a" }],
        threads: [
          row("a1", "a", "2026-01-04T00:00:00.000Z"),
          row("a2", "a", "2026-01-03T00:00:00.000Z"),
          row("a3", "a", "2026-01-02T00:00:00.000Z"),
          row("done", "a", at, { settledOverride: "settled", settledAt: at }),
        ],
        archivedThreads: [],
      },
    } as unknown as IWireShellItem);
    const envId = server.envId();
    await server.runtime.dispatch(selectThread, envId, "a1");
    await server.runtime.dispatch(settleThreads, envId, ["a1", "a2", "done"]);
    expect(commands.map((sent) => [sent.ThreadId, sent.Command.Kind])).toEqual([
      ["a1", "settle"],
      ["a2", "settle"],
    ]);
    expect(server.environment().Local.SelectedThreadId).toBe("a3");
  });

  it("archives a thread, opening a new thread in its project when it was the open one", async () => {
    const commands: { ThreadId: string; Command: { Kind: string } }[] = [];
    let refusal: string | null = null;
    const server = await connect(undefined, null, {
      threadCommand: (effect: { ThreadId: string; Command: { Kind: string } }) => {
        if (effect.Command.Kind === "visit") return;
        if (refusal !== null) throw serverFailure(refusal);
        commands.push(effect);
      },
    });
    const at = "2026-01-01T00:00:00.000Z";
    await server.sendShell({
      kind: "snapshot",
      snapshot: {
        snapshotSequence: 1,
        projects: [{ id: "a", title: "Alpha", workspaceRoot: "/a" }],
        threads: [row("a1", "a", at), row("a2", "a", at)],
        archivedThreads: [],
      },
    } as unknown as IWireShellItem);
    const envId = server.envId();
    const selected = () => server.environment().Local.SelectedThreadId;
    await server.runtime.dispatch(selectThread, envId, "a1");

    await server.runtime.dispatch(archiveThread, envId, "a2");
    expect(selected()).toBe("a1");
    await server.runtime.dispatch(archiveThread, envId, "a1");
    expect(commands.map((sent) => [sent.ThreadId, sent.Command.Kind])).toEqual([
      ["a2", "archive"],
      ["a1", "archive"],
    ]);
    expect(server.environment().Local.ThreadSessions[selected()!]?.NewThreadProjectId).toBe("a");

    await server.runtime.dispatch(selectThread, envId, "a2");
    refusal = "Cannot archive while the provider is active.";
    await server.runtime.dispatch(archiveThread, envId, "a2");
    expect(selected()).toBe("a2");
    expect(server.takeToasts()).toEqual([
      { Kind: "error", Title: "Failed to archive thread", Description: refusal },
    ]);
  });

  it("regenerates titles under their own request ids, and toasts once the rows report them all", async () => {
    const sent: { ThreadId: string; CommandId: string; Command: IThreadCommand }[] = [];
    let refusal: string | null = null;
    const server = await connect(undefined, null, {
      threadCommand: (effect: { ThreadId: string; CommandId: string; Command: IThreadCommand }) => {
        if (effect.Command.Kind === "visit") return;
        if (refusal !== null && effect.ThreadId === "c") throw serverFailure(refusal);
        sent.push(effect);
      },
    });
    const at = "2026-01-01T00:00:00.000Z";
    const busy = { requestId: "earlier", startedAt: at };
    await server.sendShell({
      kind: "snapshot",
      snapshot: {
        snapshotSequence: 1,
        projects: [{ id: "a", title: "Alpha", workspaceRoot: "/a" }],
        threads: [
          row("a", "a", at),
          row("b", "a", at),
          row("c", "a", at),
          row("busy", "a", at, { titleRegeneration: busy }),
        ],
        archivedThreads: [],
      },
    } as unknown as IWireShellItem);
    refusal = "server said no";
    await server.runtime.dispatch(regenerateTitles, server.envId(), ["a", "b", "c", "busy"]);
    expect(sent.map((held) => held.ThreadId)).toEqual(["a", "b"]);
    for (const held of sent) {
      expect(held.Command).toEqual({ Kind: "regenerateTitle", RequestId: expect.any(String) });
    }
    expect(server.takeToasts()).toEqual([
      { Kind: "error", Title: "Failed to regenerate thread title", Description: refusal },
    ]);
    const requestOf = (id: string) =>
      (sent.find((held) => held.ThreadId === id)!.Command as { RequestId: string }).RequestId;
    const report = (sequence: number, id: string, status: string) =>
      server.sendShell({
        kind: "thread.updated",
        sequence,
        location: "active",
        thread: row(id, "a", at, {
          titleRegeneration: null,
          lastTitleRegeneration: { requestId: requestOf(id), status, completedAt: at },
        }),
      } as unknown as IWireShellItem);
    await report(2, "a", "unchanged");
    expect(server.takeToasts()).toEqual([]);
    await report(3, "b", "renamed");
    expect(server.takeToasts()).toEqual([
      {
        Kind: "info",
        Title: "Kept 1 of 2 titles",
        Description: "Those titles already fit their threads.",
      },
    ]);
  });

  it("folds working threads into the Working section, which holds a finished one for two seconds", async () => {
    const server = await connect(
      undefined,
      null,
      { storeClientSettings: () => undefined },
      undefined,
      undefined,
      { ...storedPreferences, GroupByProject: false },
    );
    const read = () => server.runtime.processSelector(sidebarLayout, server.environment);
    const ids = (list: { id: string }[]) => list.map((thread) => thread.id);
    const at = "1970-01-01T00:00:00.000Z";
    const running = row("busy", "p-1", at, {
      createdAt: at,
      status: "running",
      latestRunId: "run-1",
      activeRunId: "run-1",
    });
    await server.sendShell({
      kind: "snapshot",
      snapshot: {
        snapshotSequence: 1,
        projects: [{ id: "p-1", title: "One", workspaceRoot: "/1" }],
        threads: [row("idle", "p-1", at, { createdAt: at }), running],
        archivedThreads: [],
      },
    } as unknown as IWireShellItem);
    await server.sendShell({ kind: "synchronized" } as unknown as IWireShellItem);
    expect(ids(read().Sections.Working)).toEqual(["busy"]);
    expect(ids(read().Sections.Active)).toEqual(["idle"]);
    expect(read().Order).toEqual(["idle"]);
    await server.runtime.dispatch(toggleShelf, server.envId(), "Working");
    expect(read().Order).toEqual(["idle", "busy"]);

    server.device.Now = 1_000;
    await server.sendShell({
      kind: "thread.updated",
      sequence: 2,
      location: "active",
      thread: { ...running, status: "completed", activeRunId: null, latestRunCompletedAt: at },
    } as unknown as IWireShellItem);
    expect(ids(read().Sections.Working)).toEqual(["busy"]);
    expect(server.runtime.timers(server.shellId())).toMatchObject([{ Key: "Shell/InboxGrace" }]);
    server.device.Now = 3_000;
    await server.runtime.dispatch(
      ShellReceiver.handle,
      server.shellId(),
      { Type: "Shell/InboxGrace" } as never,
      { publisher: { Id: server.shellId() } },
    );
    expect(read().Sections.Working).toEqual([]);
    expect(ids(read().Sections.Active)).toEqual(["busy", "idle"]);
    expect(server.runtime.timers(server.shellId())).toEqual([]);

    await server.runtime.dispatch(writeSetting, server.envId(), {
      Store: "client",
      Patch: { sidebarWorkingShelfEnabled: false },
    });
    await server.sendShell({
      kind: "thread.updated",
      sequence: 3,
      location: "active",
      thread: { ...running, latestRunId: "run-2", activeRunId: "run-2" },
    } as unknown as IWireShellItem);
    expect(read().Sections.Working).toEqual([]);
    expect(ids(read().Sections.Active)).toEqual(["busy", "idle"]);
  });

  it("keeps this device's choices, restores them in a fresh client, and wakes snoozed rows on the clock", async () => {
    const first = await connect(undefined, null, { storeClientSettings: () => undefined });
    const read = () => first.runtime.processSelector(sidebarLayout, first.environment);
    await first.sendShell({
      kind: "snapshot",
      snapshot: {
        snapshotSequence: 1,
        projects: [
          { id: "p-1", title: "One", workspaceRoot: "/1" },
          { id: "p-2", title: "Two", workspaceRoot: "/2" },
        ],
        threads: [
          row("t-1", "p-1", "2026-01-01T00:00:00.000Z"),
          row("t-2", "p-2", "2026-01-01T00:00:00.000Z"),
          row("nap", "p-2", "2026-01-01T00:00:00.000Z", {
            snoozedUntil: "1970-01-01T00:01:00.000Z",
            snoozedAt: "1970-01-01T00:00:00.000Z",
          }),
        ],
        archivedThreads: [],
      },
    } as unknown as IWireShellItem);
    expect(read().Order).toEqual(["t-1", "t-2"]);

    const envId = first.envId();
    await first.runtime.dispatch(setProjectHidden, envId, "p-1", true);
    await first.runtime.dispatch(toggleFolder, envId, "p-2");
    await first.runtime.dispatch(toggleProjectScope, envId, "p-2");
    await first.runtime.dispatch(writeSetting, envId, {
      Store: "client",
      Patch: { sidebarProjectSortOrder: "created_at" },
    });
    await first.runtime.dispatch(setPreferences, envId, { ProjectOrder: ["p-2", "p-1"] });
    await first.runtime.dispatch(setPreferences, envId, { SidebarCollapsed: true });
    await first.runtime.dispatch(setPreferences, envId, { SidebarWidth: 320 });
    await first.runtime.dispatch(setAppearanceMode, envId, "dark");
    const chosen: IPreferences = {
      ...storedPreferences,
      HiddenProjects: ["p-1"],
      ClosedFolders: ["p-2"],
      ProjectScope: ["p-2"],
      ProjectOrder: ["p-2", "p-1"],
      SidebarCollapsed: true,
      SidebarWidth: 320,
      AppearanceMode: "dark",
    };
    expect(first.device.Preferences).toEqual(chosen);
    expect(first.environment().Local.Preferences).toEqual(chosen);
    expect(read().Order).toEqual([]);
    await first.runtime.dispatch(toggleFolder, envId, "p-2");
    expect(read().Order).toEqual(["t-2"]);
    await first.runtime.dispatch(toggleProjectScope, envId, null);
    await first.runtime.dispatch(setProjectHidden, envId, "p-1", false);
    expect(read().Order).toEqual(["t-1", "t-2"]);
    await first.runtime.dispatch(writeSetting, envId, {
      Store: "client",
      Patch: { sidebarProjectSortOrder: "manual" },
    });
    expect(read().Order).toEqual(["t-2", "t-1"]);

    first.device.Now = 120_000;
    await first.runtime.dispatch(toggleShelf, envId, "Snoozed");
    expect(read().Order).toEqual(["t-2", "t-1", "nap"]);
    expect(read().Sections.Snoozed.map((thread) => thread.id)).toEqual(["nap"]);
    first.clock.changed();
    expect(read().Sections.Snoozed).toEqual([]);
    expect(read().Order).toEqual(["nap", "t-2", "t-1"]);

    const second = await connect(undefined, null, {}, undefined, undefined, chosen);
    expect(second.environment().Local.Preferences).toEqual(chosen);
    expect(second.environment().Local.Shelves.SnoozedOpen).toBe(false);
  });

  it("applies the color scheme from the mode and the system, and passes it to an open terminal", async () => {
    const server = await connect();
    const appearance = (SystemDark: boolean, Mode: IAppearanceMode | null = null) =>
      server.runtime.dispatch(
        PreferencesReceiver.handle,
        server.envId(),
        { Type: "Device/Appearance", SystemDark, Mode },
        { publisher: { Id: server.envId() } },
      );
    const scheme = () => server.runtime.processSelector(colorScheme, server.environment);
    await appearance(true);
    await settled();
    expect(scheme()).toBe("dark");
    expect(server.device.Applied).toEqual(["dark"]);

    await server.runtime.dispatch(setAppearanceMode, server.envId(), "light");
    expect(scheme()).toBe("light");
    expect(server.device.Preferences.AppearanceMode).toBe("light");

    await server.runtime.dispatch(selectThread, server.envId(), THREAD_ID);
    await server.sendShell({
      kind: "snapshot",
      snapshot: {
        snapshotSequence: 1,
        projects: [{ id: "p-1", title: "One", workspaceRoot: "/1" }],
        threads: [],
        archivedThreads: [],
      },
    } as unknown as IWireShellItem);
    const projection = emptyProjection();
    await server.sendThread(
      snapshotOf({ ...projection, thread: { ...projection.thread, projectId: "p-1" } } as never, 1),
    );
    await server.runtime.dispatch(openTerminal, server.terminalId());
    expect(server.device.Schemes).toEqual(["light"]);

    // Another tab set the mode, so it's applied without being stored again.
    server.device.Preferences = { ...server.device.Preferences, AppearanceMode: "system" };
    await appearance(true, "dark");
    await settled();
    expect(server.environment().Local.Preferences.AppearanceMode).toBe("dark");
    expect(server.device.Preferences.AppearanceMode).toBe("system");
    expect(server.device.Applied.at(-1)).toBe("dark");
    expect(server.device.Schemes).toEqual(["light", "dark"]);
  });

  it("derives a row's status and how long it has been working", () => {
    const at = "2026-01-01T00:00:00.000Z";
    const status = (extra: object, subagent?: "approval" | "user_input") =>
      sidebarStatus(row("t", "p", at, { latestRunId: "r", ...extra }) as never, subagent);
    expect(status({ status: "running" })).toBe("working");
    const holding = { pendingBackgroundTasks: [{ kind: "subagent", awaited: true }] };
    const unseen = { latestRunCompletedAt: at, lastVisitedAt: "2025-01-01" };
    expect(status({ status: "completed", ...unseen, ...holding })).toBe("waiting");
    expect(status({ status: "running", ...holding })).toBe("waiting");
    expect(status({ status: "running", blockedOnThreadWait: true })).toBe("waiting");
    expect(
      status({ status: "failed", pendingBackgroundTasks: [{ kind: "subagent", awaited: true }] }),
    ).toBe("failed");
    expect(status({ status: "idle", ...unseen })).toBeNull();
    expect(status({ status: "running", latestRunId: null })).toBeNull();
    expect(status({ status: "running" }, "approval")).toBe("approval");
    expect(status({ status: "running" }, "user_input")).toBe("input");
    expect(
      status(
        { status: "running", pendingRuntimeRequest: { id: "r", kind: "user_input" } },
        "approval",
      ),
    ).toBe("approval");
    expect(status({ status: "completed", latestRunId: "r", lastVisitedAt: "2025-01-01" })).toBe(
      "done",
    );
    expect(status({ status: "running", pendingRuntimeRequest: { id: "r", kind: "command" } })).toBe(
      "approval",
    );
    expect(
      status({ status: "running", pendingRuntimeRequest: { id: "r", kind: "user_input" } }),
    ).toBe("input");
    expect(status({ status: "failed" })).toBe("failed");
    expect(
      status({ status: "failed", latestRunCompletedAt: at, lastVisitedAt: "2025-01-01" }),
    ).toBe("failed");
    expect(status({ status: "failed", latestRunCompletedAt: at, lastVisitedAt: at })).toBeNull();
    expect(
      status({
        status: "failed",
        lastErrorClass: "usage_limit",
        latestRunCompletedAt: at,
        lastVisitedAt: at,
      }),
    ).toBe("failed");
    expect(
      status({ status: "running", latestRunId: null, activeProviderThreadId: "pt" }),
    ).toBeNull();
    expect(status({ status: "preparing" })).toBe("preparing");
    expect(
      activityAt(
        row("t", "p", at, {
          latestRunId: "r",
          latestUserMessageAt: "2026-01-01T10:00:00.000Z",
          latestRunCompletedAt: "2026-01-01T10:40:00.000Z",
        }) as never,
      ),
    ).toBe("2026-01-01T10:40:00.000Z");
    expect(
      status({ status: "completed", latestRunCompletedAt: at, lastVisitedAt: "2025-01-01" }),
    ).toBe("done");
    expect(status({ status: "completed", latestRunCompletedAt: at, lastVisitedAt: at })).toBeNull();
    for (const stopped of ["interrupted", "cancelled"]) {
      expect(status({ status: stopped, ...unseen })).toBeNull();
    }

    const started = (extra: object) => workingStartedAt(row("t", "p", at, extra) as never);
    const run = "2026-01-01T01:00:00.000Z";
    expect(started({ latestRunId: "a", activityRunStartedAt: run })).toBe(run);
    expect(started({ latestRunId: "a", activityRunStartedAt: "not a time" })).toBeNull();
    expect(started({ activityRunStartedAt: run })).toBeNull();
    const live = { status: "running", activeRunId: "a", latestRunId: "a", latestRunStartedAt: run };
    expect(started(live)).toBe(run);
    expect(started({ ...live, latestRunId: "b" })).toBeNull();
    expect(started({ ...live, status: "completed" })).toBeNull();
  });
});

describe("selection", () => {
  const streams = (server: Awaited<ReturnType<typeof connect>>) =>
    server.runtime
      .resources()
      .filter((resource) => resource.Key === "Thread/Stream")
      .map((resource) => (resource.Params as unknown as { ThreadId: string }).ThreadId);

  it("opening a thread closes the previous one's stream and keeps its session", async () => {
    const server = await connect();
    await server.runtime.dispatch(selectThread, server.envId(), "a");
    await server.runtime.dispatch(setDraft, server.sessionId("a"), "kept");
    expect(streams(server)).toEqual(["a"]);
    await server.runtime.dispatch(selectThread, server.envId(), "b");
    expect(streams(server)).toEqual(["b"]);
    expect(server.environment().Local.SelectedThreadId).toBe("b");
    expect(server.environment().Local.ThreadSessions["a"]!.Draft).toBe("kept");
    expect(server.address.thread).toBe("b");
  });

  it("keeps a left thread's data, and a return resumes its stream from where it stopped", async () => {
    const server = await connect();
    await server.runtime.dispatch(selectThread, server.envId(), THREAD_ID);
    await server.sendThread(snapshotOf(longThread(3), 5));
    await server.sendThread({ kind: "synchronized" });
    const node = server.thread();
    const synchronized = () => server.runtime.processSelector(threadSynchronized, server.thread);

    await server.runtime.dispatch(selectThread, server.envId(), "b");
    expect(streams(server)).toEqual(["b"]);
    expect(server.thread()).toBe(node);
    expect(server.runtime.timers(server.openId())).toMatchObject([
      { Key: "Thread/Expire", IntervalMs: RETAIN_MS },
    ]);
    expect(synchronized()).toBe(false);

    await server.runtime.dispatch(selectThread, server.envId(), THREAD_ID);
    expect(server.thread()).toBe(node);
    expect(server.runtime.timers(server.openId())).toEqual([]);
    const row = server.runtime
      .resources()
      .find((resource) => resource.Key === "Thread/Stream" && resource.OwnerId === node.$Id);
    expect(row?.ResumeFrom).toBe("LastSequence");
    expect(server.thread().LastSequence).toBe(5);
    expect(server.thread().Timeline).toEqual(["item-0", "item-1", "item-2"]);
    await server.sendThread({
      kind: "event",
      sequence: 6,
      event: event("turn-item.updated", commandItem("missed", "run-0", 9)),
    } as IWireThreadItem);
    await server.sendThread({ kind: "synchronized" });
    expect(server.thread().Timeline).toEqual(["item-0", "item-1", "item-2", "missed"]);
    expect(synchronized()).toBe(true);
  });

  it("drops a left thread when its retention expires, but not the selected one", async () => {
    const server = await connect();
    await server.runtime.dispatch(selectThread, server.envId(), THREAD_ID);
    await server.sendThread(snapshotOf(longThread(3), 5));
    const expire = () =>
      server.runtime.dispatch(
        ThreadReceiver.handle,
        server.openId(),
        { Type: "Thread/Expire" },
        { publisher: { Id: server.openId() } },
      );
    await expire();
    await settled();
    expect(server.thread()).toBeDefined();

    await server.runtime.dispatch(selectThread, server.envId(), "b");
    const gone = server.disposed(server.openId());
    await expire();
    await gone;
    expect(server.thread()).toBeUndefined();
    expect(server.environment().Local.ThreadSessions[THREAD_ID]).toBeDefined();
    await server.runtime.dispatch(selectThread, server.envId(), THREAD_ID);
    expect(server.thread().LastSequence).toBe(0);
  });

  const row = (id: string, lineage: object) => ({
    id,
    projectId: "p-1",
    updatedAt: "2026-01-01T00:00:00.000Z",
    title: id,
    status: "idle",
    archivedAt: null,
    latestRunId: null,
    activeProviderThreadId: null,
    pendingRuntimeRequest: null,
    lineage,
  });
  const sideChatShell = (server: Awaited<ReturnType<typeof connect>>) =>
    server.sendShell({
      kind: "snapshot",
      snapshot: {
        snapshotSequence: 1,
        projects: [{ id: "p-1", title: "One", workspaceRoot: "/1" }],
        threads: [
          row("a", { rootThreadId: "a", parentThreadId: null, relationshipToParent: null }),
          row("side", {
            rootThreadId: "a",
            parentThreadId: "a",
            relationshipToParent: null,
            sideChat: true,
          }),
        ],
        archivedThreads: [],
      },
    } as unknown as IWireShellItem);

  it("a side thread opens beside the selected one without a history step, and closing it retains it", async () => {
    const server = await connect();
    await server.runtime.dispatch(selectThread, server.envId(), "a");
    await server.runtime.dispatch(openSideThread, server.envId(), "s", "primary");
    expect(server.environment().Local.SelectedThreadId).toBe("a");
    expect(server.session("a").Panels.Side).toEqual({ ThreadId: "s" });
    expect(streams(server)).toEqual(["a", "s"]);
    expect(server.address.history.entries).toHaveLength(2);
    const side = server.environment().Replica.OpenThreads["s"]!;
    await server.runtime.dispatch(closeSideThread, server.envId());
    expect(server.session("a").Panels.Side).toBeNull();
    expect(streams(server)).toEqual(["a"]);
    expect(server.runtime.timers(side.$Id)).toMatchObject([{ Key: "Thread/Expire" }]);
  });

  it("the modifier opens a side thread in the other place, and the setting swaps them", async () => {
    const server = await connect(undefined, null, { storeClientSettings: () => {} });
    await server.runtime.dispatch(selectThread, server.envId(), "a");
    await server.runtime.dispatch(openSideThread, server.envId(), "s", "alternate");
    expect(server.environment().Local.SelectedThreadId).toBe("s");
    expect(server.address.thread).toBe("s");
    await server.go(-1);
    expect(server.session("a").Panels.Side).toBeNull();

    await server.runtime.dispatch(writeSetting, server.envId(), {
      Store: "client",
      Patch: { sideThreadOpenTarget: "main" },
    });
    await server.runtime.dispatch(openSideThread, server.envId(), "s", "alternate");
    expect(server.session("a").Panels.Side).toEqual({ ThreadId: "s" });
    await server.runtime.dispatch(openSideThread, server.envId(), "t", "primary");
    expect(server.environment().Local.SelectedThreadId).toBe("t");
  });

  it("opens the thread's own parent in place, and moves a side thread to the main view without it staying beside", async () => {
    const server = await connect();
    await server.runtime.dispatch(selectThread, server.envId(), "a");
    await server.runtime.dispatch(openSideThread, server.envId(), "a", "primary");
    expect(server.session("a").Panels.Side).toBeNull();
    await server.runtime.dispatch(openSideThread, server.envId(), "s", "primary");
    await server.runtime.dispatch(openSideThread, server.envId(), "s", "main");
    expect(server.environment().Local.SelectedThreadId).toBe("s");
    expect(server.session("a").Panels.Side).toBeNull();
    expect(streams(server)).toEqual(["s"]);
  });

  it("leaving a thread retains its side thread, a return reopens both, and a shown one doesn't expire", async () => {
    const server = await connect();
    await server.runtime.dispatch(selectThread, server.envId(), "a");
    await server.runtime.dispatch(openSideThread, server.envId(), "s", "primary");
    await server.runtime.dispatch(selectThread, server.envId(), "b");
    expect(streams(server)).toEqual(["b"]);
    await server.runtime.dispatch(selectThread, server.envId(), "a");
    expect(streams(server)).toEqual(["a", "s"]);
    const side = server.environment().Replica.OpenThreads["s"]!;
    await server.runtime.dispatch(
      EnvironmentReceiver.handle,
      server.envId(),
      { Type: "Thread/Expired", ThreadId: "s" },
      { publisher: { Id: side.$Id } },
    );
    expect(server.environment().Replica.OpenThreads["s"]).toBeDefined();
  });

  it("deleting or losing a thread retains the side thread beside it", async () => {
    const server = await connect();
    const expiring = (threadId: string) =>
      server.runtime.timers(server.environment().Replica.OpenThreads[threadId]!.$Id);
    await server.runtime.dispatch(selectThread, server.envId(), "a");
    await server.runtime.dispatch(openSideThread, server.envId(), "s", "primary");
    await server.runtime.dispatch(threadCommand, server.envId(), "a", { Kind: "delete" });
    expect(streams(server)).not.toContain("s");
    expect(expiring("s")).toMatchObject([{ Key: "Thread/Expire" }]);

    await server.runtime.dispatch(selectThread, server.envId(), "c");
    await server.runtime.dispatch(openSideThread, server.envId(), "t", "primary");
    await server.runtime.dispatch(
      EnvironmentReceiver.handle,
      server.envId(),
      { Type: "Thread/Missing", ThreadId: "c" },
      { publisher: { Id: server.envId() } },
    );
    expect(streams(server)).not.toContain("t");
    expect(expiring("t")).toMatchObject([{ Key: "Thread/Expire" }]);
  });

  it("a side chat started just before leaving its thread is beside it on return", async () => {
    let release = () => {};
    const server = await connect(undefined, null, {
      forkThread: () => new Promise<void>((resolve) => (release = resolve)),
    });
    await server.runtime.dispatch(selectThread, server.envId(), "a");
    const started = server.runtime.dispatch(startSideChat, server.envId());
    await settled();
    await server.runtime.dispatch(selectThread, server.envId(), "b");
    release();
    await started;
    const sideId = server.session("a").Panels.Side?.ThreadId;
    expect(sideId).toBeDefined();
    expect(streams(server)).toEqual(["b"]);
    await server.runtime.dispatch(selectThread, server.envId(), "a");
    expect(streams(server)).toEqual(["a", sideId]);
  });

  it("opening the diff replaces the side thread, and an unused side chat is deleted when it goes", async () => {
    const commands: Array<{ ThreadId: string; Command: unknown }> = [];
    const server = await connect(undefined, null, {
      threadCommand: (effect: { ThreadId: string; Command: unknown }) => void commands.push(effect),
    });
    await sideChatShell(server);
    await server.runtime.dispatch(selectThread, server.envId(), "a");
    await server.runtime.dispatch(openSideThread, server.envId(), "side", "primary");
    commands.length = 0;
    await server.runtime.dispatch(openDiff, server.sessionId("a"), "branch", null);
    await settled();
    expect(server.session("a").Panels.Side).toBeNull();
    expect(streams(server)).toEqual(["a"]);
    expect(commands).toMatchObject([
      { ThreadId: "side", Command: { Kind: "delete", OnlyIfUnused: true } },
    ]);
    expect(server.environment().Local.ThreadSessions["side"]).toBeDefined();
  });

  it("a link to a side chat opens its parent with the side chat beside it", async () => {
    const server = await connect();
    await sideChatShell(server);
    await server.runtime.dispatch(openThreadLink, server.envId(), "side");
    expect(server.environment().Local.SelectedThreadId).toBe("a");
    expect(server.session("a").Panels.Side).toEqual({ ThreadId: "side" });
    await server.runtime.dispatch(openThreadLink, server.envId(), "b");
    expect(server.environment().Local.SelectedThreadId).toBe("b");
  });

  it("starting a side chat forks the latest stable point and opens it beside, with the parent's picks", async () => {
    const forks: unknown[] = [];
    const server = await connect(undefined, null, {
      forkThread: (effect: unknown) => void forks.push(effect),
    });
    await server.runtime.dispatch(selectThread, server.envId(), "a");
    await server.runtime.dispatch(setRuntimeMode, server.sessionId("a"), "approval-required");
    await server.runtime.dispatch(startSideChat, server.envId());
    const sideId = server.session("a").Panels.Side?.ThreadId;
    expect(forks).toMatchObject([
      { SourceThreadId: "a", TargetThreadId: sideId, RunId: null, Title: "Side chat" },
    ]);
    expect(streams(server)).toEqual(["a", sideId]);
    expect(server.session(sideId).RuntimeMode).toBe("approval-required");
  });

  it("a reload returns to the thread in the address", async () => {
    const server = await connect(undefined, "from-address");
    expect(streams(server)).toEqual(["from-address"]);
    expect(server.environment().Local.SelectedThreadId).toBe("from-address");
  });

  it("each thread or page opened adds a history entry, and back and forward return to them", async () => {
    const server = await connect();
    await server.runtime.dispatch(selectThread, server.envId(), "a");
    await server.runtime.dispatch(selectThread, server.envId(), "b");
    await server.runtime.dispatch(openView, server.envId(), { Kind: "settings", Page: "general" });
    expect(server.address.history.entries.map((entry) => [entry.Thread, entry.View?.Kind])).toEqual(
      [
        [null, undefined],
        ["a", undefined],
        ["b", undefined],
        ["b", "settings"],
      ],
    );
    await server.go(-1);
    expect(server.environment().Local.View).toBeNull();
    expect(server.environment().Local.SelectedThreadId).toBe("b");
    await server.go(-1);
    expect(server.environment().Local.SelectedThreadId).toBe("a");
    expect(streams(server)).toEqual(["a"]);
    await server.go(-1);
    expect(server.environment().Local.SelectedThreadId).toBeNull();
    expect(streams(server)).toEqual([]);
    await server.go(3);
    expect(server.environment().Local.View).toEqual({ Kind: "settings", Page: "general" });
    expect(server.environment().Local.SelectedThreadId).toBe("b");
    expect(server.address.history.entries).toHaveLength(4);
  });

  it("a new thread's draft is in the address, so back and a reload return to it", async () => {
    const server = await connect();
    await server.runtime.dispatch(newThread, server.envId(), "project-1");
    const draftId = server.environment().Local.SelectedThreadId!;
    expect(server.address.newThreadIn).toBe("project-1");
    expect(server.address.thread).toBeNull();
    await server.runtime.dispatch(selectThread, server.envId(), "a");
    await server.go(-1);
    expect(server.environment().Local.SelectedThreadId).toBe(draftId);

    const reloaded = await connect(undefined, null, {
      address: () => ({ Thread: null, NewThreadIn: "project-1", View: null }),
      storedNewThread: () => draftId,
    });
    expect(reloaded.environment().Local.SelectedThreadId).toBe(draftId);
    expect(reloaded.session(draftId).NewThreadProjectId).toBe("project-1");
  });

  it("a thread the server doesn't have closes, and its address goes without a history entry", async () => {
    const server = await connect(undefined, THREAD_ID);
    const gone = server.disposed(server.openId());
    await server.runtime.dispatch(
      ThreadReceiver.handle,
      server.openId(),
      { Type: "Thread/Stream", Missing: true },
      { publisher: { Id: server.openId() } },
    );
    await gone;
    await settled();
    expect(server.environment().Local.SelectedThreadId).toBeNull();
    expect(server.environment().Replica.OpenThreads[THREAD_ID]).toBeUndefined();
    expect(server.address.history.entries).toEqual([
      { Thread: null, NewThreadIn: null, View: null },
    ]);
  });

  it("deleting the selected thread clears the selection and the address", async () => {
    const server = await connect(undefined, THREAD_ID);
    await server.sendThread(snapshotOf(emptyProjection(), 1));
    const gone = server.disposed(server.sessionId());
    await server.sendThread({
      kind: "event",
      sequence: 2,
      event: event("thread.deleted", {}),
    } as IWireThreadItem);
    await gone;
    await settled();
    expect(server.address.thread).toBeNull();
    expect(server.address.history.entries).toHaveLength(1);
    expect(server.environment().Local.SelectedThreadId).toBeNull();
  });
});

describe("writing to the server", () => {
  const requestItem = (requestId: string) =>
    ({
      ...commandItem(`approval-${requestId}`, "run-1", 1),
      type: "approval_request",
      requestId,
      requestKind: "command",
      prompt: "rm -rf build",
    }) as unknown as IWireTurnItem;
  const pendingOf = (server: Awaited<ReturnType<typeof connect>>) =>
    server.runtime.processSelector(pendingApprovalIds, () => server.thread());

  it("send mints one command, clears the draft, and leaves the replica to the stream", async () => {
    const sent: IStartTurn[] = [];
    const server = await connect(undefined, null, {
      startTurn: (effect: IStartTurn) => {
        sent.push(effect);
      },
    });
    await server.open();
    await server.runtime.dispatch(setDraft, server.sessionId(), " hello ");
    await server.runtime.dispatch(send, server.sessionId());
    expect(sent.map((input) => [input.Text, input.ThreadId, input.NewThread])).toEqual([
      ["hello", THREAD_ID, null],
    ]);
    expect(sent[0]!.CommandId).not.toBe(sent[0]!.MessageId);
    const session = server.environment().Local.ThreadSessions[THREAD_ID]!;
    expect(session.Draft).toBe("");
    expect(inFlightOf(server.runtime, send, () => server.session())).toBe(false);
    expect(server.thread().TurnItems).toEqual({});
  });

  it("an app's message queues as its own turn and leaves the draft alone", async () => {
    const sent: IStartTurn[] = [];
    const server = await connect(undefined, null, {
      startTurn: (effect: IStartTurn) => {
        if (effect.Text === "refused") throw serverFailure("server said no");
        sent.push(effect);
      },
    });
    await server.open();
    await server.runtime.dispatch(setDraft, server.sessionId(), "mine");
    const reply = await server.runtime.dispatch(sendAppMessage, server.sessionId(), "from app");
    expect(reply).toBeNull();
    expect(sent).toMatchObject([
      {
        Text: "from app",
        ThreadId: THREAD_ID,
        Attachments: [],
        DispatchMode: "queue",
        NewThread: null,
      },
    ]);
    expect(server.session().Draft).toBe("mine");
    expect(await server.runtime.dispatch(sendAppMessage, server.sessionId(), "refused")).toBe(
      "server said no",
    );
  });

  it("a failed send keeps the draft and shows why", async () => {
    let attempts = 0;
    const server = await connect(undefined, null, {
      startTurn: () => {
        attempts += 1;
        throw serverFailure("server said no");
      },
    });
    await server.open();
    await server.runtime.dispatch(setDraft, server.sessionId(), "keep me");
    await server.runtime.dispatch(send, server.sessionId());
    const session = server.environment().Local.ThreadSessions[THREAD_ID]!;
    expect(attempts).toBe(1);
    expect(session.Draft).toBe("keep me");
    expect(session.SendError).toBe("server said no");
    expect(inFlightOf(server.runtime, send, () => server.session())).toBe(false);
  });

  it("a bug under a send fails on the route instead of showing as the send's error", async () => {
    const server = await connect(
      undefined,
      null,
      {
        startTurn: () => {
          throw new TypeError("Cannot read properties of undefined");
        },
      },
      undefined,
      undefined,
      undefined,
      [send],
    );
    await server.open();
    await server.runtime.dispatch(setDraft, server.sessionId(), "keep me");
    await expect(server.runtime.dispatch(send, server.sessionId())).rejects.toThrow(TypeError);
    expect(server.session().SendError).toBeUndefined();
    expect(server.takeToasts()).toEqual([
      {
        Kind: "error",
        Title: "That didn't work",
        Description: "Cannot read properties of undefined",
      },
    ]);
    expect(server.takeFailures()).toMatchObject([{ Label: "send", Taken: true }]);
  });

  it("a second send during the wait is ignored", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sent: IStartTurn[] = [];
    const server = await connect(undefined, null, {
      startTurn: (effect: IStartTurn) => {
        sent.push(effect);
        return held;
      },
    });
    await server.open();
    await server.runtime.dispatch(setDraft, server.sessionId(), "once");
    const first = server.runtime.dispatch(send, server.sessionId());
    await server.runtime.dispatch(send, server.sessionId());
    expect(inFlightOf(server.runtime, send, () => server.session())).toBe(true);
    release();
    await first;
    expect(sent).toHaveLength(1);
  });

  it("a new-thread draft moves to the created thread without a stream before it exists", async () => {
    const sent: IStartTurn[] = [];
    const server = await connect(undefined, null, {
      startTurn: (effect: IStartTurn) => {
        sent.push(effect);
      },
    });
    await server.runtime.dispatch(newThread, server.envId(), "project-1");
    const threadId = server.environment().Local.SelectedThreadId!;
    expect(server.environment().Replica.OpenThreads[threadId]).toBeUndefined();
    expect(server.address.thread).toBeNull();
    await server.runtime.dispatch(setDraft, server.sessionId(threadId), "start something");
    await server.runtime.dispatch(send, server.sessionId(threadId));
    expect(sent[0]!.NewThread).toEqual({ ProjectId: "project-1", Title: "start something" });
    expect(sent[0]!.ModelSelection).toEqual({ instanceId: "devReplay", model: "showcase" });
    expect(sent[0]!.ThreadId).toBe(threadId);
    const session = server.session(threadId);
    expect(session.NewThreadProjectId).toBeNull();
    expect(session.Draft).toBe("");
    await settled();
    expect(server.address.thread).toBe(threadId);
    expect(server.address.history.entries).toHaveLength(2);
    expect(server.environment().Replica.OpenThreads[threadId]).toBeDefined();
  });

  it("reads the model through the replica, from the thread or the project's default", async () => {
    const server = await connect();
    await server.open();
    await server.sendThread(snapshotOf(emptyProjection(), 1));
    const model = (threadId: string) =>
      server.runtime.processSelector(effectiveModel, () => server.session(threadId));
    expect(model(THREAD_ID)).toEqual({ instanceId: "codex", model: "gpt-5.4" });
    await server.runtime.dispatch(newThread, server.envId(), "project-1");
    const draftId = server.environment().Local.SelectedThreadId!;
    expect(model(draftId)).toEqual({ instanceId: "devReplay", model: "showcase" });
  });

  const codex = (extra: Record<string, unknown> = {}) =>
    wireProvider("codex", [{ slug: "gpt-5.4", name: "GPT-5.4", isDefault: true }], extra);
  const replay = { instanceId: "devReplay", model: "showcase" };

  it("a new thread starts on the first ready provider and the project's permission mode", async () => {
    const server = await connect();
    await server.sendConfig(
      configSnapshot([codex({ status: "error" }), replayProvider()], {
        ...WIRE_SETTINGS,
        projectSettingsOverrides: { "project-1": { defaultRuntimeMode: "approval-required" } },
      }),
    );
    await server.runtime.dispatch(newThread, server.envId(), "project-1");
    const draft = () => server.session(server.environment().Local.SelectedThreadId!);
    expect(server.runtime.processSelector(effectiveModel, draft)).toEqual(replay);
    expect(server.runtime.processSelector(effectiveRuntimeMode, draft)).toBe("approval-required");
  });

  it("a new thread takes the project's default, else the open thread's model, over the last pick", async () => {
    const server = await connect();
    await server.sendConfig(
      configSnapshot([codex(), replayProvider()], {
        ...WIRE_SETTINGS,
        projectSettingsOverrides: { "project-2": { defaultModelSelection: replay } },
      }),
    );
    server.models.Last = replay as IWireModelSelection;
    await server.runtime.dispatch(selectThread, server.envId(), THREAD_ID);
    await server.sendThread(snapshotOf(emptyProjection(), 1));
    await server.runtime.dispatch(newThread, server.envId(), "project-1");
    const selected = () => server.session(server.environment().Local.SelectedThreadId!);
    expect(selected().SeededModel).toEqual({ instanceId: "codex", model: "gpt-5.4" });
    server.models.Last = { instanceId: "codex", model: "gpt-5.4" } as IWireModelSelection;
    await server.runtime.dispatch(newThread, server.envId(), "project-2");
    expect(selected().SeededModel).toEqual(replay);
  });

  it("reopening a new thread without a pick seeds it again, and a pick is kept", async () => {
    const server = await connect();
    await server.sendConfig(configSnapshot([codex(), replayProvider()]));
    await server.runtime.dispatch(selectThread, server.envId(), THREAD_ID);
    await server.sendThread(snapshotOf(emptyProjection(), 1));
    await server.runtime.dispatch(newThread, server.envId(), "project-1");
    const draftId = server.environment().Local.SelectedThreadId!;
    expect(server.session(draftId).SeededModel).toEqual({ instanceId: "codex", model: "gpt-5.4" });
    await server.runtime.dispatch(newThread, server.envId(), "project-2");
    await server.runtime.dispatch(
      setModelSelection,
      server.sessionId(server.environment().Local.SelectedThreadId!),
      replay as IWireModelSelection,
    );
    await server.go(-1);
    expect(server.environment().Local.SelectedThreadId).toBe(draftId);
    expect(server.session(draftId).SeededModel).toEqual({ instanceId: "codex", model: "gpt-5.4" });
    await server.go(1);
    await server.runtime.dispatch(newThread, server.envId(), "project-1");
    expect(server.environment().Local.SelectedThreadId).toBe(draftId);
    expect(server.session(draftId).SeededModel).toEqual(replay);
    await server.runtime.dispatch(
      setModelSelection,
      server.sessionId(draftId),
      replay as IWireModelSelection,
    );
    await server.runtime.dispatch(selectThread, server.envId(), THREAD_ID);
    await server.runtime.dispatch(newThread, server.envId(), "project-1");
    expect(server.session(draftId).ModelSelection).toEqual(replay);
    expect(server.session(draftId).SeededModel).toEqual(replay);
  });

  const codexWithEffort = configSnapshot([
    wireProvider("codex", [
      {
        slug: "gpt-5.4",
        name: "GPT-5.4",
        isDefault: true,
        capabilities: {
          optionDescriptors: [
            {
              id: "reasoningEffort",
              label: "Reasoning",
              type: "select",
              options: [
                { id: "medium", label: "Medium" },
                { id: "high", label: "High", isDefault: true },
              ],
            },
          ],
        },
      },
    ]),
  ]);
  const medium = {
    instanceId: "codex",
    model: "gpt-5.4",
    options: [{ id: "reasoningEffort", value: "medium" }],
  } as unknown as IWireModelSelection;

  it("a pick on the thread's own provider saves to the thread at once, and the next turn carries it", async () => {
    const log: Array<IThreadCommand | IStartTurn> = [];
    const server = await connect(undefined, null, {
      threadCommand: (effect: { Command: IThreadCommand }) => {
        log.push(effect.Command);
      },
      startTurn: (effect: IStartTurn) => {
        log.push(effect);
      },
    });
    await server.sendConfig(codexWithEffort);
    await server.open();
    await server.sendThread(snapshotOf(emptyProjection(), 1));
    await server.runtime.dispatch(setModelSelection, server.sessionId(), medium);
    expect(log).toEqual([{ Kind: "modelSelection", Selection: medium }]);
    expect(server.models.Last).toEqual(medium);
    await server.runtime.dispatch(setDraft, server.sessionId(), "go");
    await server.runtime.dispatch(send, server.sessionId());
    expect((log[1] as IStartTurn).ModelSelection).toEqual(medium);
  });

  it("refuses another provider on a started thread that can't hand off", async () => {
    const commands: IThreadCommand[] = [];
    const server = await connect(undefined, null, {
      threadCommand: (effect: { Command: IThreadCommand }) => {
        commands.push(effect.Command);
      },
    });
    await server.open();
    await server.sendThread(snapshotOf({ ...emptyProjection(), runs: [run("run-1", 1)] }, 1));
    await server.runtime.dispatch(chooseModel, server.sessionId(), "devReplay", "showcase");
    expect(server.takeToasts()).toEqual([
      {
        Kind: "warning",
        Title: "Start a new chat to switch providers",
        Description: "This thread does not support switching providers after it has started.",
      },
    ]);
    expect(server.session().ModelSelection).toBeNull();
    expect(commands).toEqual([]);
  });

  it("a permission change on a started thread applies just before the next turn", async () => {
    const log: string[] = [];
    const server = await connect(undefined, null, {
      threadCommand: (effect: { Command: IThreadCommand }) => {
        log.push(JSON.stringify(effect.Command));
      },
      startTurn: (effect: IStartTurn) => {
        log.push(`turn ${effect.RuntimeMode}`);
      },
    });
    await server.open();
    await server.sendThread(snapshotOf(emptyProjection(), 1));
    await server.runtime.dispatch(setRuntimeMode, server.sessionId(), "approval-required");
    expect(server.runtime.processSelector(effectiveRuntimeMode, () => server.session())).toBe(
      "approval-required",
    );
    expect(log).toEqual([]);
    await server.runtime.dispatch(setDraft, server.sessionId(), "careful");
    await server.runtime.dispatch(send, server.sessionId());
    expect(log).toEqual([
      JSON.stringify({ Kind: "runtimeMode", Mode: "approval-required" }),
      "turn approval-required",
    ]);
  });

  it("a favorite toggle saves the opposite of the server's list and holds the settings it returns", async () => {
    const saved: Array<{ Model: string; Favorite: boolean }> = [];
    const server = await connect(undefined, null, {
      updateServerSettings: (effect: {
        Patch: { setModelFavorites: Array<{ provider: string; model: string; favorite: boolean }> };
      }) => {
        const [change] = effect.Patch.setModelFavorites;
        saved.push({ Model: change!.model, Favorite: change!.favorite });
        return {
          favorites: change!.favorite ? [{ provider: change!.provider, model: change!.model }] : [],
        };
      },
    });
    await server.runtime.dispatch(toggleModelFavorite, server.envId(), "devReplay", "showcase");
    expect(server.environment().Replica.ModelFavorites).toEqual([
      { Provider: "devReplay", Model: "showcase" },
    ]);
    await server.runtime.dispatch(toggleModelFavorite, server.envId(), "devReplay", "showcase");
    expect(saved).toEqual([
      { Model: "showcase", Favorite: true },
      { Model: "showcase", Favorite: false },
    ]);
    expect(server.environment().Replica.ModelFavorites).toEqual([]);
  });

  it("a new thread starts on the last picked model while its provider still offers it", async () => {
    const server = await connect();
    await server.sendConfig(codexWithEffort);
    server.models.Last = medium;
    await server.runtime.dispatch(newThread, server.envId(), "project-1");
    const draftId = server.environment().Local.SelectedThreadId!;
    expect(server.session(draftId).SeededModel).toEqual(medium);

    const fresh = await connect();
    await fresh.sendConfig(codexWithEffort);
    fresh.models.Last = { instanceId: "gone", model: "x" } as IWireModelSelection;
    await fresh.runtime.dispatch(newThread, fresh.envId(), "project-2");
    const otherId = fresh.environment().Local.SelectedThreadId!;
    expect(fresh.session(otherId).SeededModel).toBeNull();
  });

  it("a failed new thread stays a draft with no stream", async () => {
    const server = await connect(undefined, null, {
      startTurn: () => {
        throw serverFailure("no");
      },
    });
    await server.runtime.dispatch(newThread, server.envId(), "project-1");
    const threadId = server.environment().Local.SelectedThreadId!;
    await server.runtime.dispatch(setDraft, server.sessionId(threadId), "again");
    await server.runtime.dispatch(send, server.sessionId(threadId));
    const session = server.environment().Local.ThreadSessions[threadId]!;
    expect(session.NewThreadProjectId).toBe("project-1");
    expect(session.Draft).toBe("again");
    expect(server.environment().Replica.OpenThreads[threadId]).toBeUndefined();
  });

  it("stop sends one command, and a stop's and a queue change's failures keep their own names", async () => {
    const stops: IStopThread[] = [];
    let refuse = false;
    const server = await connect(undefined, null, {
      stopThread: (effect: IStopThread) => {
        stops.push(effect);
        if (refuse) throw serverFailure("no run");
      },
      queueCommand: () => {
        if (refuse) throw serverFailure("queue moved on");
      },
    });
    await server.open();
    await server.runtime.dispatch(stopRun, server.sessionId());
    expect(stops.map((stop) => stop.ThreadId)).toEqual([THREAD_ID]);
    expect(inFlightOf(server.runtime, stopRun, () => server.session())).toBe(false);
    refuse = true;
    await server.runtime.dispatch(stopRun, server.sessionId());
    await server.runtime.dispatch(queueAction, server.sessionId(), { Kind: "resume" });
    expect(server.session()).toMatchObject({ StopError: "no run" });
    expect(server.takeToasts()).toEqual([
      { Kind: "error", Title: "Could not change the queue", Description: "queue moved on" },
    ]);
    refuse = false;
    await server.runtime.dispatch(queueAction, server.sessionId(), { Kind: "resume" });
    expect(server.takeToasts()).toEqual([]);
    expect(server.session().StopError).toBe("no run");
  });

  it("holds Stopping from the reply until the run ends, a new run starts or the wait times out", async () => {
    const server = await connect(undefined, null, { stopThread: () => {} });
    await server.open();
    await server.sendThread(
      snapshotOf({ ...emptyProjection(), runs: [run("run-1", 1, "running")] }, 1),
    );
    const stopping = () => server.runtime.processSelector(stoppingRun, () => server.session());
    expect(stopping()).toBe(false);
    await server.runtime.dispatch(stopRun, server.sessionId());
    await settled();
    expect(inFlightOf(server.runtime, stopRun, () => server.session())).toBe(false);
    expect(stopping()).toBe(true);
    expect(server.runtime.timers(server.sessionId())).toMatchObject([
      { Key: "Stop/Timeout", IntervalMs: STOP_PENDING_MAX_MS },
    ]);
    await server.sendThread({
      kind: "event",
      sequence: 2,
      event: event("run.updated", run("run-1", 1, "interrupted")),
    } as IWireThreadItem);
    expect(stopping()).toBe(false);

    await server.sendThread({
      kind: "event",
      sequence: 3,
      event: event("run.created", run("run-2", 2, "running")),
    } as IWireThreadItem);
    expect(stopping()).toBe(false);
    await server.runtime.dispatch(stopRun, server.sessionId());
    await settled();
    expect(stopping()).toBe(true);
    await server.sendShell({
      kind: "snapshot",
      snapshot: {
        snapshotSequence: 1,
        projects: [],
        threads: [
          {
            id: THREAD_ID,
            projectId: "project-1",
            updatedAt: "2026-01-01T00:00:00.000Z",
            title: "t",
            status: "running",
            latestRunId: "run-2",
            latestRunStopRequested: true,
            activeProviderThreadId: null,
            pendingRuntimeRequest: null,
            lineage: { rootThreadId: THREAD_ID, parentThreadId: null, relationshipToParent: null },
          },
        ],
      },
    } as unknown as IWireShellItem);
    expect(server.environment().Replica.Shell.Threads[THREAD_ID]?.latestRunStopRequested).toBe(
      true,
    );
    await server.runtime.dispatch(
      StopReceiver.handle,
      server.sessionId(),
      { Type: "Stop/Timeout" },
      { publisher: { Id: server.sessionId() } },
    );
    expect(stopping()).toBe(false);
    expect(server.runtime.timers(server.sessionId())).toEqual([]);
  });

  it("a queue command drops every queue press until it's answered, as stock's one busy run does", async () => {
    const commands: IQueueCommand[] = [];
    const releases: (() => void)[] = [];
    const server = await connect(undefined, null, {
      queueCommand: (effect: IQueueCommand) => {
        commands.push(effect);
        return new Promise<void>((resolve) => {
          releases.push(resolve);
        });
      },
    });
    await server.open();
    const busy = () => inFlightOf(server.runtime, queueAction, () => server.session());
    const press = (runId: string | null) =>
      server.runtime.dispatch(
        queueAction,
        server.sessionId(),
        runId === null ? { Kind: "resume" } : { Kind: "cancel", RunId: runId },
      );
    const runIds = () =>
      commands.map((command) => ("RunId" in command.Operation ? command.Operation.RunId : null));
    const first = press("run-a");
    await settled();
    const dropped = [press("run-a"), press("run-b"), press(null)];
    await settled();
    expect(runIds()).toEqual(["run-a"]);
    expect(busy()).toBe(true);
    releases.forEach((release) => release());
    await Promise.all([first, ...dropped]);
    expect(busy()).toBe(false);
    const second = press("run-b");
    await settled();
    releases.forEach((release) => release());
    await second;
    expect(runIds()).toEqual(["run-a", "run-b"]);
  });

  it("a git action's result lands on the thread's session, which outlives the details card", async () => {
    let finish = () => {};
    const server = await connect(undefined, THREAD_ID, {
      gitAction: () =>
        new Promise((resolve) => {
          finish = () =>
            resolve({
              Title: "Pushed",
              Description: null,
              Branch: null,
              PrUrl: null,
              PrCreated: false,
            });
        }),
    });
    await server.sendShell({
      kind: "snapshot",
      snapshot: {
        snapshotSequence: 1,
        projects: [{ id: "project-1", title: "One", workspaceRoot: "/repo" }],
        threads: [],
      },
    } as unknown as IWireShellItem);
    await server.sendThread(snapshotOf(emptyProjection(), 1));
    const running = server.runtime.dispatch(
      runGitAction,
      server.session().Git.$Id,
      { Action: "push", CommitMessage: null, FilePaths: null, FeatureBranch: true },
      { RefName: "feature", IsDefaultRef: false, HasWorkingTreeChanges: false },
    );
    await settled();
    expect(inFlightOf(server.runtime, [runGitAction, pull], () => server.session().Git)).toBe(true);
    finish();
    await running;
    expect(server.session().Git.Notice).toMatchObject({ Title: "Pushed" });
  });

  it("send now starts a queued run when idle and steers it into the active run otherwise", async () => {
    const commands: IQueueCommand[] = [];
    const server = await connect(undefined, null, {
      queueCommand: (effect: IQueueCommand) => void commands.push(effect),
    });
    await server.open();
    const sendNow = () =>
      server.runtime.dispatch(queueAction, server.sessionId(), { Kind: "sendNow", RunId: "run-2" });
    await server.sendThread(
      snapshotOf({ ...emptyProjection(), runs: [run("run-2", 2, "queued")] }, 1),
    );
    await sendNow();
    await server.sendThread(
      snapshotOf(
        {
          ...emptyProjection(),
          runs: [run("run-1", 1, "starting"), run("run-2", 2, "queued")],
        },
        2,
      ),
    );
    await sendNow();
    expect(commands.map((command) => command.Operation)).toEqual([
      { Kind: "start", RunId: "run-2" },
      { Kind: "steer", RunId: "run-2", TargetRunId: "run-1" },
    ]);
  });

  it("an edit saved with the modifier while Steer is the follow-up default stays queued", async () => {
    const commands: IQueueCommand[] = [];
    const server = await connect(undefined, null, {
      queueCommand: (effect: IQueueCommand) => void commands.push(effect),
      storedClientSettings: () => ({ followUpBehavior: "steer" }),
    });
    await server.open();
    await server.sendThread(
      snapshotOf(
        { ...emptyProjection(), runs: [run("run-1", 1, "starting"), run("run-2", 2, "queued")] },
        1,
      ),
    );
    await server.runtime.dispatch(queueAction, server.sessionId(), {
      Kind: "edit",
      RunId: "run-2",
      Text: "changed",
      Alternate: true,
    });
    expect(commands.map((command) => command.Operation.Kind)).toEqual(["edit"]);
  });

  it("an edit saved with the modifier while Queue is the follow-up default is saved, then steered while a run can take it", async () => {
    const commands: IQueueCommand[] = [];
    const server = await connect(undefined, null, {
      queueCommand: (effect: IQueueCommand) => void commands.push(effect),
      storedClientSettings: () => ({ followUpBehavior: "queue" }),
    });
    await server.open();
    const save = (runId: string, alternate: boolean) =>
      server.runtime.dispatch(queueAction, server.sessionId(), {
        Kind: "edit",
        RunId: runId,
        Text: "changed",
        Alternate: alternate,
      });
    await server.sendThread(
      snapshotOf({ ...emptyProjection(), runs: [run("run-2", 2, "queued")] }, 1),
    );
    await save("run-2", true);
    await server.sendThread(
      snapshotOf(
        {
          ...emptyProjection(),
          runs: [
            run("run-1", 1, "starting"),
            run("run-2", 2, "queued"),
            { ...run("run-3", 3, "queued"), freshContext: true },
          ],
        },
        2,
      ),
    );
    await save("run-2", false);
    await save("run-2", true);
    await save("run-3", true);
    expect(commands.map((command) => command.Operation)).toEqual([
      { Kind: "edit", RunId: "run-2", Text: "changed" },
      { Kind: "edit", RunId: "run-2", Text: "changed" },
      { Kind: "edit", RunId: "run-2", Text: "changed" },
      { Kind: "steer", RunId: "run-2", TargetRunId: "run-1" },
      { Kind: "edit", RunId: "run-3", Text: "changed" },
    ]);
  });

  it("a send carries the delivery the composer chose", async () => {
    const sent: IStartTurn[] = [];
    const server = await connect(undefined, null, {
      startTurn: (effect: IStartTurn) => void sent.push(effect),
    });
    await server.open();
    for (const mode of ["auto", "steer", "queue"] as const) {
      await server.runtime.dispatch(setDraft, server.sessionId(), mode);
      await server.runtime.dispatch(send, server.sessionId(), mode);
    }
    expect(sent.map((turn) => [turn.Text, turn.DispatchMode])).toEqual([
      ["auto", "auto"],
      ["steer", "steer"],
      ["queue", "queue"],
    ]);
  });

  describe("compacting before a send", () => {
    const CLAUDE = { instanceId: "claudeAgent", model: "claude-opus-4-7" };
    async function staleClaudeThread() {
      const sent: IStartTurn[] = [];
      const server = await connect(undefined, null, {
        startTurn: (effect: IStartTurn) => void sent.push(effect),
      });
      await server.sendConfig({
        version: 1,
        type: "snapshot",
        config: {
          settings: { providerInstances: {}, compactIdleThreads: false },
          providers: [
            {
              instanceId: "claudeAgent",
              driver: "claudeAgent",
              slashCommands: [{ name: "compact" }],
            },
          ],
          keybindings: [],
          issues: [],
        },
      });
      await server.open();
      await server.sendThread(snapshotOf(staleProjection(), 1));
      return { server, sent };
    }
    function staleProjection() {
      const projection = emptyProjection();
      projection.thread = {
        ...projection.thread,
        modelSelection: CLAUDE,
        activeProviderThreadId: "provider-thread",
      } as never;
      projection.runs = [{ ...run("run-1", 1), modelSelection: CLAUDE } as never];
      // The test clock reads 0, so this report is two hours old.
      projection.providerTurns = [
        {
          id: "turn-1",
          providerThreadId: "provider-thread",
          tokenUsage: { usedTokens: 439_000, updatedAt: "1969-12-31T22:00:00.000Z" },
        } as never,
      ];
      return projection;
    }
    const offer = (server: Awaited<ReturnType<typeof connect>>) =>
      server.runtime.processSelector(compactionOffer, () => server.session());

    it("sends /compact marked onReturn, then queues the message behind it", async () => {
      const { server, sent } = await staleClaudeThread();
      expect(offer(server)).toBe(439_000);
      await server.runtime.dispatch(setDraft, server.sessionId(), "carry on");
      await server.runtime.dispatch(send, server.sessionId());
      expect(
        sent.map((turn) => [
          turn.Text,
          turn.DispatchMode,
          turn.IdleCompaction,
          turn.ModelSelection,
        ]),
      ).toEqual([
        ["/compact", "auto", "onReturn", CLAUDE],
        ["carry on", "queue", undefined, CLAUDE],
      ]);
      expect(new Set(sent.flatMap((turn) => [turn.CommandId, turn.MessageId])).size).toBe(4);
    });

    it("keeps the full history for one send when toggled, then offers again", async () => {
      const { server, sent } = await staleClaudeThread();
      await server.runtime.dispatch(toggleKeepFullHistory, server.sessionId());
      await server.runtime.dispatch(setDraft, server.sessionId(), "carry on");
      await server.runtime.dispatch(send, server.sessionId());
      expect(sent.map((turn) => [turn.Text, turn.DispatchMode])).toEqual([["carry on", "auto"]]);
      expect(server.session().KeepFullHistory).toBe(false);
    });

    it("a never-ask-again answer stops the offer for that provider on this device, in every thread", async () => {
      const { server } = await staleClaudeThread();
      const question = formatClaudeResumeCompactionQuestion({
        ageMinutes: 120,
        estimatedTokens: 439_000,
      });
      const answered = staleProjection();
      answered.runtimeRequests = [
        {
          id: "request-1",
          kind: "user_input",
          status: "resolved",
          answers: { [question]: CLAUDE_RESUME_COMPACTION_NEVER_ANSWER },
          responseCapability: { type: "live" },
        } as never,
      ];
      await server.sendThread(snapshotOf(answered, 2));
      await settled();
      expect(server.device.Preferences.CompactionDismissed).toEqual([`${ENV}:claudeAgent`]);
      // Another thread, or this one without the answered question in view, stays quiet.
      await server.sendThread(snapshotOf(staleProjection(), 3));
      expect(offer(server)).toBeNull();
    });

    it("a typed /compact is the compaction, so it sends alone", async () => {
      const { server, sent } = await staleClaudeThread();
      await server.runtime.dispatch(setDraft, server.sessionId(), "/compact keep the plan");
      expect(offer(server)).toBeNull();
      await server.runtime.dispatch(setDraft, server.sessionId(), "/compact");
      expect(offer(server)).toBeNull();
      await server.runtime.dispatch(send, server.sessionId());
      expect(sent.map((turn) => [turn.Text, turn.IdleCompaction])).toEqual([
        ["/compact", undefined],
      ]);
    });
  });

  it("answering marks only its own request, and the stream or another device clears it", async () => {
    const answers: IRespondRequest[] = [];
    const releases: (() => void)[] = [];
    const server = await connect(undefined, null, {
      respondRequest: (effect: IRespondRequest) => {
        answers.push(effect);
        return new Promise<void>((resolve) => {
          releases.push(resolve);
        });
      },
    });
    await server.open();
    const request = (id: string) => ({
      id,
      kind: "command",
      status: "pending",
      responseCapability: { type: "live" },
    });
    await server.sendThread(
      snapshotOf(
        {
          ...emptyProjection(),
          runtimeRequests: [request("r-1"), request("r-2")],
          turnItems: [requestItem("r-1"), requestItem("r-2")],
        } as never,
        1,
      ),
    );
    expect(pendingOf(server)).toEqual(["r-1", "r-2"]);
    expect(server.runtime.processSelector(requestItems, () => server.thread())["r-1"]?.type).toBe(
      "approval_request",
    );

    const node = (id: string) => server.thread().RuntimeRequests[id]!;
    const busy = (id: string) => inFlightOf(server.runtime, Responding, () => node(id));
    const answer = (id: string, decision: "accept" | "decline") =>
      server.runtime.dispatch(answerRequest, node(id).$Id, ENV, THREAD_ID, decision, null);
    const first = answer("r-1", "accept");
    await settled();
    expect([busy("r-1"), busy("r-2")]).toEqual([true, false]);
    expect(await answer("r-1", "decline")).toBeUndefined();
    const folded: string[] = [];
    function* fold(draft: IRuntimeRequest): IActionGenerator {
      folded.push(draft.kind);
    }
    void server.runtime.dispatch(fold, node("r-1").$Id);
    await settled();
    expect(folded).toEqual(["command"]);
    const second = answer("r-2", "decline");
    await settled();
    expect([busy("r-1"), busy("r-2")]).toEqual([true, true]);
    releases.forEach((release) => release());
    await Promise.all([first, second]);
    expect([busy("r-1"), busy("r-2")]).toEqual([false, false]);
    expect(answers.map((answer) => [answer.RequestId, answer.Decision])).toEqual([
      ["r-1", "accept"],
      ["r-2", "decline"],
    ]);
    expect(pendingOf(server)).toHaveLength(2);

    const held = node("r-2");
    await server.sendThread({
      kind: "event",
      sequence: 2,
      event: event("runtime-request.updated", { ...request("r-2"), status: "resolved" }),
    } as IWireThreadItem);
    expect(pendingOf(server)).toEqual(["r-1"]);
    expect(node("r-2")).toBe(held);
    await server.sendThread(
      snapshotOf(
        {
          ...emptyProjection(),
          runtimeRequests: [request("r-2")],
          turnItems: [requestItem("r-2")],
        } as never,
        3,
      ),
    );
    expect(pendingOf(server)).toEqual(["r-2"]);
    expect(node("r-2")).toBe(held);

    await server.sendThread({
      kind: "event",
      sequence: 4,
      event: event("runtime-request.updated", request("r-3")),
    } as IWireThreadItem);
    expect(pendingOf(server)).toEqual(["r-2"]);
    await server.sendThread({
      kind: "event",
      sequence: 5,
      event: event("turn-item.updated", requestItem("r-3")),
    } as IWireThreadItem);
    expect(pendingOf(server)).toEqual(["r-2", "r-3"]);
  });

  it("answers a secret or link card once, keeps what was typed out of the tree, and shows a refusal", async () => {
    const secrets: ISecretAnswer[] = [];
    const links: ILinkAnswer[] = [];
    const releases: (() => void)[] = [];
    let refusal: string | null = null;
    const server = await connect(undefined, null, {
      answerSecret: (effect: ISecretAnswer) => {
        secrets.push(effect);
        if (refusal !== null) throw serverFailure(refusal);
        return new Promise<void>((resolve) => {
          releases.push(resolve);
        });
      },
      answerLink: (effect: ILinkAnswer) => {
        links.push(effect);
      },
    });
    await server.open();
    const asked = (id: string, type: "secret_request" | "link_request", ordinal: number) =>
      ({
        ...commandItem(id, "run-1", ordinal),
        type,
        status: "waiting",
        label: "API key",
        reason: "To call the API",
        ...(type === "secret_request" ? { secretStatus: "pending" } : { linkStatus: "pending" }),
      }) as unknown as IWireTurnItem;
    const secret = asked("s-1", "secret_request", 1);
    await server.sendThread(
      snapshotOf(
        {
          ...emptyProjection(),
          turnItems: [
            secret,
            asked("s-2", "secret_request", 2),
            asked("l-1", "link_request", 3),
            asked("s-3", "secret_request", 5),
          ],
        } as never,
        1,
      ),
    );
    const node = (id: string) => server.thread().ItemRequests[id]!;
    const busy = (id: string) =>
      inFlightOf(server.runtime, [answerSecret, answerLink], () => node(id));
    const single = { label: "API key" };
    const save = (id: string, typed: string) =>
      server.runtime.dispatch(answerSecret, node(id).$Id, ENV, THREAD_ID, single, {
        type: "save",
        values: { "": typed },
      });

    expect(await save("s-1", "   ")).toBe(false);
    expect(secrets).toEqual([]);
    const first = save("s-1", " hunter2 ");
    await settled();
    expect([busy("s-1"), busy("s-2")]).toEqual([true, false]);
    expect(
      await server.runtime.dispatch(answerSecret, node("s-1").$Id, ENV, THREAD_ID, single, {
        type: "decline",
      }),
    ).toBeUndefined();
    releases.forEach((release) => release());
    expect(await first).toBe(true);
    expect(secrets.map((effect) => effect.Input)).toEqual([
      { threadId: THREAD_ID, turnItemId: "s-1", answer: { type: "save", secret: "hunter2" } },
    ]);
    expect(JSON.stringify(server.runtime.state)).not.toContain("hunter2");

    refusal = "This secret request was already answered.";
    expect(
      await server.runtime.dispatch(answerSecret, node("s-2").$Id, ENV, THREAD_ID, single, {
        type: "decline",
      }),
    ).toBe(false);
    expect(server.runtime.processSelector(itemAnswerError, () => node("s-2"))).toBe(refusal);
    expect(server.runtime.processSelector(itemAnswerError, () => node("s-1"))).toBeNull();
    refusal = null;
    const retry = server.runtime.dispatch(answerSecret, node("s-2").$Id, ENV, THREAD_ID, single, {
      type: "decline",
    });
    await settled();
    expect(server.runtime.processSelector(itemAnswerError, () => node("s-2"))).toBeNull();
    releases.forEach((release) => release());
    await retry;
    expect(secrets.at(-1)?.Input.answer).toEqual({ type: "decline" });

    const login = {
      label: "Login",
      fields: [
        { name: "email", label: "Email", secret: false },
        { name: "password", label: "Password" },
      ],
    };
    const saveLogin = (values: Record<string, string>) =>
      server.runtime.dispatch(answerSecret, node("s-3").$Id, ENV, THREAD_ID, login, {
        type: "save",
        values,
      });
    expect(await saveLogin({ email: "a@b.c", password: " " })).toBe(false);
    const both = saveLogin({ email: " a@b.c ", password: "hunter3" });
    await settled();
    releases.forEach((release) => release());
    expect(await both).toBe(true);
    expect(secrets.at(-1)?.Input.answer).toEqual({
      type: "save",
      values: { email: "a@b.c", password: "hunter3" },
    });

    expect(
      await server.runtime.dispatch(answerLink, node("l-1").$Id, ENV, THREAD_ID, {
        type: "link",
        target: { url: " " },
        access: "approval-required",
        pairingCode: "code-123",
      }),
    ).toBe(false);
    expect(
      await server.runtime.dispatch(answerLink, node("l-1").$Id, ENV, THREAD_ID, {
        type: "link",
        target: { url: "https://box.example.ts.net" },
        access: "approval-required",
        pairingCode: " code-123 ",
      }),
    ).toBe(true);
    expect(links.map((effect) => effect.Input.answer)).toEqual([
      {
        type: "link",
        urls: ["https://box.example.ts.net"],
        access: "approval-required",
        pairingCode: "code-123",
      },
    ]);
    expect(JSON.stringify(server.runtime.state)).not.toContain("code-123");

    const held = node("s-1");
    await server.sendThread({
      kind: "event",
      sequence: 2,
      event: event("turn-item.updated", { ...secret, status: "completed", secretStatus: "saved" }),
    } as IWireThreadItem);
    expect(node("s-1")).toBe(held);
    await server.sendThread({
      kind: "event",
      sequence: 3,
      event: event("turn-item.updated", asked("l-2", "link_request", 4)),
    } as IWireThreadItem);
    expect(Object.keys(server.thread().ItemRequests).sort()).toEqual([
      "l-1",
      "l-2",
      "s-1",
      "s-2",
      "s-3",
    ]);
  });

  it("holds a question's answer per request until it's complete, and sends only what the provider can take", async () => {
    const answers: IRespondRequest[] = [];
    const server = await connect(undefined, null, {
      respondRequest: (effect: IRespondRequest) => {
        answers.push(effect);
      },
    });
    await server.open();
    const request = (id: string, kind: string, type: string) => ({
      id,
      kind,
      status: "pending",
      responseCapability: { type },
    });
    await server.sendThread(
      snapshotOf(
        {
          ...emptyProjection(),
          runtimeRequests: [
            request("r-1", "user_input", "message"),
            request("gone-question", "user_input", "not_resumable"),
            request("gone-approval", "command", "message"),
          ],
        } as never,
        1,
      ),
    );
    const node = (id: string) => server.thread().RuntimeRequests[id]!;
    expect(["r-1", "gone-question", "gone-approval"].map((id) => canAnswer(node(id)))).toEqual([
      true,
      false,
      false,
    ]);
    await server.runtime.dispatch(answerRequest, node("gone-question").$Id, ENV, THREAD_ID, null, {
      one: "typed",
    });
    await server.runtime.dispatch(
      answerRequest,
      node("gone-approval").$Id,
      ENV,
      THREAD_ID,
      "accept",
      null,
    );
    expect(answers).toEqual([]);
    const option = (label: string, extra: object = {}) => ({
      label,
      description: `${label} described`,
      ...extra,
    });
    const questions = [
      {
        id: "pick",
        header: "Pick",
        question: "Which?",
        options: [option("a", { preview: "```\na\n```" }), option("b", { value: "B-value" })],
      },
      {
        id: "many",
        header: "Many",
        question: "Which ones?",
        options: [option("x"), option("y"), option("z")],
        multiSelect: true,
      },
      { id: "free", header: "Free", question: "Say?", options: [option("no")] },
      {
        id: "edit",
        header: "Edit",
        question: "Edit?",
        options: [],
        initialAnswer: "suggested",
      },
    ] as unknown as IQuestion[];
    const progress = (index = 0, requestId = "r-1") =>
      questionProgress(questions, server.session().QuestionAnswers[requestId], index);
    const toggle = (questionId: string, value: string) =>
      server.runtime.dispatch(
        toggleQuestionOption,
        server.sessionId(),
        "r-1",
        questions,
        questionId,
        value,
      );
    const type = (questionIndex: number, text: string) =>
      server.runtime.dispatch(
        setQuestionCustomAnswer,
        server.sessionId(),
        "r-1",
        questions[questionIndex]!,
        text,
      );
    expect(progress(3).CustomAnswer).toBe("suggested");
    expect(progress().CanAdvance).toBe(false);
    await toggle("pick", "a");
    await toggle("pick", "B-value");
    expect(progress().SelectedOptionValues).toEqual(["B-value"]);
    await toggle("many", "x");
    await toggle("many", "z");
    await toggle("many", "x");
    await toggle("many", "y");
    expect(progress(1).SelectedOptionValues).toEqual(["z", "y"]);
    expect(progress().Answers).toBeNull();
    await type(2, "my own words");
    expect(progress(3).IsLastQuestion).toBe(true);
    expect(progress().Answers).toEqual({
      pick: "B-value",
      many: ["z", "y"],
      free: "my own words",
      edit: "suggested",
    });

    await server.runtime.dispatch(setDraft, server.sessionId(), "half a message");
    await toggle("free", "no");
    expect(server.session().Draft).toBe("half a message\n\nmy own words");
    expect(progress().Answers?.free).toBe("no");
    expect(questionProgress(questions, undefined, 0).Answers).toBeNull();

    await server.runtime.dispatch(
      answerRequest,
      node("r-1").$Id,
      ENV,
      THREAD_ID,
      null,
      progress().Answers,
    );
    expect(answers.map((answer) => answer.Answers)).toEqual([
      { pick: "B-value", many: ["z", "y"], free: "no", edit: "suggested" },
    ]);
    await server.runtime.dispatch(dismissRequest, node("r-1").$Id, ENV, THREAD_ID);
    expect(answers[1]).toMatchObject({ RequestId: "r-1", Dismiss: true, Answers: null });
  });

  it("puts typed answers in the draft when Stop cancels a question or it expires, and drops the rest", async () => {
    const server = await connect();
    await server.open();
    const request = (id: string, status = "pending") => ({
      id,
      kind: "user_input",
      status,
      responseCapability: { type: "live" },
    });
    await server.sendThread(
      snapshotOf(
        {
          ...emptyProjection(),
          runtimeRequests: ["cancelled", "expired", "resolved", "open"].map((id) => request(id)),
        } as never,
        1,
      ),
    );
    const question = { id: "q", header: "Q", question: "Q?", options: [] } as unknown as IQuestion;
    for (const id of ["cancelled", "expired", "resolved", "open"])
      await server.runtime.dispatch(
        setQuestionCustomAnswer,
        server.sessionId(),
        id,
        question,
        `typed for ${id}`,
      );
    await server.runtime.dispatch(setQuestionIndex, server.sessionId(), "cancelled", 1);
    await server.runtime.dispatch(setDraft, server.sessionId(), "draft");
    const settle = (sequence: number, id: string) =>
      server.sendThread({
        kind: "event",
        sequence,
        event: event("runtime-request.updated", request(id, id)),
      } as IWireThreadItem);
    await settle(2, "cancelled");
    await settle(3, "expired");
    await settle(4, "resolved");
    expect(server.session().Draft).toBe("draft\n\ntyped for cancelled\n\ntyped for expired");
    expect(Object.keys(server.session().QuestionAnswers)).toEqual(["open"]);
    expect(server.session().QuestionIndex).toEqual({});

    await server.sendThread(snapshotOf(emptyProjection() as never, 5));
    expect(server.session().QuestionAnswers).toEqual({});
    expect(server.session().Draft).toBe("draft\n\ntyped for cancelled\n\ntyped for expired");
  });

  it("sends a thread command and leaves the row to the stream, toasting a failure", async () => {
    const commands: { ThreadId: string; Command: object }[] = [];
    let refusal: string | null = null;
    const server = await connect(undefined, null, {
      threadCommand: (effect: { ThreadId: string; Command: object }) => {
        if (refusal !== null) throw serverFailure(refusal);
        commands.push(effect);
      },
    });
    const send = (command: IThreadCommand) =>
      server.runtime.dispatch(threadCommand, server.envId(), "t-1", command);
    expect(await send({ Kind: "settle" })).toBe(true);
    expect(commands).toMatchObject([{ ThreadId: "t-1", Command: { Kind: "settle" } }]);
    refusal = "server said no";
    expect(await send({ Kind: "pin" })).toBe(false);
    refusal = "still no";
    expect(await send({ Kind: "unpin" })).toBe(false);
    expect(server.takeToasts()).toEqual([
      { Kind: "error", Title: "Failed to pin thread", Description: "server said no" },
      { Kind: "error", Title: "Failed to unpin thread", Description: "still no" },
    ]);
    expect(server.takeFailures()).toEqual([]);
  });

  it("marks the shown thread visited once per completion, and sends an open on each select", async () => {
    type IVisit = { Thread: string; Opened?: true; SearchQuery?: string };
    const visits: IVisit[] = [];
    let refuse = false;
    let hold = false;
    let release: (() => void) | undefined;
    const server = await connect(undefined, THREAD_ID, {
      threadCommand: (effect: {
        ThreadId: string;
        Command: { Kind: string; Opened?: true; SearchQuery?: string };
      }) => {
        const { Kind, Opened, SearchQuery } = effect.Command;
        if (Kind !== "visit") return;
        visits.push({
          Thread: effect.ThreadId,
          ...(Opened ? { Opened } : {}),
          ...(SearchQuery ? { SearchQuery } : {}),
        });
        if (refuse) throw serverFailure("visit refused");
        if (hold) return new Promise<void>((resolve) => (release = resolve));
      },
    });
    const take = () => visits.splice(0);
    const shown: IVisit = { Thread: THREAD_ID };
    let sequence = 1;
    const row = (id: string, completedAt: string, visitedAt: string | null) =>
      ({
        id,
        projectId: "project-1",
        title: id,
        updatedAt: completedAt,
        latestRunCompletedAt: completedAt,
        lastVisitedAt: visitedAt,
        lineage: { rootThreadId: id, parentThreadId: null, relationshipToParent: null },
      }) as never;
    const deliver = (id: string, completedAt: string, visitedAt: string | null) =>
      server.sendShell({
        kind: "thread.updated",
        sequence: (sequence += 1),
        location: "active",
        thread: row(id, completedAt, visitedAt),
      } as unknown as IWireShellItem);
    const view = (next: IAddressView | null) =>
      server.runtime.dispatch(openView, server.envId(), next).then(settled);
    const select = (threadId: string, searchQuery?: string) =>
      server.runtime.dispatch(selectThread, server.envId(), threadId, searchQuery).then(settled);
    const drop = () =>
      server.runtime.dispatch(
        ShellReceiver.handle,
        server.shellId(),
        { Type: "Shell/Stream", Resubscribing: true },
        { publisher: { Id: server.shellId() } },
      );
    const resync = () => server.sendShell({ kind: "synchronized" } as IWireShellItem).then(settled);
    const reconnect = () => drop().then(resync);
    const T1 = "2026-01-01T01:00:00.000Z";
    const T2 = "2026-01-01T02:00:00.000Z";
    const T3 = "2026-01-01T03:00:00.000Z";
    const T4 = "2026-01-01T04:00:00.000Z";

    // A restored address isn't an open, and the first sync has nothing to retry.
    await reconnect();
    expect(take()).toEqual([]);

    // Settings covers the thread, so its completion waits until the page closes.
    await view({ Kind: "settings", Page: "general" });
    await deliver(THREAD_ID, T1, null);
    await settled();
    expect(take()).toEqual([]);
    await view(null);
    expect(take()).toEqual([shown]);
    await deliver(THREAD_ID, T1, null);
    await deliver("other", T1, null);
    await settled();
    expect(take()).toEqual([]);

    // A completion landing on the shown thread visits it; a refusal stays quiet and isn't repeated.
    refuse = true;
    await deliver(THREAD_ID, T2, T1);
    await settled();
    expect(take()).toEqual([shown]);
    expect(server.takeToasts()).toEqual([]);
    await deliver(THREAD_ID, T2, null);
    await settled();
    expect(take()).toEqual([]);

    // A refusal isn't retried after a reconnect.
    refuse = false;
    await reconnect();
    expect(take()).toEqual([]);

    // A visit lost while the stream is down is retried once it resyncs, and only that once.
    await drop();
    refuse = true;
    await deliver(THREAD_ID, T3, T2);
    await settled();
    expect(take()).toEqual([shown]);
    refuse = false;
    await resync();
    expect(take()).toEqual([shown]);
    await deliver(THREAD_ID, T3, T3);
    await reconnect();
    expect(take()).toEqual([]);

    // Marked unread while shown, it stays unread, across a reconnect too.
    await deliver(THREAD_ID, T3, T2);
    await settled();
    await reconnect();
    expect(take()).toEqual([]);

    // Selecting is an open, even for a thread that's already read, and the palette sends its query.
    await deliver("other", T1, T1);
    await select("other");
    expect(take()).toEqual([{ Thread: "other", Opened: true }]);
    await select(THREAD_ID, "fix the build");
    expect(take()).toEqual([{ ...shown, Opened: true, SearchQuery: "fix the build" }]);
    await select(THREAD_ID);
    expect(take()).toEqual([]);

    // Opening and closing a page over a read thread sends nothing; selecting from it is an open.
    await deliver(THREAD_ID, T3, T3);
    await view({ Kind: "usage" });
    await view(null);
    expect(take()).toEqual([]);
    await view({ Kind: "settings", Page: "general" });
    await select(THREAD_ID);
    expect(take()).toEqual([{ ...shown, Opened: true }]);

    // A visit still in flight doesn't hold back the next thread's.
    hold = true;
    await deliver(THREAD_ID, T4, T3);
    await settled();
    expect(take()).toEqual([shown]);
    hold = false;
    await select("other");
    expect(take()).toEqual([{ Thread: "other", Opened: true }]);
    release?.();
    await settled();
  });

  const draftProjectOf = (server: Awaited<ReturnType<typeof connect>>) => {
    const selected = server.environment().Local.SelectedThreadId;
    return selected === null
      ? null
      : server.environment().Local.ThreadSessions[selected]?.NewThreadProjectId;
  };

  it("adding a folder creates its project and opens a new thread there, or returns the refusal", async () => {
    const sent: { ProjectId: string; Command: object }[] = [];
    let refuse = false;
    const server = await connect(undefined, null, {
      projectCommand: (effect: { ProjectId: string; Command: object }) => {
        if (refuse) throw serverFailure("no such folder");
        sent.push(effect);
      },
    });
    const added = await server.runtime.dispatch(addFolder, server.envId(), "E:\\Tam\\Code");
    expect(added).toBeNull();
    expect(sent).toMatchObject([
      { Command: { Kind: "create", Title: "Code", WorkspaceRoot: "E:\\Tam\\Code" } },
    ]);
    expect(draftProjectOf(server)).toBe(sent[0]!.ProjectId);
    const selected = server.environment().Local.SelectedThreadId;
    refuse = true;
    expect(await server.runtime.dispatch(addFolder, server.envId(), "E:\\Elsewhere")).toBe(
      "no such folder",
    );
    expect(server.takeToasts()).toEqual([]);
    expect(server.environment().Local.SelectedThreadId).toBe(selected);
  });

  it("adding a folder already a project opens its latest unsettled thread, unarchiving it first", async () => {
    const sent: { ProjectId: string; Command: object }[] = [];
    const server = await connect(undefined, null, {
      projectCommand: (effect: { ProjectId: string; Command: object }) => void sent.push(effect),
    });
    const thread = (id: string, projectId: string, updatedAt: string, settled = false) => ({
      id,
      projectId,
      title: id,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt,
      archivedAt: null,
      settledOverride: settled ? "settled" : null,
    });
    await server.sendShell({
      kind: "snapshot",
      snapshot: {
        snapshotSequence: 1,
        projects: [
          { id: "p-live", title: "Live", workspaceRoot: "/code/live" },
          {
            id: "p-old",
            title: "Old",
            workspaceRoot: "/code/old",
            archivedAt: "2026-01-01T00:00:00.000Z",
          },
          { id: "p-busy", title: "Busy", workspaceRoot: "/code/busy" },
          { id: "p-done", title: "Done", workspaceRoot: "/code/done" },
        ],
        threads: [
          thread("t-older", "p-busy", "2026-02-01T00:00:00.000Z"),
          thread("t-busy", "p-busy", "2026-03-01T00:00:00.000Z"),
          thread("t-done", "p-done", "2026-03-01T00:00:00.000Z", true),
        ],
        archivedThreads: [],
      },
    } as unknown as IWireShellItem);
    await server.runtime.dispatch(addFolder, server.envId(), "/code/live/");
    expect(sent).toEqual([]);
    expect(draftProjectOf(server)).toBe("p-live");
    await server.runtime.dispatch(addFolder, server.envId(), "/code/old");
    expect(sent).toMatchObject([{ ProjectId: "p-old", Command: { Kind: "unarchive" } }]);
    expect(draftProjectOf(server)).toBe("p-old");
    await server.runtime.dispatch(addFolder, server.envId(), "/code/busy");
    expect(server.environment().Local.SelectedThreadId).toBe("t-busy");
    await server.runtime.dispatch(addFolder, server.envId(), "/code/done");
    expect(draftProjectOf(server)).toBe("p-done");
  });

  it("adding an archived folder whose project is removed during the unarchive opens nothing", async () => {
    const server = await connect(undefined, null, {
      projectCommand: () =>
        server.sendShell({
          kind: "project.removed",
          sequence: 2,
          projectId: "p-old",
        } as unknown as IWireShellItem),
    });
    await server.sendShell({
      kind: "snapshot",
      snapshot: {
        snapshotSequence: 1,
        projects: [
          {
            id: "p-old",
            title: "Old",
            workspaceRoot: "/code/old",
            archivedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        threads: [],
        archivedThreads: [],
      },
    } as unknown as IWireShellItem);
    expect(await server.runtime.dispatch(addFolder, server.envId(), "/code/old")).toBe(
      "This project was removed while it was being added.",
    );
    expect(server.environment().Local.SelectedThreadId).toBeNull();
  });

  it("cloning opens the project as soon as the server takes the clone", async () => {
    const clones: IStartClone[] = [];
    let refuse = false;
    const server = await connect(undefined, null, {
      startClone: (effect: IStartClone) => {
        if (refuse) throw serverFailure("destination exists");
        clones.push(effect);
      },
    });
    const url = "https://github.com/pingdotgg/t3code.git";
    expect(await server.runtime.dispatch(cloneProject, server.envId(), url, "/code/t3code")).toBe(
      null,
    );
    expect(clones).toMatchObject([
      { RemoteUrl: url, DestinationPath: "/code/t3code", Title: "t3code" },
    ]);
    expect(draftProjectOf(server)).toBe(clones[0]!.ProjectId);
    refuse = true;
    expect(await server.runtime.dispatch(cloneProject, server.envId(), url, "/code/t3code")).toBe(
      "destination exists",
    );
    expect(draftProjectOf(server)).toBe(clones[0]!.ProjectId);
  });

  it("a new project opens a thread in the project the server made", async () => {
    const server = await connect(undefined, null, {
      newProject: (effect: { Name: string }) => ({
        ProjectId: "p-new",
        WorkspaceRoot: `/projects/${effect.Name}`,
        CommitError: "no git identity",
      }),
    });
    expect(await server.runtime.dispatch(newProject, server.envId(), "demo")).toMatchObject({
      WorkspaceRoot: "/projects/demo",
      CommitError: "no git identity",
    });
    expect(draftProjectOf(server)).toBe("p-new");
  });

  it("removing a project forgets its new-thread draft, and keeps it with a toast on failure", async () => {
    let refuse = true;
    const server = await connect(undefined, null, {
      projectCommand: () => {
        if (refuse) throw serverFailure("busy");
      },
    });
    await server.runtime.dispatch(newThread, server.envId(), "p-1");
    const draftId = server.environment().Local.SelectedThreadId!;
    await server.runtime.dispatch(projectCommand, server.envId(), "p-1", { Kind: "delete" });
    expect(server.takeToasts()).toEqual([
      { Kind: "error", Title: "Failed to remove project", Description: "busy" },
    ]);
    expect(server.environment().Local.ThreadSessions[draftId]).toBeDefined();
    refuse = false;
    await server.runtime.dispatch(projectCommand, server.envId(), "p-1", { Kind: "delete" });
    expect(server.environment().Local.ThreadSessions[draftId]).toBeUndefined();
    expect(server.environment().Local.SelectedThreadId).toBeNull();
  });

  it("removing a project forces the delete and forgets its threads, or keeps them on failure", async () => {
    let failWith: string | null = "Project is in use";
    const sent: Array<{ ProjectId: string; Command: object }> = [];
    const server = await connect(undefined, THREAD_ID, {
      projectCommand: (effect: { ProjectId: string; Command: object }) => {
        sent.push(effect);
        if (failWith !== null) throw serverFailure(failWith);
      },
    });
    await server.sendShell({
      kind: "snapshot",
      snapshot: {
        snapshotSequence: 1,
        projects: [{ id: "project-1", title: "One", workspaceRoot: "/1" }],
        threads: [
          { id: THREAD_ID, projectId: "project-1", title: "T" },
          { id: "other", projectId: "project-2", title: "O" },
        ],
        archivedThreads: [],
      },
    } as unknown as IWireShellItem);
    await server.runtime.dispatch(setDraft, server.sessionId(), "kept");

    const failure = await server.runtime.dispatch(removeProject, server.envId(), "project-1");
    expect(failure).toBe("Project is in use");
    expect(server.environment().Local.ThreadSessions[THREAD_ID]?.Draft).toBe("kept");
    expect(server.environment().Local.SelectedThreadId).toBe(THREAD_ID);

    failWith = null;
    expect(await server.runtime.dispatch(removeProject, server.envId(), "project-1")).toBeNull();
    expect(sent.map((effect) => effect.Command)).toEqual([
      { Kind: "delete", Force: true },
      { Kind: "delete", Force: true },
    ]);
    expect(server.environment().Local.ThreadSessions[THREAD_ID]).toBeUndefined();
    expect(server.environment().Local.SelectedThreadId).toBeNull();
    expect(server.environment().Replica.Shell.Threads[THREAD_ID]).toBeDefined();
  });

  it("removing a project forgets threads the stream already removed during the request", async () => {
    let removeRows = () => Promise.resolve();
    const server = await connect(undefined, THREAD_ID, {
      projectCommand: () => removeRows(),
    });
    await server.sendShell({
      kind: "snapshot",
      snapshot: {
        snapshotSequence: 1,
        projects: [{ id: "project-1", title: "One", workspaceRoot: "/1" }],
        threads: [{ id: THREAD_ID, projectId: "project-1", title: "T" }],
        archivedThreads: [],
      },
    } as unknown as IWireShellItem);
    await server.runtime.dispatch(setDraft, server.sessionId(), "kept");
    removeRows = async () => {
      await server.sendShell({
        kind: "thread.removed",
        sequence: 2,
        threadId: THREAD_ID,
      } as unknown as IWireShellItem);
    };
    expect(await server.runtime.dispatch(removeProject, server.envId(), "project-1")).toBeNull();
    expect(server.environment().Replica.Shell.Threads[THREAD_ID]).toBeUndefined();
    expect(server.environment().Local.ThreadSessions[THREAD_ID]).toBeUndefined();
    expect(server.stored.Drafts.has(THREAD_ID)).toBe(false);
  });

  it("deleting forgets the session and selection on the reply, and leaves the thread to its stream", async () => {
    const server = await connect(undefined, THREAD_ID, { threadCommand: () => undefined });
    await server.runtime.dispatch(setDraft, server.sessionId(), "gone");
    await server.runtime.dispatch(threadCommand, server.envId(), THREAD_ID, { Kind: "delete" });
    expect(server.environment().Local.ThreadSessions[THREAD_ID]).toBeUndefined();
    expect(server.environment().Local.SelectedThreadId).toBeNull();
    expect(server.address.thread).toBeNull();
    expect(server.environment().Replica.OpenThreads[THREAD_ID]).toBeDefined();
    await server.sendThread({
      kind: "event",
      sequence: 1,
      event: event("thread.deleted", {}),
    } as IWireThreadItem);
    await settled();
    expect(server.environment().Replica.OpenThreads[THREAD_ID]).toBeUndefined();
  });

  it("keeps a pending request's id stable when an unrelated row arrives", async () => {
    const server = await connect();
    await server.open();
    await server.sendThread(
      snapshotOf(
        {
          ...emptyProjection(),
          runtimeRequests: [{ id: "r-1", kind: "command", status: "pending" }],
          turnItems: [requestItem("r-1")],
        } as never,
        1,
      ),
    );
    expect(pendingOf(server)).toEqual(["r-1"]);
    await server.sendThread({
      kind: "event",
      sequence: 2,
      event: event("turn-item.updated", commandItem("other", "run-1", 2)),
    } as IWireThreadItem);
    expect(pendingOf(server)).toEqual(["r-1"]);
  });
});

describe("drafts", () => {
  const picked = (id: string, name: string): IPickedFile => ({
    Id: id,
    Kind: "image",
    Name: name,
    MimeType: "image/png",
    SizeBytes: 4,
    PastedText: false,
    PreviewUrl: null,
  });
  const storedOf = (name: string): IStoredAttachment => ({
    Kind: "image",
    Name: name,
    MimeType: "image/png",
    SizeBytes: 4,
    PastedText: false,
    DataUrl: `data:image/png;base64,${name}`,
  });
  const fileStubs = (restored: string[][]) => ({
    methods: {
      "Composer/Files": {
        stored: (_ctx: unknown, ids: string[]) => ids.map((id) => storedOf(id)),
        restore: (_ctx: unknown, files: IStoredAttachment[]) => {
          restored.push(files.map((file) => file.Name));
          return files.map((file, index) => picked(`restored-${index}`, file.Name));
        },
        forget: () => undefined,
        remove: () => undefined,
        upload: (_ctx: unknown, id: string) => ({ type: "image", id: `upload-${id}` }),
      },
    },
  });

  it("a thread's text and files come back in a fresh client, and a send clears them", async () => {
    const restored: string[][] = [];
    const first = await connect(undefined, null, {}, undefined, fileStubs(restored));
    await first.open();
    await first.runtime.dispatch(setDraft, first.sessionId(), "half written");
    await first.runtime.dispatch(addAttachments, first.sessionId(), [picked("file-1", "a")], null);
    await settled();
    expect(first.stored.Files.get(THREAD_ID)?.map((file) => file.Name)).toEqual(["file-1"]);

    const sent: IStartTurn[] = [];
    const second = await connect(
      undefined,
      null,
      { startTurn: (effect: IStartTurn) => void sent.push(effect) },
      first.stored,
      fileStubs(restored),
    );
    await second.open();
    await settled();
    expect(second.session().Draft).toBe("half written");
    expect(restored).toEqual([["file-1"]]);
    expect(second.session().Attachments.map((file) => file.Name)).toEqual(["file-1"]);

    await second.runtime.dispatch(send, second.sessionId());
    await settled();
    expect(sent[0]!.Attachments.map((file) => file.id)).toEqual(["upload-restored-0"]);
    expect(second.stored.Files.has(THREAD_ID)).toBe(false);
    expect(second.stored.Drafts.has(THREAD_ID)).toBe(false);
  });

  const held = (server: Awaited<ReturnType<typeof connect>>) =>
    server.runtime.processSelector(heldSend, () => server.session());

  it("a send held for preparing images goes once they join the draft, and an edit cancels it", async () => {
    const sent: IStartTurn[] = [];
    const server = await connect(
      undefined,
      null,
      { startTurn: (effect: IStartTurn) => void sent.push(effect) },
      undefined,
      fileStubs([]),
    );
    await server.open();
    await server.runtime.dispatch(setDraft, server.sessionId(), "look at this");
    await server.runtime.dispatch(holdSend, server.sessionId(), "auto");
    expect(held(server)).toBe(true);
    await server.runtime.dispatch(addAttachments, server.sessionId(), [picked("a", "a")], null, 1);
    await settled();
    expect(sent).toEqual([]);
    await server.runtime.dispatch(addAttachments, server.sessionId(), [picked("b", "b")], null, 0);
    await settled();
    expect(held(server)).toBe(false);
    expect(sent.map((turn) => [turn.Text, turn.Attachments.map((file) => file.id)])).toEqual([
      ["look at this", ["upload-a", "upload-b"]],
    ]);

    await server.runtime.dispatch(setDraft, server.sessionId(), "another");
    await server.runtime.dispatch(holdSend, server.sessionId(), "auto");
    await server.runtime.dispatch(setDraft, server.sessionId(), "another, edited");
    expect(held(server)).toBe(false);
    await server.runtime.dispatch(addAttachments, server.sessionId(), [picked("c", "c")], null, 0);
    await settled();
    expect(sent).toHaveLength(1);
  });

  it("a held send is dropped when an image fails to prepare or a preparing one is removed", async () => {
    const sent: IStartTurn[] = [];
    const server = await connect(
      undefined,
      null,
      { startTurn: (effect: IStartTurn) => void sent.push(effect) },
      undefined,
      fileStubs([]),
    );
    await server.open();
    await server.runtime.dispatch(setDraft, server.sessionId(), "hi");
    await server.runtime.dispatch(holdSend, server.sessionId(), "auto");
    await server.runtime.dispatch(
      addAttachments,
      server.sessionId(),
      [],
      "'x.png' could not be read as an image.",
      0,
    );
    await settled();
    expect(held(server)).toBe(false);
    expect(sent).toEqual([]);

    await server.runtime.dispatch(holdSend, server.sessionId(), "auto");
    await server.runtime.dispatch(removeAttachment, server.sessionId(), "still-preparing");
    expect(held(server)).toBe(false);

    await server.runtime.dispatch(addAttachments, server.sessionId(), [picked("a", "a")], null);
    await server.runtime.dispatch(holdSend, server.sessionId(), "auto");
    await server.runtime.dispatch(removeAttachment, server.sessionId(), "a");
    expect(held(server)).toBe(false);

    await server.runtime.dispatch(holdSend, server.sessionId(), "auto");
    const file = { ...picked("notes", "notes.txt"), Kind: "file" as const };
    await server.runtime.dispatch(addAttachments, server.sessionId(), [file], null, 1);
    expect(held(server)).toBe(false);
  });

  it("a held send keeps waiting through an error that changed nothing in the draft", async () => {
    const server = await connect(undefined, null, {}, undefined, fileStubs([]));
    await server.open();
    await server.runtime.dispatch(setDraft, server.sessionId(), "hi");
    await server.runtime.dispatch(holdSend, server.sessionId(), "auto");
    await server.runtime.dispatch(addAttachments, server.sessionId(), [], "Couldn't get the path.");
    expect(held(server)).toBe(true);
  });

  it("Enter during a send doesn't hold a second one", async () => {
    const server = await connect(
      undefined,
      null,
      { startTurn: () => new Promise(() => {}) },
      undefined,
      fileStubs([]),
    );
    await server.open();
    await server.runtime.dispatch(setDraft, server.sessionId(), "first");
    void server.runtime.dispatch(send, server.sessionId());
    await settled();
    await server.runtime.dispatch(holdSend, server.sessionId(), "auto");
    expect(held(server)).toBe(false);
  });

  it("a new-thread draft comes back under its project with the same thread id", async () => {
    const first = await connect();
    await first.runtime.dispatch(newThread, first.envId(), "project-1");
    const threadId = first.environment().Local.SelectedThreadId!;
    await first.runtime.dispatch(setDraft, first.sessionId(threadId), "an idea");

    const second = await connect(undefined, null, {}, first.stored);
    await second.runtime.dispatch(newThread, second.envId(), "project-1");
    expect(second.environment().Local.SelectedThreadId).toBe(threadId);
    expect(second.session(threadId).Draft).toBe("an idea");
    expect(second.session(threadId).NewThreadProjectId).toBe("project-1");
  });

  it("an emptied draft leaves nothing behind, and deleting a thread forgets its draft", async () => {
    const server = await connect(undefined, null, { threadCommand: () => undefined });
    await server.open();
    await server.runtime.dispatch(setDraft, server.sessionId(), "x");
    await server.runtime.dispatch(setDraft, server.sessionId(), "");
    expect(server.stored.Drafts.has(THREAD_ID)).toBe(false);
    await server.runtime.dispatch(setDraft, server.sessionId(), "kept");
    server.stored.Files.set(THREAD_ID, [storedOf("a")]);
    await server.runtime.dispatch(threadCommand, server.envId(), THREAD_ID, { Kind: "delete" });
    expect(server.stored.Drafts.has(THREAD_ID)).toBe(false);
    expect(server.stored.Files.has(THREAD_ID)).toBe(false);
  });
});

describe("code blocks", () => {
  it("keep a wrap choice per thread, and lose it with the thread's session", async () => {
    const server = await connect(undefined, THREAD_ID, { threadCommand: () => undefined });
    const wraps = (threadId: string) => server.session(threadId).CodeWrap;
    await server.runtime.dispatch(toggleCodeWrap, server.sessionId(), "item-1:0:0", true);
    expect(wraps(THREAD_ID)).toEqual({ "item-1:0:0": false });
    await server.runtime.dispatch(selectThread, server.envId(), "other");
    expect(wraps("other")).toEqual({});
    await server.runtime.dispatch(selectThread, server.envId(), THREAD_ID);
    expect(wraps(THREAD_ID)).toEqual({ "item-1:0:0": false });
    await server.runtime.dispatch(toggleCodeWrap, server.sessionId(), "item-1:0:0", false);
    expect(wraps(THREAD_ID)).toEqual({ "item-1:0:0": true });
    await server.runtime.dispatch(threadCommand, server.envId(), THREAD_ID, { Kind: "delete" });
    await server.runtime.dispatch(selectThread, server.envId(), THREAD_ID);
    expect(wraps(THREAD_ID)).toEqual({});
  });

  it("wrap by the Word wrap setting until a block is toggled", () => {
    expect(codeWrapped({}, "item-1:0:0", true)).toBe(true);
    expect(codeWrapped({}, "item-1:0:0", false)).toBe(false);
    expect(codeWrapped({ "item-1:0:0": true }, "item-1:0:0", false)).toBe(true);
    expect(codeWrapped({ "item-1:0:0": false }, "item-1:0:0", true)).toBe(false);
  });
});

describe("diffs", () => {
  const checkpoint = (ordinal: number, runId: string, files: object[] = []) => ({
    id: `checkpoint-${ordinal}`,
    threadId: THREAD_ID,
    runId,
    appRunOrdinal: ordinal,
    status: "ready",
    files,
  });
  const withCheckpoints = () =>
    snapshotOf(
      {
        ...emptyProjection(),
        runs: [run("run-1", 1), run("run-2", 2)],
        checkpoints: [
          checkpoint(1, "run-1", [
            { path: "src/hello.txt", kind: "modified", additions: 1, deletions: 0 },
          ]),
          checkpoint(2, "run-2"),
        ],
      } as never,
      1,
    );
  // The Test project's shape: a plain folder, so its own snapshots are missing, holding a tracked
  // repository whose scope records no turn of its own.
  const folderWithRepository = (sequence: number) =>
    snapshotOf(
      {
        ...emptyProjection(),
        runs: [run("run-1", 1)],
        checkpointScopes: [
          { id: "scope-root", parentScopeId: null, cwd: "C:/test" },
          {
            id: "scope-demo",
            parentScopeId: "scope-root",
            cwd: "C:/test/demo",
            repositoryPath: "C:/test/demo",
            label: "demo",
          },
        ],
        // The repository's checkpoint comes first, as the same run's root one can.
        checkpoints: [
          {
            ...checkpoint(1, "run-1"),
            id: "checkpoint-demo-1",
            scopeId: "scope-demo",
            appRunOrdinal: null,
          },
          { ...checkpoint(1, "run-1"), scopeId: "scope-root", status: "missing" },
        ],
      } as never,
      sequence,
    );
  const fileChange = {
    ...commandItem("change", "run-1", 1),
    type: "file_change",
    fileName: "C:\\work\\src\\hello.txt",
  } as unknown as Extract<IWireTurnItem, { type: "file_change" }>;

  it("fetches one turn against the one before it, and closes and reopens on the latest", async () => {
    const asked: IThreadDiff[] = [];
    const server = await connect(undefined, null, {
      threadDiff: (effect: IThreadDiff) => {
        asked.push(effect);
        const marker = effect.ToTurnCount === 2 ? CHECKPOINT_DIFF_TRUNCATED_MARKER : "";
        return { Diff: `patch for turn ${effect.ToTurnCount}${marker}`, Repositories: [] };
      },
    });
    await server.open();
    await server.sendThread(withCheckpoints());
    const panel = () => server.environment().Local.ThreadSessions[THREAD_ID]!.Panels.Diff;
    await server.runtime.dispatch(openDiff, server.sessionId(), "turn", 1);
    await settled();
    expect(panel()).toMatchObject({
      Scope: "turn",
      TurnCount: 1,
      Latest: false,
      Text: "patch for turn 1",
      Truncated: false,
    });
    await server.runtime.dispatch(closeDiff, server.sessionId());
    expect(panel()).toBeNull();
    await server.runtime.dispatch(openDiff, server.sessionId(), "turn", null);
    await settled();
    expect(panel()).toMatchObject({
      TurnCount: 2,
      Latest: true,
      Text: `patch for turn 2${CHECKPOINT_DIFF_TRUNCATED_MARKER}`,
      Truncated: true,
    });
    expect(asked.map((ask) => [ask.FromTurnCount, ask.ToTurnCount, ask.IgnoreWhitespace])).toEqual([
      [0, 1, true],
      [1, 2, true],
    ]);
  });

  it("opens on the branch's changes, read from the latest changed repository where the thread folder isn't one", async () => {
    const asked: string[] = [];
    const server = await connect(undefined, null, {
      branchDiff: (effect: { Source: string; Cwd: string }) => {
        asked.push(`${effect.Source} ${effect.Cwd}`);
        return { Diff: "", HeadRef: null, BaseRef: null, Truncated: false };
      },
    });
    await server.sendShell({
      kind: "snapshot",
      snapshot: {
        snapshotSequence: 1,
        projects: [{ id: "project-1", title: "One", workspaceRoot: "/repo" }],
        threads: [],
      },
    } as unknown as IWireShellItem);
    await server.open();
    await server.sendThread(withCheckpoints());
    await server.runtime.dispatch(openDiff, server.sessionId(), null, null);
    await settled();
    expect(server.session().Panels.Diff).toMatchObject({ Scope: "branch" });
    await server.runtime.dispatch(openDiff, server.sessionId(), "unstaged", null);
    await settled();
    expect(server.session().Panels.Diff).toMatchObject({ Scope: "unstaged" });
    await server.runtime.dispatch(closeDiff, server.sessionId());

    await server.sendThread(folderWithRepository(2));
    await server.runtime.dispatch(openDiff, server.sessionId(), null, null);
    await settled();
    expect(server.session().Panels.Diff).toMatchObject({
      Scope: "branch",
      GitRepository: "C:/test/demo",
    });
    await server.runtime.dispatch(openDiff, server.sessionId(), "unstaged", null);
    await settled();
    expect(server.session().Panels.Diff).toMatchObject({ GitRepository: "C:/test/demo" });
    expect(asked).toEqual([
      "branch-range /repo",
      "working-tree /repo",
      "branch-range C:/test/demo",
      "working-tree C:/test/demo",
    ]);
  });

  it("serves a folder project's turns by repository, which its own missing snapshot doesn't hide", async () => {
    const server = await connect(undefined, null, {
      threadDiff: () => ({
        Diff: "",
        Repositories: [
          { name: "demo", repositoryPath: "C:/test/demo", relativePath: "demo", diff: "patch" },
        ],
      }),
    });
    await server.open();
    await server.sendThread(folderWithRepository(1));
    expect(latestDiffTurn(server.thread())).toBe(1);
    expect(diffTurns(server.thread()).map((turn) => turn.TurnCount)).toEqual([1]);
    expect(folderIsRepository(server.thread())).toBe(false);
    expect(diffTurnOf(server.thread(), fileChange)).toBe(1);
    expect(gitRepositories(server.thread())).toEqual([
      { RepositoryPath: "C:/test/demo", Name: "demo", Cwd: "C:/test/demo" },
    ]);
    await server.runtime.dispatch(openDiff, server.sessionId(), "turn", 1);
    await settled();
    expect(server.session().Panels.Diff).toMatchObject({
      Text: "",
      Repositories: [{ name: "demo", relativePath: "demo", diff: "patch" }],
    });
    await server.runtime.dispatch(selectDiffRepository, server.sessionId(), "C:/test/demo");
    expect(server.session().Panels.Diff).toMatchObject({ Repository: "C:/test/demo" });

    await server.sendThread(
      snapshotOf(
        {
          ...emptyProjection(),
          runs: [run("run-1", 1)],
          checkpoints: [{ ...checkpoint(1, "run-1"), status: "missing" }],
        } as never,
        3,
      ),
    );
    expect(latestDiffTurn(server.thread())).toBeNull();
  });

  it("refetches with whitespace shown, and keeps each file's collapse until the scope changes", async () => {
    const asked: boolean[] = [];
    const server = await connect(undefined, null, {
      threadDiff: (effect: IThreadDiff) => {
        asked.push(effect.IgnoreWhitespace);
        return { Diff: "patch", Repositories: [] };
      },
    });
    await server.open();
    await server.sendThread(withCheckpoints());
    const panel = () => server.session().Panels.Diff;
    await server.runtime.dispatch(openDiff, server.sessionId(), "turn", 1);
    await settled();
    await server.runtime.dispatch(setDiffFilesCollapsed, server.sessionId(), ["a", "b"], false);
    await server.runtime.dispatch(setDiffFilesCollapsed, server.sessionId(), ["b"], true);
    expect(panel()!.Collapsed).toEqual({ a: false, b: true });
    await server.runtime.dispatch(toggleDiffWhitespace, server.sessionId());
    await settled();
    expect(asked).toEqual([true, false]);
    expect(panel()).toMatchObject({ IgnoreWhitespace: false, Text: "patch" });
    expect(panel()!.Collapsed).toEqual({ a: false, b: true });
    await server.runtime.dispatch(openDiff, server.sessionId(), "turn", 2);
    await settled();
    expect(asked).toEqual([true, false, false]);
    expect(panel()!.Collapsed).toEqual({});
  });

  it("replaces the panel on reopen, so a diff for the one it moved on from lands nowhere", async () => {
    const replies = new Map<number, (text: string) => void>();
    const server = await connect(undefined, null, {
      threadDiff: (effect: IThreadDiff) =>
        new Promise((resolve) =>
          replies.set(effect.ToTurnCount, (text) => resolve({ Diff: text, Repositories: [] })),
        ),
    });
    await server.open();
    const panel = () => server.environment().Local.ThreadSessions[THREAD_ID]!.Panels.Diff;
    const loading = () => server.runtime.processSelector(diffLoading, () => server.session());
    await server.runtime.dispatch(openDiff, server.sessionId(), "turn", 1);
    const stale = panel()!.$Id;
    const staleGone = server.disposed(stale);
    await server.runtime.dispatch(openDiff, server.sessionId(), "turn", 2);
    await staleGone;
    expect(panel()!.$Id).not.toBe(stale);
    replies.get(1)!("stale");
    await settled();
    expect(panel()).toMatchObject({ TurnCount: 2, Text: null });
    expect(loading()).toBe(true);
    replies.get(2)!("current");
    await settled();
    expect(panel()).toMatchObject({ TurnCount: 2, Text: "current" });
    expect(loading()).toBe(false);
    await server.runtime.dispatch(openDiff, server.sessionId(), "turn", 1);
    const closedGone = server.disposed(panel()!.$Id);
    await server.runtime.dispatch(closeDiff, server.sessionId());
    await closedGone;
    expect(loading()).toBe(false);
    replies.get(1)!("late");
    await settled();
    expect(panel()).toBeNull();
  });

  it("refetches an open latest-turn or branch diff when the workspace changes, clearing the text only when the turn moves on", async () => {
    const asked: string[] = [];
    let replyTo: ((text: string) => void) | null = null;
    const server = await connect(undefined, null, {
      threadDiff: (effect: IThreadDiff) => {
        asked.push(`turn ${effect.ToTurnCount}`);
        return new Promise((resolve) => {
          replyTo = (text) => resolve({ Diff: text, Repositories: [] });
        });
      },
      branchDiff: () => {
        asked.push("branch");
        return { Diff: `branch ${asked.length}`, HeadRef: null, BaseRef: null, Truncated: false };
      },
    });
    await server.sendShell({
      kind: "snapshot",
      snapshot: {
        snapshotSequence: 1,
        projects: [{ id: "project-1", title: "One", workspaceRoot: "/repo" }],
        threads: [],
      },
    } as unknown as IWireShellItem);
    await server.open();
    await server.sendThread(
      snapshotOf(
        {
          ...emptyProjection(),
          runs: [run("run-1", 1), run("run-2", 2, "running")],
          checkpoints: [checkpoint(1, "run-1")],
        } as never,
        1,
      ),
    );
    const panel = () => server.session().Panels.Diff;
    const loading = () => server.runtime.processSelector(diffLoading, () => server.session());
    await server.runtime.dispatch(openDiff, server.sessionId(), "turn", null);
    replyTo!("through 1");
    await settled();
    await server.sendThread({
      kind: "event",
      sequence: 2,
      event: event("run.updated", run("run-2", 2)),
    } as IWireThreadItem);
    await server.sendThread({
      kind: "event",
      sequence: 3,
      event: event("checkpoint.captured", checkpoint(2, "run-2")),
    } as IWireThreadItem);
    await settled();
    expect(asked).toEqual(["turn 1", "turn 2"]);
    expect(panel()).toMatchObject({ TurnCount: 2, Text: null });
    expect(loading()).toBe(true);
    replyTo!("through 2");
    await settled();
    expect(panel()).toMatchObject({ TurnCount: 2, Text: "through 2" });

    await server.runtime.dispatch(openDiff, server.sessionId(), "turn", 1);
    replyTo!("turn 1");
    await server.sendThread({
      kind: "event",
      sequence: 4,
      event: event("checkpoint.captured", checkpoint(3, "run-3")),
    } as IWireThreadItem);
    await server.sendThread({
      kind: "event",
      sequence: 5,
      event: event("run.updated", run("run-3", 3)),
    } as IWireThreadItem);
    await settled();
    expect(asked).toEqual(["turn 1", "turn 2", "turn 1"]);

    await server.runtime.dispatch(openDiff, server.sessionId(), "branch", null);
    await settled();
    await server.sendThread({
      kind: "event",
      sequence: 6,
      event: event("turn-item.updated", { ...commandItem("edit", "run-4", 1), status: "running" }),
    } as IWireThreadItem);
    await server.sendThread({
      kind: "event",
      sequence: 7,
      event: event("turn-item.updated", commandItem("edit", "run-4", 1)),
    } as IWireThreadItem);
    await server.sendThread({
      kind: "event",
      sequence: 8,
      event: event("turn-item.updated", commandItem("edit", "run-4", 1)),
    } as IWireThreadItem);
    await settled();
    expect(asked).toEqual(["turn 1", "turn 2", "turn 1", "branch", "branch"]);
    expect(panel()).toMatchObject({ Scope: "branch", Text: "branch 5" });

    const settledWhileAway = { ...commandItem("away", "run-4", 2), status: "completed" };
    await server.sendThread(
      snapshotOf(
        {
          ...emptyProjection(),
          runs: [run("run-1", 1), run("run-2", 2), run("run-3", 3)],
          checkpoints: [checkpoint(1, "run-1"), checkpoint(2, "run-2"), checkpoint(3, "run-3")],
          turnItems: [commandItem("edit", "run-4", 1), settledWhileAway],
        } as never,
        9,
      ),
    );
    await settled();
    expect(asked).toEqual(["turn 1", "turn 2", "turn 1", "branch", "branch", "branch"]);
  });

  it("shows a failed fetch and an empty turn", async () => {
    const server = await connect(undefined, null, {
      threadDiff: () => {
        throw serverFailure("checkpoint is missing");
      },
    });
    await server.open();
    await server.runtime.dispatch(openDiff, server.sessionId(), "turn", 1);
    await settled();
    const panel = server.environment().Local.ThreadSessions[THREAD_ID]!.Panels.Diff;
    expect(panel).toMatchObject({ Error: "checkpoint is missing", Text: null });
  });

  it("diffs the branch in the thread's checkout, and the right panel toggle closes it", async () => {
    const asked: unknown[] = [];
    const server = await connect(undefined, null, {
      branchDiff: (effect: { EnvironmentId: string; Cwd: string }) => {
        asked.push(effect.Cwd);
        return {
          Diff: "branch patch",
          HeadRef: "feature",
          BaseRef: "origin/main",
          Truncated: false,
        };
      },
    });
    await server.sendShell({
      kind: "snapshot",
      snapshot: {
        snapshotSequence: 1,
        projects: [{ id: "project-1", title: "One", workspaceRoot: "/repo" }],
        threads: [],
      },
    } as unknown as IWireShellItem);
    await server.open();
    await server.sendThread(snapshotOf(emptyProjection(), 1));
    const panels = () => server.environment().Local.ThreadSessions[THREAD_ID]!.Panels;
    expect(server.environment().Local.Preferences.DetailsOpen).toBe(true);
    await server.runtime.dispatch(toggleRightPanel, server.sessionId());
    expect(panels().Launcher.Open).toBe(true);
    await server.runtime.dispatch(openDiff, server.sessionId(), "branch", null);
    await settled();
    expect(asked).toEqual(["/repo"]);
    expect(panels().Launcher.Open).toBe(false);
    expect(panels().Diff).toMatchObject({
      Scope: "branch",
      Text: "branch patch",
      BaseRef: "origin/main",
    });
    // The diff header's "+" shows the launcher over the diff; closing it goes back to the diff.
    await server.runtime.dispatch(openLauncher, server.sessionId());
    expect(panels().Launcher.Open).toBe(true);
    await server.runtime.dispatch(closeRightPanel, server.sessionId());
    expect(panels().Launcher.Open).toBe(false);
    expect(panels().Diff).not.toBeNull();
    await server.runtime.dispatch(toggleRightPanel, server.sessionId());
    expect(panels().Diff).toBeNull();
    expect(panels().Launcher.Open).toBe(false);
  });

  it("runs the panel shortcuts on the shown thread's session, toggling details by fit", async () => {
    let refreshes = 0;
    const server = await connect(undefined, null, { refreshVcsStatus: () => void refreshes++ });
    await server.sendShell({
      kind: "snapshot",
      snapshot: {
        snapshotSequence: 1,
        projects: [{ id: "project-1", title: "One", workspaceRoot: "/repo" }],
        threads: [],
      },
    } as unknown as IWireShellItem);
    await server.open();
    await server.runtime.dispatch(selectThread, server.envId(), THREAD_ID);
    await server.sendThread(snapshotOf(emptyProjection(), 1));
    const shown = () => server.runtime.processSelector(panelShortcuts, server.environment);
    const run = async (command: KeybindingCommand) => {
      const applied = runPanelShortcut(command, shown(), (action, target, ...args) =>
        server.runtime.dispatch(action, target, ...args),
      );
      await settled();
      return applied;
    };
    const panels = () => server.session().Panels;
    expect(shown()?.SessionId).toBe(server.sessionId());

    expect(await run("rightPanel.toggle")).toBe(true);
    expect(panels().Launcher.Open).toBe(true);
    expect(await run("diff.toggle")).toBe(false);

    expect(refreshes).toBe(1);
    expect(await run("threadPanel.toggle")).toBe(true);
    expect(panels().Details).toMatchObject({ Popover: true });
    expect(server.environment().Local.Preferences.DetailsOpen).toBe(true);
    expect(refreshes).toBe(2);
    await server.runtime.dispatch(fitDetails, server.sessionId(), true);
    expect(await run("threadPanel.toggle")).toBe(true);
    expect(panels().Details).toMatchObject({ Popover: true });
    expect(server.environment().Local.Preferences.DetailsOpen).toBe(false);
    expect(refreshes).toBe(2);
    await server.runtime.dispatch(closeDetailsPopover, server.sessionId());
    await server.runtime.dispatch(fitDetails, server.sessionId(), false);
    expect(await run("threadPanel.toggle")).toBe(true);
    expect(refreshes).toBe(3);

    await server.runtime.dispatch(openView, server.envId(), { Kind: "settings", Page: "general" });
    expect(shown()).toBeNull();
    expect(await run("rightPanel.toggle")).toBe(false);
    expect(panels().Launcher.Open).toBe(true);
  });

  it("pins the details card for every thread on this device, across a reload", async () => {
    const server = await connect();
    await server.runtime.dispatch(selectThread, server.envId(), "a");
    await server.runtime.dispatch(fitDetails, server.sessionId("a"), true);
    await server.runtime.dispatch(toggleDetails, server.sessionId("a"));
    await settled();
    expect(server.device.Preferences.DetailsOpen).toBe(false);
    await server.runtime.dispatch(selectThread, server.envId(), "b");
    await server.runtime.dispatch(fitDetails, server.sessionId("b"), true);
    expect(server.runtime.processSelector(detailsOpen, () => server.session("b"))).toBe(false);
    await server.runtime.dispatch(toggleDetails, server.sessionId("b"));
    await settled();
    expect(server.runtime.processSelector(detailsOpen, () => server.session("a"))).toBe(true);
    await server.runtime.dispatch(toggleDetails, server.sessionId("b"));
    await settled();

    const reloaded = await connect(
      undefined,
      null,
      {},
      undefined,
      undefined,
      server.device.Preferences,
    );
    expect(reloaded.environment().Local.Preferences.DetailsOpen).toBe(false);
    await reloaded.runtime.dispatch(selectThread, reloaded.envId(), "a");
    expect(reloaded.runtime.processSelector(detailsOpen, () => reloaded.session("a"))).toBe(false);
  });

  it("takes a file change's counts from its run's checkpoint when the item has none", async () => {
    const server = await connect();
    await server.open();
    await server.sendThread(withCheckpoints());
    expect(fileChangeCounts(server.thread(), fileChange)).toEqual({ additions: 1, deletions: 0 });
    expect(diffTurnOf(server.thread(), fileChange)).toBe(1);
    expect(
      fileChangeCounts(server.thread(), { ...fileChange, fileName: "C:\\work\\other.txt" }),
    ).toBeNull();
    expect(fileChangeCounts(server.thread(), { ...fileChange, additions: 4 })).toEqual({
      additions: 4,
      deletions: 0,
    });
  });

  it("offers only a ready checkpoint of a completed run, as the server serves", async () => {
    const server = await connect();
    await server.open();
    await server.sendThread(withCheckpoints());
    expect(latestDiffTurn(server.thread())).toBe(2);
    await server.sendThread({
      kind: "event",
      sequence: 2,
      event: event("run.updated", run("run-2", 2, "interrupted")),
    } as IWireThreadItem);
    expect(latestDiffTurn(server.thread())).toBe(1);
    const stopped = { ...fileChange, runId: "run-2" } as typeof fileChange;
    expect(diffTurnOf(server.thread(), stopped)).toBeNull();
    await server.sendThread({
      kind: "event",
      sequence: 3,
      event: event("checkpoint.captured", { ...checkpoint(1, "run-1"), status: "failed" }),
    } as IWireThreadItem);
    expect(latestDiffTurn(server.thread())).toBeNull();
    // A run older than the loaded history window isn't held, so nothing says it stopped.
    await server.sendThread({
      kind: "event",
      sequence: 4,
      event: event("checkpoint.captured", checkpoint(3, "run-outside-window")),
    } as IWireThreadItem);
    expect(diffTurns(server.thread()).map((turn) => turn.TurnCount)).toEqual([3]);
  });
});

describe("the files preview", () => {
  const withRepo = async (commands: Record<string, (effect: never) => unknown>) => {
    const server = await connect(undefined, null, {
      branchDiff: () => ({ Diff: "", HeadRef: null, BaseRef: null, Truncated: false }),
      ...commands,
    });
    await server.sendShell({
      kind: "snapshot",
      snapshot: {
        snapshotSequence: 1,
        projects: [{ id: "project-1", title: "One", workspaceRoot: "/repo" }],
        threads: [],
      },
    } as unknown as IWireShellItem);
    await server.open();
    return server;
  };
  const text = (Contents: string) => ({
    Kind: "text",
    Contents,
    ByteLength: Contents.length,
    Truncated: false,
  });

  it("reads a linked file in the thread's folder, scrolls again on a second link, and trades places with the diff", async () => {
    const asked: string[] = [];
    const server = await withRepo({
      readProjectFile: (effect: { Cwd: string; Path: string }) => {
        asked.push(`${effect.Cwd} ${effect.Path}`);
        return text(`read ${asked.length}`);
      },
    });
    await server.sendThread(
      snapshotOf(
        {
          ...emptyProjection(),
          runs: [run("run-1", 1), run("run-2", 2, "running")],
          checkpoints: [
            {
              id: "checkpoint-1",
              threadId: THREAD_ID,
              runId: "run-1",
              appRunOrdinal: 1,
              status: "ready",
              files: [],
            },
          ],
        } as never,
        1,
      ),
    );
    const panels = () => server.session().Panels;
    await server.runtime.dispatch(openFile, server.sessionId(), "src/a.ts", 12);
    await settled();
    expect(panels().File).toMatchObject({
      Source: { Kind: "workspace", Path: "src/a.ts", Cwd: "/repo" },
      RevealLine: 12,
      RevealId: 1,
      Read: text("read 1"),
    });
    const held = panels().File!.$Id;
    await server.runtime.dispatch(openFile, server.sessionId(), "src/a.ts/", 30);
    await server.runtime.dispatch(openFile, server.sessionId(), ".", null);
    await settled();
    expect(panels().File).toMatchObject({ $Id: held, RevealLine: 30, RevealId: 2 });
    expect(asked).toEqual(["/repo src/a.ts"]);

    await server.runtime.dispatch(openDiff, server.sessionId(), "branch", null);
    expect(panels().File).toBeNull();
    await server.runtime.dispatch(openFile, server.sessionId(), "/elsewhere/b.ts", null);
    await settled();
    expect(panels().Diff).toBeNull();
    expect(panels().File).toMatchObject({ RevealLine: null, Read: text("read 2") });

    await server.sendThread({
      kind: "event",
      sequence: 2,
      event: event("run.updated", run("run-2", 2)),
    } as IWireThreadItem);
    await server.sendThread({
      kind: "event",
      sequence: 3,
      event: event("checkpoint.captured", {
        id: "checkpoint-2",
        threadId: THREAD_ID,
        runId: "run-2",
        appRunOrdinal: 2,
        status: "ready",
        files: [],
      }),
    } as IWireThreadItem);
    await settled();
    expect(asked).toEqual(["/repo src/a.ts", "/repo /elsewhere/b.ts", "/repo /elsewhere/b.ts"]);
    expect(panels().File?.Read).toEqual(text("read 3"));
    await server.runtime.dispatch(closeRightPanel, server.sessionId());
    expect(panels().File).toBeNull();
  });

  it("keeps the server's refusal as the file's answer, and a dropped read as a failure to retry", async () => {
    const refusal = {
      Kind: "error",
      Message: "Failed to read",
      Failure: "binary_file",
      Operation: null,
      AttemptedPath: "/repo/logo.bin",
      Cwd: "/repo",
    };
    let reply: () => unknown = () => refusal;
    const server = await withRepo({ readProjectFile: () => reply() });
    await server.sendThread(snapshotOf(emptyProjection(), 1));
    const file = () => server.session().Panels.File;
    const loading = () => server.runtime.processSelector(fileLoading, () => server.session());
    await server.runtime.dispatch(openFile, server.sessionId(), "logo.bin", null);
    await settled();
    expect(file()?.Read).toEqual(refusal);
    await server.runtime.dispatch(closeFile, server.sessionId());

    reply = () => {
      throw serverFailure("socket closed");
    };
    await server.runtime.dispatch(openFile, server.sessionId(), "notes.txt", null);
    await settled();
    expect(file()?.Read).toEqual({ Kind: "failed", Message: "socket closed" });

    let resolve!: (value: unknown) => void;
    reply = () => new Promise((done) => (resolve = done));
    await server.runtime.dispatch(reloadFile, server.sessionId());
    expect(file()?.Read).toBeNull();
    expect(loading()).toBe(true);
    resolve(text("hello"));
    await settled();
    expect(file()?.Read).toEqual(text("hello"));
    expect(loading()).toBe(false);
  });

  it("reads a sent attachment's text only for a kind shown as text, and reopens the one shown in place", async () => {
    const asked: string[] = [];
    const server = await withRepo({
      assetText: (effect: { Resource: { attachmentId: string; disposition: string } }) => {
        asked.push(`${effect.Resource.attachmentId} ${effect.Resource.disposition}`);
        return { Text: "# Notes", Truncated: true };
      },
    });
    await server.sendThread(snapshotOf(emptyProjection(), 1));
    const file = () => server.session().Panels.File;
    const attachment = (Id: string, Name: string, MimeType: string) =>
      ({ Kind: "attachment", Id, Name, MimeType, SizeBytes: 2_000_000 }) as const;
    await server.runtime.dispatch(
      openAttachment,
      server.sessionId(),
      attachment("a-1", "notes.md", "text/markdown"),
    );
    await settled();
    expect(file()?.Read).toEqual({ Kind: "attachment", Text: "# Notes", Truncated: true });
    const held = file()!.$Id;
    await server.runtime.dispatch(
      openAttachment,
      server.sessionId(),
      attachment("a-1", "notes.md", "text/markdown"),
    );
    expect(file()?.$Id).toBe(held);

    await server.runtime.dispatch(
      openAttachment,
      server.sessionId(),
      attachment("a-2", "deck.pdf", "application/pdf"),
    );
    await settled();
    expect(file()).toMatchObject({ Source: { Id: "a-2" }, Read: null });
    expect(server.runtime.processSelector(fileLoading, () => server.session())).toBe(false);
    expect(asked).toEqual(["a-1 inline"]);
  });

  it("opens editors on the server's machine only for a client reaching it at a loopback address", async () => {
    const local = await connect();
    expect(local.runtime.processSelector(openMode, local.environment)).toBe("local-exec");
    const remote = await connect(undefined, null, {
      environmentInfo: () => ({
        Authenticated: true,
        BootstrapMethods: [],
        EnvironmentId: ENV,
        Label: "Test",
        FileAttachmentLimit: null,
        Hostname: "desk.tail.ts.net",
      }),
    });
    expect(remote.runtime.processSelector(openMode, remote.environment)).toBe("remote-unavailable");
  });
});

describe("the terminal", () => {
  const withProject = async (
    server: Awaited<ReturnType<typeof connect>>,
    worktree: string | null,
  ) => {
    await server.sendShell({
      kind: "snapshot",
      snapshot: {
        snapshotSequence: 1,
        projects: [{ id: "p-1", title: "One", workspaceRoot: "/root" }],
        threads: [],
        archivedThreads: [],
      },
    } as unknown as IWireShellItem);
    const projection = emptyProjection();
    await server.sendThread(
      snapshotOf(
        {
          ...projection,
          thread: { ...projection.thread, projectId: "p-1", worktreePath: worktree },
        } as never,
        1,
      ),
    );
  };
  const panel = (server: Awaited<ReturnType<typeof connect>>, threadId = THREAD_ID) =>
    server.environment().Local.ThreadSessions[threadId]!.Terminal;
  const attached = (server: Awaited<ReturnType<typeof connect>>) =>
    server.runtime
      .resources()
      .filter((row) => row.Key === "Terminal/Session")
      .map((row) => row.Params as unknown as { ThreadId: string; TerminalId: string; Cwd: string });

  it("starts in the worktree when the thread has one, and a shell keeps where it started", async () => {
    const server = await connect();
    await server.open();
    await withProject(server, null);
    await server.runtime.dispatch(openTerminal, server.terminalId());
    expect(attached(server)[0]).toMatchObject({ Cwd: "/root", TerminalId: "term-1" });
    await server.runtime.dispatch(closeTerminal, server.terminalId());
    await withProject(server, "/root/wt");
    await server.runtime.dispatch(openTerminal, server.terminalId());
    expect(attached(server)[0]).toMatchObject({ Cwd: "/root", TerminalId: "term-1" });
    await server.runtime.dispatch(addTerminal, server.terminalId(), null);
    expect(attached(server)[1]).toMatchObject({ Cwd: "/root/wt", WorktreePath: "/root/wt" });
  });

  it("hiding detaches and keeps the terminal id, and asks the server to end nothing", async () => {
    const closes: unknown[] = [];
    const server = await connect(undefined, null, {
      closeTerminal: (effect: unknown) => {
        closes.push(effect);
      },
    });
    await server.open();
    await withProject(server, null);
    await server.runtime.dispatch(openTerminal, server.terminalId());
    expect(panel(server).Open).toBe(true);
    await server.runtime.dispatch(addTerminal, server.terminalId(), null);
    await server.runtime.dispatch(closeTerminal, server.terminalId());
    expect(panel(server)).toMatchObject({
      Open: false,
      Layout: { TerminalIds: ["term-1", "term-2"] },
    });
    expect(attached(server)).toEqual([]);
    expect(closes).toEqual([]);
    expect(server.terminals.get(THREAD_ID)).toMatchObject({ Open: false });
    await server.runtime.dispatch(openTerminal, server.terminalId());
    expect(attached(server).map((row) => row.TerminalId)).toEqual(["term-1", "term-2"]);
  });

  it("opens new tabs and splits beside the active shell, each with its own shell", async () => {
    const server = await connect();
    await server.open();
    await withProject(server, null);
    await server.runtime.dispatch(openTerminal, server.terminalId());
    await server.runtime.dispatch(addTerminal, server.terminalId(), null);
    await server.runtime.dispatch(addTerminal, server.terminalId(), "vertical");
    expect(panel(server).Layout).toEqual({
      TerminalIds: ["term-1", "term-2", "term-3"],
      Groups: [
        { Id: "group-term-1", TerminalIds: ["term-1"], SplitDirection: "horizontal" },
        { Id: "group-term-2", TerminalIds: ["term-2", "term-3"], SplitDirection: "vertical" },
      ],
      ActiveTerminalId: "term-3",
      ActiveGroupId: "group-term-2",
    });
    expect(attached(server).map((row) => row.TerminalId)).toEqual(["term-1", "term-2", "term-3"]);
    expect(panel(server).Shells["term-3"]).toMatchObject({ FocusOnMount: true });
    await server.runtime.dispatch(activateShell, server.terminalId(), "term-1");
    expect(server.terminals.get(THREAD_ID)).toMatchObject({
      Open: true,
      Layout: { ActiveTerminalId: "term-1", ActiveGroupId: "group-term-1" },
      Launches: { "term-1": { Cwd: "/root" }, "term-3": { Cwd: "/root" } },
    });
  });

  it("ending a shell tells the server and closes its tab; the last one hides the drawer", async () => {
    const closes: Array<{ TerminalId: string }> = [];
    let refuse = true;
    const server = await connect(undefined, null, {
      closeTerminal: (effect: { TerminalId: string }) => {
        if (refuse) throw serverFailure("server said no");
        closes.push(effect);
      },
    });
    await server.open();
    await withProject(server, null);
    await server.runtime.dispatch(openTerminal, server.terminalId());
    await server.runtime.dispatch(addTerminal, server.terminalId(), "horizontal");
    await server.runtime.dispatch(endShell, server.terminalShellId("term-2"));
    expect(panel(server).Shells["term-2"]).toMatchObject({ Error: "server said no" });
    expect(attached(server)).toHaveLength(2);
    refuse = false;
    await server.runtime.dispatch(endShell, server.terminalShellId("term-2"));
    await settled();
    expect(panel(server)).toMatchObject({
      Open: true,
      Layout: { TerminalIds: ["term-1"], ActiveTerminalId: "term-1" },
    });
    expect(Object.keys(panel(server).Shells)).toEqual(["term-1"]);
    expect(attached(server).map((row) => row.TerminalId)).toEqual(["term-1"]);
    await server.runtime.dispatch(endShell, server.terminalShellId("term-1"));
    await settled();
    expect(closes.map((close) => close.TerminalId)).toEqual(["term-2", "term-1"]);
    expect(panel(server).Open).toBe(false);
    expect(attached(server)).toEqual([]);
    expect(server.terminals.size).toBe(0);
  });

  it("restarts an exited shell in its own tab", async () => {
    const server = await connect();
    await server.open();
    await withProject(server, null);
    await server.runtime.dispatch(openTerminal, server.terminalId());
    const shellId = server.terminalShellId();
    await server.runtime.dispatch(
      TerminalShellReceiver.handle,
      shellId,
      { Type: "Terminal/Session", Status: "exited", Error: "gone" } as never,
      { publisher: { Id: shellId } },
    );
    const before = server.runtime.resources().find((row) => row.Key === "Terminal/Session");
    await server.runtime.dispatch(restartShell, shellId);
    const after = server.runtime.resources().find((row) => row.Key === "Terminal/Session");
    expect(panel(server).Shells["term-1"]).toMatchObject({ Status: null, FocusOnMount: true });
    expect(panel(server).Shells["term-1"]!.Error).toBeUndefined();
    expect(after).toBeDefined();
    expect(after).not.toBe(before);
  });

  it("keeps the drawer's height per thread", async () => {
    const server = await connect();
    await server.open();
    await withProject(server, null);
    await server.runtime.dispatch(openTerminal, server.terminalId());
    await server.runtime.dispatch(setTerminalHeight, server.terminalId(), 412.4);
    expect(panel(server).Height).toBe(412);
    expect(server.terminals.get(THREAD_ID)).toMatchObject({ Height: 412 });
  });

  it("detaches while another thread is selected, and a return or a reload reattaches", async () => {
    const launch = { Cwd: "/root", WorktreePath: null, ProjectRoot: "/root" };
    const server = await connect();
    // A launch stored before tabs comes back as one open shell.
    const held = readRememberedTerminal(launch)!;
    server.terminals.set("a", {
      ...held,
      Height: 360,
      Layout: { ...held.Layout, TerminalIds: ["term-1", "term-2", "term-9"] },
      Launches: { ...held.Launches, "term-2": launch },
    });
    await server.runtime.dispatch(selectThread, server.envId(), "a");
    await settled();
    expect(attached(server).map((row) => [row.ThreadId, row.TerminalId])).toEqual([
      ["a", "term-1"],
      ["a", "term-2"],
    ]);
    expect(panel(server, "a")).toMatchObject({ Open: true, Height: 360 });
    expect(panel(server, "a").Shells["term-1"]!.FocusOnMount).toBe(false);
    await server.runtime.dispatch(selectThread, server.envId(), "b");
    await settled();
    expect(attached(server)).toEqual([]);
    await server.runtime.dispatch(selectThread, server.envId(), "a");
    await settled();
    expect(attached(server)).toHaveLength(2);
  });

  it("deleting the thread disposes the attachment and forgets the launch", async () => {
    const server = await connect();
    await server.open();
    await withProject(server, null);
    await server.runtime.dispatch(openTerminal, server.terminalId());
    expect(server.terminals.has(THREAD_ID)).toBe(true);
    const gone = server.disposed(server.sessionId());
    await server.sendThread({
      kind: "event",
      sequence: 2,
      event: event("thread.deleted", {}),
    } as IWireThreadItem);
    await gone;
    expect(attached(server)).toEqual([]);
    await settled();
    expect(server.terminals.has(THREAD_ID)).toBe(false);
  });

  it("shows what the shell reports, and forgets it when the thread closes", async () => {
    const server = await connect();
    await server.open();
    await withProject(server, null);
    await server.runtime.dispatch(openTerminal, server.terminalId());
    const shellId = server.terminalShellId();
    const deliver = (message: object) =>
      server.runtime.dispatch(
        TerminalShellReceiver.handle,
        shellId,
        { Type: "Terminal/Session", ...message } as never,
        { publisher: { Id: shellId } },
      );
    const shell = () => panel(server).Shells["term-1"]!;
    await deliver({ Status: "running", Error: null });
    expect(shell().Status).toBe("running");
    await deliver({ Status: "exited", Error: null });
    expect(shell().Status).toBe("exited");
    await server.runtime.dispatch(closeThread, server.envId(), THREAD_ID);
    await settled();
    expect(shell().Status).toBeNull();
  });

  it("holds its attachment in the shell's own plain fields", async () => {
    const server = await connect();
    await server.open();
    await withProject(server, null);
    await server.runtime.dispatch(openTerminal, server.terminalId());
    const shellId = server.terminalShellId();
    await server.runtime.dispatch(
      TerminalShellReceiver.handle,
      shellId,
      { Type: "Terminal/Session", Status: "running", Error: "lost a line" } as never,
      { publisher: { Id: shellId } },
    );
    expect(JSON.parse(JSON.stringify(panel(server).Shells["term-1"]))).toEqual({
      $Id: shellId,
      EnvironmentId: ENV,
      ThreadId: THREAD_ID,
      TerminalId: "term-1",
      Launch: { Cwd: "/root", WorktreePath: null, ProjectRoot: "/root" },
      Error: "lost a line",
      Status: "running",
      FocusOnMount: true,
    });
  });

  it("a project script runs in the thread's terminal and shows it, unless the server refuses", async () => {
    const ran: Array<{ TerminalId: string; Command: string; Cwd: string }> = [];
    let refuse = true;
    const server = await connect(undefined, null, {
      runScript: (effect: { TerminalId: string; Command: string; Cwd: string }) => {
        if (refuse) throw serverFailure("no shell");
        ran.push(effect);
      },
    });
    await server.runtime.dispatch(selectThread, server.envId(), THREAD_ID);
    await withProject(server, null);
    const script = { id: "dev", name: "Dev", command: "vp dev", icon: "play" as const };
    await server.runtime.dispatch(runScript, server.sessionId(), script as never);
    await settled();
    expect(server.session().ScriptError).toBe("no shell");
    expect(panel(server).Open).toBe(false);
    refuse = false;
    await server.runtime.dispatch(runScript, server.sessionId(), script as never);
    await settled();
    expect(server.session().ScriptError).toBeUndefined();
    expect(ran).toMatchObject([{ TerminalId: "term-1", Command: "vp dev", Cwd: "/root" }]);
    expect(panel(server)).toMatchObject({
      Open: true,
      Shells: { "term-1": { FocusOnMount: true } },
    });
    expect(attached(server).map((row) => row.TerminalId)).toEqual(["term-1"]);
    refuse = true;
    await server.runtime.dispatch(runScript, server.sessionId(), script as never);
    await settled();
    expect(server.session().ScriptError).toBe("no shell");
    await server.runtime.dispatch(selectThread, server.envId(), "other");
    await settled();
    expect(server.session().ScriptError).toBeUndefined();
  });
});

describe("work started by events", () => {
  it("a single-select pick moves to the next question after a beat, and answers on the last", async () => {
    const waits: Array<() => void> = [];
    const answers: IRespondRequest[] = [];
    const server = await connect(undefined, null, {
      delay: () => new Promise<void>((resolve) => waits.push(resolve)),
      respondRequest: (effect: IRespondRequest) => {
        answers.push(effect);
      },
    });
    await server.open();
    await server.sendThread(
      snapshotOf(
        {
          ...emptyProjection(),
          runtimeRequests: [
            {
              id: "r-1",
              kind: "user_input",
              status: "pending",
              responseCapability: { type: "live" },
            },
          ],
        } as never,
        1,
      ),
    );
    const option = (label: string) => ({ label, description: label });
    const questions = [
      { id: "one", header: "One", question: "First?", options: [option("a"), option("b")] },
      { id: "two", header: "Two", question: "Second?", options: [option("c")] },
    ] as unknown as IQuestion[];
    const choose = async (questionId: string, value: string) => {
      void server.runtime.dispatch(
        chooseQuestionOption,
        server.sessionId(),
        "r-1",
        questions,
        questionId,
        value,
      );
      await settled();
    };
    const wake = async () => {
      for (const resolve of waits.splice(0)) resolve();
      await settled();
    };
    const index = () => server.session().QuestionIndex["r-1"] ?? 0;

    await choose("one", "a");
    await choose("one", "b");
    expect(index()).toBe(0);
    await wake();
    expect(index()).toBe(1);

    await choose("two", "c");
    await wake();
    expect(answers.map((answer) => answer.Answers)).toEqual([{ one: "b", two: "c" }]);
  });

  it("expanding a command row opens its output, which leaving the thread closes and returning reopens", async () => {
    const server = await connect();
    await server.runtime.dispatch(selectThread, server.envId(), THREAD_ID);
    const outputs = () =>
      server.runtime
        .resources()
        .filter((row) => row.Key === "Command/Output")
        .map((row) => row.Params as unknown as { ThreadId: string; ItemId: string });
    const rows = () => server.session().CommandOutputs;

    await server.runtime.dispatch(toggleRowExpanded, server.sessionId(), "cmd-1", {
      ThreadId: "source",
      Fetch: "output",
    });
    await server.runtime.dispatch(toggleRowExpanded, server.sessionId(), "group-1");
    expect(outputs()).toMatchObject([{ ThreadId: "source", ItemId: "cmd-1" }]);
    expect(Object.keys(rows())).toEqual(["cmd-1"]);

    await server.runtime.dispatch(selectThread, server.envId(), "other");
    await settled();
    expect(outputs()).toEqual([]);
    await server.runtime.dispatch(selectThread, server.envId(), THREAD_ID);
    await settled();
    expect(outputs()).toMatchObject([{ ThreadId: "source", ItemId: "cmd-1" }]);

    await server.runtime.dispatch(toggleRowExpanded, server.sessionId(), "cmd-1");
    expect(outputs()).toEqual([]);
    expect(rows()).toEqual({});
  });

  it("expanding a tool row the wire left the output off fetches its item, and collapsing drops it", async () => {
    const asked: ITurnItemRequest[] = [];
    const full = { id: "tool-1", type: "dynamic_tool", output: { text: "found it" } };
    const server = await connect(undefined, null, {
      turnItem: (effect: ITurnItemRequest) => {
        asked.push(effect);
        if (effect.ItemId === "tool-3") throw serverFailure("offline");
        return effect.ItemId === "tool-1" ? full : null;
      },
    });
    await server.runtime.dispatch(selectThread, server.envId(), THREAD_ID);
    const details = () => server.session().ToolDetails;
    const expand = (id: string) =>
      server.runtime.dispatch(toggleRowExpanded, server.sessionId(), id, {
        ThreadId: "source",
        Fetch: "detail",
      });

    await expand("tool-1");
    await settled();
    expect(asked).toEqual([
      expect.objectContaining({ EnvironmentId: ENV, ThreadId: "source", ItemId: "tool-1" }),
    ]);
    expect(details()["tool-1"]).toMatchObject({ Item: full, Missing: false, Error: null });

    await expand("tool-2");
    await expand("tool-3");
    await settled();
    expect(details()["tool-2"]).toMatchObject({ Item: null, Missing: true });
    expect(details()["tool-3"]).toMatchObject({ Item: null, Error: "offline" });

    await server.runtime.dispatch(toggleRowExpanded, server.sessionId(), "tool-1");
    expect(Object.keys(details())).toEqual(["tool-2", "tool-3"]);
  });

  it("leaving the thread or covering it with a page closes the details popover", async () => {
    const server = await connect();
    await server.runtime.dispatch(selectThread, server.envId(), THREAD_ID);
    const popover = () => server.session().Panels.Details.Popover;
    await server.runtime.dispatch(toggleDetails, server.sessionId());
    expect(popover()).toBe(true);
    await server.runtime.dispatch(selectThread, server.envId(), "other");
    await settled();
    expect(popover()).toBe(false);

    await server.runtime.dispatch(selectThread, server.envId(), THREAD_ID);
    await server.runtime.dispatch(toggleDetails, server.sessionId());
    await server.runtime.dispatch(openView, server.envId(), { Kind: "settings", Page: "general" });
    await settled();
    expect(popover()).toBe(false);
  });

  it("lists the editors from the server config and keeps the one last opened with", async () => {
    const server = await connect();
    const listed = () => server.runtime.processSelector(editors, server.environment);
    expect(listed()).toEqual({ Available: [], Preferred: null });
    await server.sendConfig({
      ...configSnapshot([replayProvider()]),
      config: {
        ...configSnapshot([replayProvider()]).config,
        availableEditors: ["zed", "vscode"],
      },
    });
    expect(listed()).toEqual({
      Available: [
        { Id: "vscode", Label: "VS Code" },
        { Id: "zed", Label: "Zed" },
      ],
      Preferred: "vscode",
    });
    await server.runtime.dispatch(preferEditor, server.envId(), "zed");
    expect(listed().Preferred).toBe("zed");
    expect(server.device.Editor).toBe("zed");
  });

  it("takes Add project's folders and platform from the config it holds, and follows its settings", async () => {
    const server = await connect();
    const settings = () => server.runtime.processSelector(addProjectSettings, server.environment);
    const base = configSnapshot([replayProvider()]);
    await server.sendConfig({
      ...base,
      config: {
        ...base.config,
        settings: {
          ...base.config.settings,
          addProjectBaseDirectory: "~/code",
          ghqCloneLayout: true,
        },
        newProjectsRoot: "~/new",
        environment: { platform: { os: "windows" } },
      },
    });
    expect(settings()).toEqual({
      BaseDirectory: "~/code",
      GhqCloneLayout: true,
      NewProjectsRoot: "~/new",
      Os: "windows",
    });
    await server.sendConfig({
      version: 1,
      type: "settingsUpdated",
      payload: { settings: { addProjectBaseDirectory: "~/src", ghqCloneLayout: false } },
    });
    expect(settings()).toMatchObject({ BaseDirectory: "~/src", GhqCloneLayout: false });
  });

  it("reads the keybindings from the config stream, with no stream of their own, and warns of each reload's issues", async () => {
    const server = await connect();
    const bound = () => server.runtime.processSelector(keybindings, server.environment);
    const binding = (key: string) => ({ command: "sidebar.toggle", shortcut: { key } });
    const issue = { kind: "keybindings.malformed-config", message: "Unexpected token" };
    const snapshot = configSnapshot([replayProvider()]);
    await server.sendConfig({
      ...snapshot,
      config: {
        ...snapshot.config,
        keybindings: [binding("b")],
        issues: [issue],
        keybindingsConfigPath: "/home/keybindings.json",
        availableEditors: ["vscode"],
      },
    });
    expect(bound()).toEqual([binding("b")]);
    expect(server.device.KeybindingReports).toEqual([]);
    await server.sendConfig({
      version: 1,
      type: "keybindingsUpdated",
      payload: { keybindings: [binding("k")], issues: [issue] },
    });
    expect(bound()).toEqual([binding("k")]);
    expect(server.device.KeybindingReports).toEqual([[[issue], "/home/keybindings.json", true]]);
    const streams = server.runtime
      .resources()
      .filter((row) => row.Key.startsWith("Server/"))
      .map((row) => row.Key);
    expect(streams).toEqual(["Server/Config"]);
  });

  it("looks up related threads' titles once for each set the thread's lineage needs", async () => {
    const asked: string[][] = [];
    const server = await connect(undefined, null, {
      threadTitles: (effect: { ThreadIds: string[] }) => {
        asked.push(effect.ThreadIds);
        return { Titles: Object.fromEntries(effect.ThreadIds.map((id) => [id, `Title ${id}`])) };
      },
    });
    await server.open();
    const projection = emptyProjection();
    const forkOf = (parent: string) => ({
      ...projection.thread,
      lineage: { rootThreadId: parent, parentThreadId: parent, relationshipToParent: "fork" },
      forkedFrom: { type: "run", threadId: parent, runId: "run-1" },
    });
    await server.sendThread(snapshotOf({ ...projection, thread: forkOf("gone") } as never, 1));
    await settled();
    expect(asked).toEqual([["gone"]]);
    expect(server.thread().LineageTitles).toEqual({ Key: "gone", Titles: { gone: "Title gone" } });

    await server.sendThread({
      kind: "event",
      sequence: 2,
      event: event("message.updated", message("m-1", "run-1", "hi")),
    } as IWireThreadItem);
    await server.sendThread({
      kind: "event",
      sequence: 3,
      event: event("thread.metadata-updated", { ...forkOf("gone"), title: "Renamed" }),
    } as IWireThreadItem);
    await settled();
    expect(asked).toEqual([["gone"]]);

    await server.sendThread({
      kind: "event",
      sequence: 4,
      event: event("thread.metadata-updated", forkOf("elsewhere")),
    } as IWireThreadItem);
    await settled();
    expect(asked).toEqual([["gone"], ["elsewhere"]]);

    const shellSnapshot = (sequence: number, threads: unknown[]) =>
      ({
        kind: "snapshot",
        snapshot: { snapshotSequence: sequence, projects: [], threads, archivedThreads: [] },
      }) as unknown as IWireShellItem;
    await server.sendShell(shellSnapshot(1, [{ ...thread("kept"), title: "Kept" }]));
    await server.sendThread({
      kind: "event",
      sequence: 5,
      event: event("thread.metadata-updated", forkOf("kept")),
    } as IWireThreadItem);
    await settled();
    expect(asked).toHaveLength(2);
    await server.sendShell(shellSnapshot(2, []));
    await settled();
    expect(asked).toEqual([["gone"], ["elsewhere"], ["kept"]]);
  });

  it("asks for each project's favicon as its row arrives or its favicon source changes", async () => {
    const server = await connect();
    const project = (extra: Record<string, unknown> = {}) => ({
      id: "p-1",
      title: "One",
      workspaceRoot: "/root",
      ...extra,
    });
    const snapshot = (sequence: number, projects: unknown[]) =>
      ({
        kind: "snapshot",
        snapshot: { snapshotSequence: sequence, projects, threads: [], archivedThreads: [] },
      }) as unknown as IWireShellItem;
    const asked = () => server.device.Favicons.map((target) => [target.Cwd, target.FaviconPath]);

    await server.sendShell(
      snapshot(1, [
        project(),
        project({ id: "p-2", workspaceRoot: "/emoji", projectIcon: { kind: "emoji", emoji: "x" } }),
      ]),
    );
    expect(asked()).toEqual([["/root", null]]);
    await server.sendShell(snapshot(2, [project({ title: "Renamed" })]));
    expect(asked()).toEqual([["/root", null]]);
    await server.sendShell({
      kind: "project.updated",
      sequence: 3,
      project: project({ faviconPath: "icon.png" }),
    } as unknown as IWireShellItem);
    expect(asked()).toEqual([
      ["/root", null],
      ["/root", "icon.png"],
    ]);
  });
});

describe("reconnect", () => {
  it("keeps the data on screen, skips what it has, and applies what it missed", async () => {
    const server = await connect();
    await server.open();
    await server.sendThread(snapshotOf(longThread(3), 5));
    await server.sendThread({ kind: "synchronized" });
    const node = server.thread();
    const resubscribed = { Type: "Thread/Stream", Resubscribing: true } as const;
    await server.runtime.dispatch(ThreadReceiver.handle, server.openId(), resubscribed, {
      publisher: { Id: server.openId() },
    });
    const synchronized = () => server.runtime.processSelector(threadSynchronized, server.thread);
    expect(synchronized()).toBe(false);
    expect(server.thread().Timeline).toEqual(["item-0", "item-1", "item-2"]);

    await server.sendThread({
      kind: "event",
      sequence: 5,
      event: event("turn-item.updated", commandItem("stale", "run-0", 9)),
    } as IWireThreadItem);
    await server.sendThread({
      kind: "event",
      sequence: 6,
      event: event("turn-item.updated", commandItem("missed", "run-0", 9)),
    } as IWireThreadItem);
    await server.sendThread({ kind: "synchronized" });
    expect(server.thread()).toBe(node);
    expect(server.thread().Timeline).toEqual(["item-0", "item-1", "item-2", "missed"]);
    expect(server.thread().LastSequence).toBe(6);
    expect(synchronized()).toBe(true);
    const row = server.runtime.resources().find((resource) => resource.Key === "Thread/Stream");
    expect(row?.ResumeFrom).toBe("LastSequence");
  });
});

function settingsServer() {
  const calls: Array<{ Type: string; [key: string]: unknown }> = [];
  let settings = { favorites: [], sidebarAutoSettleAfterDays: 7 } as Record<string, unknown>;
  let client = { toolCallVisibility: "showAll" } as Record<string, unknown>;
  const commands = {
    refreshProviders: (effect: { Automatic: boolean }) => {
      calls.push({ Type: "refreshProviders", Automatic: effect.Automatic });
    },
    updateServerSettings: (effect: { Patch: object; InstanceMutation: unknown }) => {
      calls.push({
        Type: "updateServerSettings",
        Patch: effect.Patch,
        Mutation: effect.InstanceMutation,
      });
      settings = { ...settings, ...effect.Patch };
      return settings;
    },
    storedClientSettings: () => client,
    storeClientSettings: (effect: { Settings: Record<string, unknown> }) => {
      calls.push({ Type: "storeClientSettings", Settings: effect.Settings });
      client = effect.Settings;
    },
    threadCommand: (effect: { Command: IThreadCommand }) => {
      calls.push({ Type: "threadCommand", Command: effect.Command });
    },
  };
  return {
    calls,
    commands,
    snapshot: () => ({
      version: 1,
      type: "snapshot",
      config: { settings: { ...settings }, providers: [], keybindings: [], issues: [] },
    }),
  };
}

const claude = (left: number) => ({
  instanceId: "claudeAgent",
  driver: "claudeAgent",
  usageLimits: { checkedAt: "2026-11-17T00:00:00.000Z", windows: [{ usedPercent: 100 - left }] },
});

describe("settings and usage", () => {
  it("open over the thread, keep the address, load both stores, and close on a thread pick", async () => {
    const fake = settingsServer();
    const server = await connect(undefined, null, fake.commands);
    await server.sendConfig(fake.snapshot());
    await server.runtime.dispatch(openView, server.envId(), {
      Kind: "settings",
      Page: "snap-shot",
    });
    await settled();
    expect(server.environment().Local.View).toEqual({ Kind: "settings", Page: "general" });
    expect(server.address.view).toEqual({ Kind: "settings", Page: "general" });
    expect(server.environment().Replica.Config?.settings.sidebarAutoSettleAfterDays).toBe(7);
    expect(server.environment().Local.ClientSettings?.toolCallVisibility).toBe("showAll");
    await server.runtime.dispatch(selectThread, server.envId(), THREAD_ID);
    expect(server.environment().Local.View).toBeNull();
    expect(server.address.view).toBeNull();
    expect(server.address.thread).toBe(THREAD_ID);
  });

  it("reopen the page in the address on load", async () => {
    const fake = settingsServer();
    const server = await connect(undefined, null, {
      ...fake.commands,
      address: () => ({
        Thread: null,
        NewThreadIn: null,
        View: { Kind: "settings", Page: "providers" },
      }),
    });
    await settled();
    expect(server.environment().Local.View).toEqual({ Kind: "settings", Page: "providers" });
    expect(server.environment().Local.ClientSettings?.toolCallVisibility).toBe("showAll");
  });

  it("send a server row's patch and hold what the server returns, and merge a client row into the whole stored object", async () => {
    const fake = settingsServer();
    const server = await connect(undefined, null, fake.commands);
    await server.sendConfig(fake.snapshot());
    await server.runtime.dispatch(openView, server.envId(), { Kind: "settings", Page: "threads" });
    await settled();
    await server.runtime.dispatch(writeSetting, server.envId(), {
      Store: "server",
      Patch: { sidebarAutoSettleAfterDays: null },
    });
    expect(fake.calls.filter((call) => call.Type === "updateServerSettings")).toEqual([
      { Type: "updateServerSettings", Patch: { sidebarAutoSettleAfterDays: null }, Mutation: null },
    ]);
    expect(server.environment().Replica.Config?.settings.sidebarAutoSettleAfterDays).toBeNull();
    await server.runtime.dispatch(writeSetting, server.envId(), {
      Store: "client",
      Patch: { timestampFormat: "24-hour" },
    });
    expect(fake.calls.at(-1)).toEqual({
      Type: "storeClientSettings",
      Settings: { toolCallVisibility: "showAll", timestampFormat: "24-hour" },
    });
    expect(server.environment().Local.ClientSettings?.timestampFormat).toBe("24-hour");
  });

  it("follow the config stream in the composer's provider list and favorites", async () => {
    const server = await connect();
    const offered = () =>
      server.environment().Replica.Providers.map((provider) => ({
        Id: provider.InstanceId,
        Models: provider.Models.map((model) => model.Slug),
      }));
    const codex = (extra: Record<string, unknown> = {}) =>
      wireProvider(
        "codex",
        [
          { slug: "gpt-5.4", name: "GPT-5.4", isDefault: true },
          { slug: "gpt-5.5", name: "GPT-5.5" },
        ],
        extra,
      );
    await server.sendConfig({
      version: 1,
      type: "providerStatuses",
      payload: { providers: [replayProvider(), codex()] },
    });
    expect(offered()).toEqual([
      { Id: "devReplay", Models: ["showcase"] },
      { Id: "codex", Models: ["gpt-5.4", "gpt-5.5"] },
    ]);
    const held = server.environment().Replica.Providers;
    await server.sendConfig({
      version: 1,
      type: "providerStatuses",
      payload: { providers: [replayProvider({ checkedAt: "2026-11-18T00:00:00.000Z" }), codex()] },
    });
    expect(server.environment().Replica.Providers).toBe(held);
    await server.sendConfig({
      version: 1,
      type: "providerStatuses",
      payload: {
        providers: [replayProvider({ availability: "unavailable" }), codex({ enabled: true })],
      },
    });
    expect(offered()).toEqual([{ Id: "codex", Models: ["gpt-5.4", "gpt-5.5"] }]);
    await server.sendConfig({
      version: 1,
      type: "settingsUpdated",
      payload: {
        settings: {
          favorites: [{ provider: "codex", model: "gpt-5.5" }],
          providerModelPreferences: { codex: { hiddenModels: ["gpt-5.4"], modelOrder: [] } },
        },
      },
    });
    expect(offered()).toEqual([{ Id: "codex", Models: ["gpt-5.5"] }]);
    expect(server.environment().Replica.ModelFavorites).toEqual([
      { Provider: "codex", Model: "gpt-5.5" },
    ]);
  });

  it("take a settings write's reply into the composer's provider list without waiting for the stream", async () => {
    const fake = settingsServer();
    const server = await connect(undefined, null, fake.commands);
    await server.sendConfig(configSnapshot([replayProvider()]));
    await server.runtime.dispatch(updateServerSettings, server.envId(), {
      providerModelPreferences: { devReplay: { hiddenModels: ["showcase"], modelOrder: [] } },
    } as never);
    expect(server.environment().Replica.Providers[0]?.Models).toEqual([]);
  });

  it("follow the config stream, so a provider push replaces the limits held since the snapshot", async () => {
    const fake = settingsServer();
    const server = await connect(undefined, null, fake.commands);
    const usedPercent = () =>
      (server.environment().Replica.Config?.providers[0] as ReturnType<typeof claude> | undefined)
        ?.usageLimits.windows[0]?.usedPercent;
    const snapshot = fake.snapshot();
    await server.sendConfig({
      ...snapshot,
      config: { ...snapshot.config, providers: [claude(82)] },
    });
    expect(usedPercent()).toBe(18);
    await server.sendConfig({
      version: 1,
      type: "providerStatuses",
      payload: { providers: [claude(61)] },
    });
    expect(usedPercent()).toBe(39);
    await server.sendConfig({
      version: 1,
      type: "settingsUpdated",
      payload: { settings: { favorites: [], sidebarAutoSettleAfterDays: 3 } },
    });
    expect(server.environment().Replica.Config?.settings.sidebarAutoSettleAfterDays).toBe(3);
    expect(usedPercent()).toBe(39);
  });

  it("holds the usage-limit hubs the stream reports, through a reconnect's snapshot, until it reports none", async () => {
    const fake = settingsServer();
    const server = await connect(undefined, null, fake.commands);
    const hub = {
      id: "hub-1",
      kind: "cliproxy",
      label: "Hub",
      checkedAt: "2026-11-17T00:00:00.000Z",
      accounts: [],
    };
    const held = () => server.environment().Replica.Config?.usageLimitSources;
    await server.sendConfig({
      version: 1,
      type: "usageLimitSourcesUpdated",
      payload: { sources: [hub] },
    });
    expect(held()).toEqual([hub]);
    await server.sendConfig(fake.snapshot());
    expect(held()).toEqual([hub]);
    await server.sendConfig({
      version: 1,
      type: "usageLimitSourcesUpdated",
      payload: { sources: [] },
    });
    expect(held()).toBeUndefined();
  });

  it("the header's limits refresh asks the server to re-probe, and leaves the result to the stream", async () => {
    const fake = settingsServer();
    const server = await connect(undefined, null, fake.commands);
    await server.runtime.dispatch(autoRefreshLimits, server.envId());
    expect(fake.calls.filter((call) => call.Type === "refreshProviders")).toEqual([
      { Type: "refreshProviders", Automatic: true },
    ]);
    expect(fake.calls.some((call) => call.Type === "serverConfig")).toBe(false);
  });
});

describe("rewinding and forking", () => {
  const INSTANCE = "devReplay";
  const ATTACHMENT = { type: "image", id: "a-1", name: "shot.png", mimeType: "image/png" };

  const userTurn = (ordinal: number, text: string, attachments: unknown[] = []) =>
    ({
      ...commandItem(`user-${ordinal}`, `run-${ordinal}`, ordinal * 2),
      type: "user_message",
      messageId: `message-user-${ordinal}`,
      text,
      inputIntent: "turn_start",
      attachments,
    }) as unknown as IWireTurnItem;

  const providerThread = (lastRunOrdinal: number) => ({
    id: "pt-1",
    driver: "acp",
    providerInstanceId: INSTANCE,
    providerSessionId: "session-1",
    appThreadId: THREAD_ID,
    ownerNodeId: null,
    status: "idle",
    firstRunOrdinal: 1,
    lastRunOrdinal,
    handoffIds: [],
    forkedFrom: null,
  });

  function twoTurns(): IWireProjection {
    const projection = emptyProjection();
    projection.thread = {
      ...projection.thread,
      modelSelection: { instanceId: INSTANCE, model: "showcase" },
      activeProviderThreadId: "pt-1",
    } as never;
    const items: IWireTurnItem[] = [];
    for (const ordinal of [1, 2]) {
      projection.runs.push({
        ...run(`run-${ordinal}`, ordinal),
        activeAttemptId: `at-${ordinal}`,
      } as never);
      projection.attempts.push({ id: `at-${ordinal}`, runId: `run-${ordinal}` } as never);
      projection.providerTurns.push({
        id: `turn-${ordinal}`,
        runAttemptId: `at-${ordinal}`,
        ordinal: 1,
        providerThreadId: "pt-1",
      } as never);
      projection.checkpoints.push({
        id: `cp-${ordinal}`,
        scopeId: "scope-1",
        runId: `run-${ordinal}`,
        appRunOrdinal: ordinal,
        ordinalWithinScope: ordinal,
        status: "ready",
        files: [],
      } as never);
      items.push(
        userTurn(ordinal, `prompt ${ordinal}`, ordinal === 2 ? [ATTACHMENT] : []),
        assistantItem(`assistant-${ordinal}`, `run-${ordinal}`, ordinal * 2 + 1, "done"),
      );
    }
    projection.checkpoints.unshift({
      id: "cp-start",
      scopeId: "scope-1",
      runId: null,
      appRunOrdinal: null,
      ordinalWithinScope: 0,
      status: "ready",
      files: [],
    } as never);
    projection.providerThreads.push(providerThread(2) as never);
    projection.turnItems = items;
    projection.visibleTurnItems = items.map((item, index) => localRow(item, index));
    return projection;
  }

  async function rewindServer(
    rewind?: (effect: IRewind) => unknown,
    commands: Record<string, (effect: never) => unknown> = {},
  ) {
    const rewinds: IRewind[] = [];
    const forks: IForkThread[] = [];
    const recalled: string[][] = [];
    const removed: string[] = [];
    const server = await connect(
      undefined,
      null,
      {
        rewind: (effect: IRewind) => {
          rewinds.push(effect);
          return rewind?.(effect);
        },
        forkThread: (effect: IForkThread) => void forks.push(effect),
        ...commands,
      },
      undefined,
      {
        methods: {
          "Composer/Files": {
            recall: (_ctx: unknown, attachments: Array<{ name: string }>) => {
              recalled.push(attachments.map((file) => file.name));
              return attachments.map((file, index) => ({
                Id: `recalled-${index}`,
                Kind: "image",
                Name: file.name,
                MimeType: "image/png",
                SizeBytes: 4,
                PastedText: false,
                PreviewUrl: null,
              }));
            },
            remove: (_ctx: unknown, id: string) => void removed.push(id),
            stored: (_ctx: unknown, ids: string[]): IStoredAttachment[] =>
              ids.map((id) => ({
                Kind: "image",
                Name: id,
                MimeType: "image/png",
                SizeBytes: 4,
                PastedText: false,
                AttachmentId: `uploaded-${id}`,
              })),
          },
        },
      },
    );
    await server.open();
    await server.sendThread(snapshotOf(twoTurns(), 1));
    let sequence = 1;
    // An effect stub can't wait for settled(), which waits for that effect.
    const deliver = async (type: IWireThreadEvent["type"], payload: unknown, settle = true) => {
      sequence += 1;
      await server.sendThread({ kind: "event", sequence, event: event(type, payload) } as never);
      if (settle) await settled();
    };
    const thread = () => server.thread().Thread!;
    const confirm = () => server.runtime.processSelector(rewindConfirm, () => server.session());
    const editFrom = (itemId: string, turnCount: number) =>
      server.runtime.dispatch(editFromHere, server.sessionId(), itemId, turnCount);
    const choose = async (choice?: IRewindChoice) => {
      const entry = confirm();
      expect(entry).not.toBeNull();
      await server.runtime.dispatch(chooseRewind, server.sessionId(), entry!.Id as never, choice);
      await settled();
    };
    const land = async (commandId: string, settle = true) => {
      await deliver(
        "thread.metadata-updated",
        { ...thread(), rollbackRequestId: commandId },
        settle,
      );
      await deliver("run.updated", run("run-2", 2, "rolled_back"), settle);
      await deliver("provider-thread.updated", providerThread(1), settle);
    };
    return {
      server,
      rewinds,
      forks,
      recalled,
      removed,
      deliver,
      thread,
      confirm,
      editFrom,
      choose,
      land,
    };
  }

  it("offers each settled turn-start message the checkpoint before it", async () => {
    const { server, deliver } = await rewindServer();
    const targets = () => server.runtime.processSelector(revertTargets, () => server.session());
    expect(targets()).toEqual({ "user-1": 0, "user-2": 1 });
    await deliver("run.created", { ...run("run-3", 3, "running"), completedAt: null });
    expect(targets()).toEqual({ "user-1": 0, "user-2": 1 });
    expect(server.runtime.processSelector(threadWorking, () => server.session())).toBe(true);
  });

  it("edit from here rolls back, then returns the message and its files to the composer", async () => {
    const rig = await rewindServer();
    const { server } = rig;
    await server.runtime.dispatch(setDraft, server.sessionId(), "half written");
    const editing = rig.editFrom("user-2", 1);
    await settled();
    expect(rig.confirm()?.Request).toEqual({
      Path: "Rewind/Confirm",
      TurnCount: 1,
      FileRestore: null,
    });
    await rig.choose("keepChanges");
    expect(rig.rewinds).toMatchObject([
      {
        EnvironmentId: ENV,
        ThreadId: THREAD_ID,
        TurnCount: 1,
        RestoreFiles: false,
        Checkpoint: { Id: "cp-1", ScopeId: "scope-1" },
      },
    ]);
    expect(rig.recalled).toEqual([["shot.png"]]);
    expect(inFlightOf(server.runtime, editFromHere, () => server.session())).toBe(true);
    expect(server.session().Draft).toBe("half written");

    await rig.land(rig.rewinds[0]!.CommandId);
    expect(await editing).toBe(true);
    expect(server.session().Draft).toBe("half written\n\nprompt 2");
    expect(server.session().Attachments.map((file) => file.Name)).toEqual(["shot.png"]);
    expect(server.stored.Drafts.get(THREAD_ID)?.Text).toBe("half written\n\nprompt 2");
    expect(server.stored.Files.get(THREAD_ID)?.map((file) => file.Name)).toEqual(["recalled-0"]);
    expect(inFlightOf(server.runtime, editFromHere, () => server.session())).toBe(false);
    expect(server.session().RewindError).toBeUndefined();
  });

  it("a rollback the stream delivers before the command returns still lands", async () => {
    let rig!: Awaited<ReturnType<typeof rewindServer>>;
    rig = await rewindServer((effect) => rig.land(effect.CommandId, false));
    const editing = rig.editFrom("user-2", 1);
    await settled();
    await rig.choose("keepChanges");
    expect(await editing).toBe(true);
    expect(rig.server.session().Draft).toBe("prompt 2");
  });

  it("a refused rollback keeps the draft and drops the recalled files", async () => {
    const rig = await rewindServer();
    const { server } = rig;
    const editing = rig.editFrom("user-2", 1);
    await settled();
    await rig.choose("keepChanges");
    const commandId = rig.rewinds[0]!.CommandId;
    await rig.deliver("thread.metadata-updated", {
      ...rig.thread(),
      rollbackRequestId: commandId,
      rollbackFailure: { requestId: commandId, message: "The provider refused." },
    });
    expect(await editing).toBe(false);
    expect(server.session()).toMatchObject({ Draft: "", RewindError: "The provider refused." });
    expect(server.session().Attachments).toEqual([]);
    expect(rig.removed).toEqual(["recalled-0"]);
  });

  it("cancelling sends nothing, and a running turn or an unsupported provider refuses first", async () => {
    const rig = await rewindServer();
    const { server } = rig;
    const cancelled = rig.editFrom("user-1", 0);
    await settled();
    await rig.choose();
    expect(await cancelled).toBe(false);
    expect(rig.rewinds).toEqual([]);

    await rig.deliver("run.created", { ...run("run-3", 3, "running"), completedAt: null });
    expect(await rig.editFrom("user-1", 0)).toBe(false);
    expect(rig.confirm()).toBeNull();
    expect(server.session().RewindError).toBe(
      "Interrupt the current turn before reverting checkpoints.",
    );

    const unsupported = await rewindServer();
    await unsupported.server.sendConfig(
      configSnapshot([replayProvider({ supportsConversationRollback: false })]),
    );
    const session = () => unsupported.server.session();
    expect(unsupported.server.runtime.processSelector(revertTargets, session)).toEqual({});
    expect(await unsupported.editFrom("user-1", 0)).toBe(false);
    expect(session().RewindError).toBe(
      "This provider does not support reverting conversation history. Start a new thread instead.",
    );
  });

  it("offers to revert only the repositories of a task folder whose project folder has no snapshot", async () => {
    const asked: string[] = [];
    const rig = await rewindServer(undefined, {
      taskFolder: (effect: { WorktreePath: string }) => {
        asked.push(effect.WorktreePath);
        return false;
      },
    });
    await rig.deliver("thread.metadata-updated", {
      ...rig.thread(),
      worktreePath: "C:/tasks/one/project",
    });
    await rig.deliver("checkpoint.captured", {
      id: "cp-1",
      scopeId: "scope-1",
      runId: "run-1",
      appRunOrdinal: 1,
      ordinalWithinScope: 1,
      status: "missing",
      files: [],
    });
    await rig.deliver("checkpoint-scope.created", {
      id: "scope-repo",
      parentScopeId: "scope-1",
      cwd: "C:/tasks/one/repo",
      repositoryPath: "C:/work/repo",
    });
    await rig.deliver("checkpoint.captured", {
      id: "cp-repo-1",
      scopeId: "scope-repo",
      runId: "run-1",
      appRunOrdinal: null,
      ordinalWithinScope: 1,
      status: "ready",
      files: [],
    });
    const editing = rig.editFrom("user-2", 1);
    await settled();
    expect(asked).toEqual(["C:/tasks/one/project"]);
    expect(rig.confirm()?.Request).toMatchObject({ FileRestore: "repositories" });
    await rig.choose("restoreFiles");
    expect(rig.rewinds).toMatchObject([
      { RestoreFiles: true, Checkpoint: { Id: "cp-1", ScopeId: "scope-1" } },
    ]);
    await rig.land(rig.rewinds[0]!.CommandId);
    expect(await editing).toBe(true);
  });

  it("fork from a response creates the fork and opens it", async () => {
    const rig = await rewindServer();
    const { server } = rig;
    await server.runtime.dispatch(forkFromRun, server.sessionId(), THREAD_ID, "run-1");
    await settled();
    expect(rig.forks).toMatchObject([
      {
        EnvironmentId: ENV,
        SourceThreadId: THREAD_ID,
        RunId: "run-1",
        Title: "Fixture fork",
      },
    ]);
    expect(server.environment().Local.SelectedThreadId).toBe(rig.forks[0]!.TargetThreadId);
    expect(server.environment().Replica.OpenThreads[rig.forks[0]!.TargetThreadId]).toBeDefined();
  });

  it("merge back sends the latest finished run to the parent and opens it, keeping a failure", async () => {
    const merges: IMergeBack[] = [];
    let fail = true;
    const { server } = await rewindServer(undefined, {
      mergeBack: (effect: IMergeBack) => {
        merges.push(effect);
        if (fail) throw serverFailure("No checkpoint yet");
      },
    });
    await server.runtime.dispatch(mergeBack, server.sessionId(), "parent-1");
    await settled();
    expect(server.takeToasts()).toEqual([
      { Kind: "error", Title: "Could not merge back", Description: "No checkpoint yet" },
    ]);
    expect(server.environment().Local.SelectedThreadId).not.toBe("parent-1");

    fail = false;
    await server.runtime.dispatch(mergeBack, server.sessionId(), "parent-1");
    await settled();
    expect(merges.at(-1)).toMatchObject({
      EnvironmentId: ENV,
      SourceThreadId: THREAD_ID,
      TargetThreadId: "parent-1",
      RunId: "run-2",
    });
    expect(server.takeToasts()).toEqual([]);
    expect(server.environment().Local.SelectedThreadId).toBe("parent-1");
  });
});

describe("dictation", () => {
  const READY = {
    supported: true,
    state: "ready",
    modelId: "parakeet",
    model: "Parakeet",
    size: 1,
    supportsStreaming: false,
    supportsTranslation: false,
    acceleration: "auto",
    benchmarkTier: "cpu",
    modelUnloadTimeout: "never",
    gpuDevices: [],
  };
  const EMPTY = { Text: "", Start: 0, End: 0 };
  const voiceModel = (id: string, state: string, active = false) => ({
    id,
    name: id,
    description: "",
    size: 100,
    state,
    active,
    recommended: false,
  });
  const IN_USE = [voiceModel("parakeet", "installed", true)];

  async function dictating(
    status: object = READY,
    commands: Record<string, (effect: never) => unknown> = {},
    preferences: IPreferences = storedPreferences,
  ) {
    const calls: { Method: string; Args: unknown[] }[] = [];
    const record =
      (method: string) =>
      (_ctx: unknown, ...args: unknown[]) =>
        void calls.push({ Method: method, Args: args });
    const server = await connect(
      undefined,
      null,
      {
        voiceStatus: () => status,
        voiceModels: () => IN_USE,
        storedClientSettings: () => copy(DEFAULT_CLIENT_SETTINGS),
        ...commands,
      },
      undefined,
      {
        methods: {
          "Voice/Dictation": {
            start: record("start"),
            stop: record("stop"),
            cancel: record("cancel"),
          },
        },
      },
      preferences,
    );
    await server.open();
    const voice = () => server.environment().Local.Dictation;
    const voiceId = () => voice().$Id;
    const state = () => server.runtime.processSelector(recording, voice) as IRecording;
    const deliver = (message: object) =>
      server.runtime.dispatch(
        DictationReceiver.handle,
        voiceId(),
        { Type: "Voice/Dictation", ...message } as never,
        { publisher: { Id: voiceId() } },
      );
    const phase = (Phase: string, Error: string | null = null) =>
      deliver({ Kind: "state", ThreadId: THREAD_ID, Phase, Error, ErrorAction: null });
    const methods = () => calls.map((call) => call.Method);
    return { server, calls, methods, state, deliver, phase, voice, voiceId };
  }

  it("reads the destination's status, then records the draft with the device's options", async () => {
    const { server, calls, state, phase } = await dictating();
    await server.runtime.dispatch(setDraft, server.sessionId(), "Fix the");
    await server.runtime.dispatch(startDictation, server.envId(), THREAD_ID, {
      Text: "Fix the",
      Start: 7,
      End: 7,
    });
    expect(calls).toEqual([
      {
        Method: "start",
        Args: [
          {
            ThreadId: THREAD_ID,
            Draft: { Text: "Fix the", Start: 7, End: 7 },
            Options: expect.objectContaining({ speechLanguage: "auto" }),
            Streaming: true,
          },
        ],
      },
    ]);
    expect(state()).toMatchObject({ ThreadId: THREAD_ID, Phase: "preparing" });
    server.device.Now = 5_000;
    await phase("recording");
    expect(state()).toMatchObject({ Phase: "recording", StartedAt: 5_000 });
    await phase("transcribing");
    expect(state().StartedAt).toBeNull();
  });

  it("a missing model points to Voice settings instead of recording", async () => {
    const { server, methods, state } = await dictating(READY, {
      voiceModels: () => [voiceModel("parakeet", "downloadable")],
    });
    await server.runtime.dispatch(startDictation, server.envId(), THREAD_ID, EMPTY);
    expect(methods()).toEqual([]);
    expect(state()).toMatchObject({
      Phase: "error",
      Error: MISSING_MODEL,
      ErrorAction: "settings",
    });
  });

  it("checks for a model in the list Voice settings shows, and records once one is put in use", async () => {
    let catalog = [voiceModel("parakeet", "installed")];
    const { server, methods, state, voice, voiceId } = await dictating(READY, {
      voiceModels: () => catalog,
      voiceModelCommand: () => {
        catalog = [voiceModel("parakeet", "installed", true)];
        return { Models: catalog, Cancelled: false };
      },
    });
    await server.runtime.dispatch(startDictation, server.envId(), THREAD_ID, EMPTY);
    expect(state().Error).toBe(MISSING_MODEL);
    expect(voice().Models).toEqual([voiceModel("parakeet", "installed")]);

    await server.runtime.dispatch(selectModel, voiceId(), "parakeet");
    expect(voice().Models).toEqual(catalog);
    await server.runtime.dispatch(startDictation, server.envId(), THREAD_ID, EMPTY);
    expect(methods()).toEqual(["start"]);
  });

  it("keeps polling a download's progress after Voice settings closes", async () => {
    let catalog: object[] = [voiceModel("parakeet", "downloadable")];
    const { server, voice, voiceId } = await dictating(READY, {
      voiceModels: () => catalog,
      voiceModelCommand: () => new Promise(() => {}),
    });
    await server.runtime.dispatch(openView, server.envId(), { Kind: "settings", Page: "voice" });
    await settled();
    expect(voice().Models).toEqual(catalog);
    void server.runtime.dispatch(downloadModel, voiceId(), "parakeet");
    await settled();
    await server.runtime.dispatch(openView, server.envId(), null);
    expect(server.runtime.timers(voiceId())).toContainEqual(
      expect.objectContaining({ Key: "Voice/Poll", IntervalMs: POLL_MS }),
    );
    catalog = [{ ...voiceModel("parakeet", "downloading"), downloaded: 40 }];
    await server.runtime.dispatch(
      VoiceModelsReceiver.handle,
      voiceId(),
      { Type: "Voice/Poll" },
      { publisher: { Id: voiceId() } },
    );
    expect(voice().Models).toEqual(catalog);
  });

  it("an unchosen destination opens Voice settings, and turning voice off cancels", async () => {
    const { server, methods, state, phase } = await dictating(
      READY,
      {},
      {
        ...storedPreferences,
        VoiceDestination: null,
      },
    );
    await server.runtime.dispatch(startDictation, server.envId(), THREAD_ID, EMPTY);
    expect(server.environment().Local.View).toEqual({ Kind: "settings", Page: "voice" });
    expect(methods()).toEqual([]);

    await server.runtime.dispatch(setVoiceDestination, server.envId(), "server");
    await server.runtime.dispatch(startDictation, server.envId(), THREAD_ID, EMPTY);
    await phase("recording");
    await server.runtime.dispatch(setVoiceDestination, server.envId(), "off");
    expect(methods()).toEqual(["start", "cancel"]);
    expect(state().Phase).toBe("idle");
    expect(server.device.Preferences.VoiceDestination).toBe("off");
  });

  it("keeps recording into its own thread while another is selected", async () => {
    const { server, methods, state, deliver, phase } = await dictating();
    await server.runtime.dispatch(setDraft, server.sessionId(), "Fix the");
    await server.runtime.dispatch(startDictation, server.envId(), THREAD_ID, {
      Text: "Fix the",
      Start: 7,
      End: 7,
    });
    await phase("recording");
    await server.runtime.dispatch(selectThread, server.envId(), "thread-2");
    await server.runtime.dispatch(setDraft, server.sessionId("thread-2"), "elsewhere");
    await server.runtime.dispatch(startDictation, server.envId(), "thread-2", {
      Text: "elsewhere",
      Start: 9,
      End: 9,
    });
    expect(methods()).toEqual(["start"]);
    expect(state()).toMatchObject({ ThreadId: THREAD_ID, Phase: "recording" });

    await deliver({ Kind: "commit", ThreadId: THREAD_ID, Before: "Fix the", Text: "Fix the bug" });
    await phase("idle");
    await settled();
    expect(server.session().Draft).toBe("Fix the bug");
    expect(server.stored.Drafts.get(THREAD_ID)).toMatchObject({ Text: "Fix the bug" });
    expect(server.session("thread-2").Draft).toBe("elsewhere");
    expect(state()).toMatchObject({ ThreadId: null, Phase: "idle" });
  });

  it("refuses a transcript whose draft changed, and keeps saying so", async () => {
    const { server, state, deliver, phase } = await dictating();
    await server.runtime.dispatch(startDictation, server.envId(), THREAD_ID, EMPTY);
    await phase("recording");
    await phase("transcribing");
    await server.runtime.dispatch(setDraft, server.sessionId(), "edited");
    await deliver({ Kind: "commit", ThreadId: THREAD_ID, Before: "", Text: "hello" });
    await phase("idle");
    await settled();
    expect(server.session().Draft).toBe("edited");
    expect(state()).toMatchObject({ Phase: "error", Error: STALE_DRAFT, ErrorAction: "retry" });
  });

  it("refuses a transcript when a keystroke queued on the session lands before it", async () => {
    const wait = defineEffect<{ Type: "Test/Wait" } & IEffect, void>("Test/Wait");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { server, state, deliver, phase } = await dictating(READY, { "Test/Wait": () => gate });
    function* holdSession(_draft: IThreadSession): IActionGenerator {
      yield* wait();
    }
    await server.runtime.dispatch(startDictation, server.envId(), THREAD_ID, EMPTY);
    await phase("recording");
    await phase("transcribing");
    const holding = server.runtime.dispatch(holdSession, server.sessionId());
    const typing = server.runtime.dispatch(setDraft, server.sessionId(), "typed");
    await deliver({ Kind: "commit", ThreadId: THREAD_ID, Before: "", Text: "spoken" });
    await phase("idle");
    release();
    await holding;
    await typing;
    await settled();
    expect(server.session().Draft).toBe("typed");
    expect(state()).toMatchObject({ Phase: "error", Error: STALE_DRAFT });
  });

  it("a send while recording stops it and sends once the transcript is in", async () => {
    const sent: IStartTurn[] = [];
    const { server, methods, deliver, phase, voiceId } = await dictating(READY, {
      startTurn: (effect: IStartTurn) => void sent.push(effect),
    });
    await server.runtime.dispatch(startDictation, server.envId(), THREAD_ID, EMPTY);
    await phase("recording");
    await server.runtime.dispatch(sendAfterDictation, voiceId(), THREAD_ID, "auto");
    expect(methods()).toEqual(["start", "stop"]);
    expect(sent).toEqual([]);
    await phase("transcribing");
    await deliver({ Kind: "commit", ThreadId: THREAD_ID, Before: "", Text: "ship it" });
    await phase("idle");
    await settled();
    expect(sent.map((turn) => turn.Text)).toEqual(["ship it"]);
    expect(server.session().Draft).toBe("");
  });

  it("a failed transcript forgets the queued send, and cancel ends a recording", async () => {
    const sent: IStartTurn[] = [];
    const { server, methods, state, phase, voiceId } = await dictating(READY, {
      startTurn: (effect: IStartTurn) => void sent.push(effect),
    });
    await server.runtime.dispatch(startDictation, server.envId(), THREAD_ID, EMPTY);
    await phase("recording");
    await server.runtime.dispatch(sendAfterDictation, voiceId(), THREAD_ID, "auto");
    await phase("error", "No speech was detected.");
    expect(state()).toMatchObject({ Phase: "error", SubmitMode: null });
    await server.runtime.dispatch(startDictation, server.envId(), THREAD_ID, EMPTY);
    await phase("recording");
    await server.runtime.dispatch(cancelDictation, voiceId());
    expect(state().Phase).toBe("idle");
    expect(methods()).toEqual(["start", "stop", "start", "cancel"]);
    expect(sent).toEqual([]);
  });

  it("deleting the recording's thread cancels it", async () => {
    const { server, methods, phase } = await dictating(READY, { threadCommand: () => undefined });
    await server.runtime.dispatch(startDictation, server.envId(), THREAD_ID, EMPTY);
    await phase("recording");
    await server.runtime.dispatch(threadCommand, server.envId(), THREAD_ID, { Kind: "delete" });
    expect(methods()).toEqual(["start", "cancel"]);
  });
});

describe("client activity", () => {
  async function reporting(commands: Record<string, (effect: never) => unknown> = {}) {
    const reports: IReportActivity[] = [];
    const server = await connect(undefined, null, {
      reportActivity: (effect: IReportActivity) => void reports.push(copy(effect)),
      ...commands,
    });
    const deliver = (message: object) =>
      server.runtime.dispatch(ActivityReceiver.handle, server.envId(), message as never, {
        publisher: { Id: server.envId() },
      });
    return { server, reports, deliver, tick: () => deliver({ Type: "Activity/Report" }) };
  }

  it("opens git status from selectThread, closes it on leave or under a page, and reports each change at once", async () => {
    let answerBranches: ((refs: unknown[]) => void) | null = null;
    const { server, reports } = await reporting({
      listBranches: () => new Promise((resolve) => (answerBranches = resolve)),
    });
    const status = () =>
      server.runtime
        .resources()
        .filter((row) => row.Key === "Details/Status")
        .map((row) => (row.Params as unknown as { Cwd: string }).Cwd);
    const lastScopes = () => reports.at(-1)?.Scopes.slice(1);
    await server.sendShell({
      kind: "snapshot",
      snapshot: {
        snapshotSequence: 1,
        projects: [{ id: "project-1", title: "One", workspaceRoot: "/repo" }],
        threads: [],
      },
    } as unknown as IWireShellItem);
    await server.runtime.dispatch(selectThread, server.envId(), THREAD_ID);
    expect(status()).toEqual([]);
    await server.sendThread(snapshotOf(emptyProjection(), 1));
    await settled();
    expect(status()).toEqual(["/repo"]);
    expect(lastScopes()).toEqual([{ type: "vcs-status", cwd: "/repo" }]);

    const stale = server.session().Details!.$Id;
    const loading = server.runtime.dispatch(loadBranches, stale, "");
    const projection = emptyProjection();
    await server.sendThread(
      snapshotOf(
        { ...projection, thread: { ...projection.thread, worktreePath: "/repo/wt" } } as never,
        2,
      ),
    );
    await settled();
    expect(status()).toEqual(["/repo/wt"]);
    expect(lastScopes()).toEqual([{ type: "vcs-status", cwd: "/repo/wt" }]);
    answerBranches!([{ Name: "old", IsRemote: false, Current: true, IsDefault: true }]);
    await loading;
    expect(server.session().Details).toMatchObject({ Cwd: "/repo/wt", Branches: null });

    await server.runtime.dispatch(openView, server.envId(), { Kind: "settings", Page: "general" });
    await settled();
    expect(status()).toEqual([]);
    expect(lastScopes()).toEqual([]);
    await server.runtime.dispatch(openView, server.envId(), null);
    await settled();
    expect(status()).toEqual(["/repo/wt"]);
    await server.runtime.dispatch(openView, server.envId(), { Kind: "usage" });
    await server.runtime.dispatch(selectThread, server.envId(), THREAD_ID);
    await settled();
    expect(status()).toEqual(["/repo/wt"]);

    await server.runtime.dispatch(selectThread, server.envId(), "other");
    await settled();
    expect(status()).toEqual([]);
    expect(lastScopes()).toEqual([]);
    expect(server.session().Details).toBeNull();
    await server.runtime.dispatch(selectThread, server.envId(), THREAD_ID);
    await settled();
    expect(status()).toEqual(["/repo/wt"]);
  });

  it("reports on the interval, with git status for the shown thread's checkout", async () => {
    const { server, reports, tick } = await reporting();
    expect(server.runtime.timers(server.envId())).toContainEqual(
      expect.objectContaining({ Key: "Activity/Report", IntervalMs: 25_000 }),
    );
    await tick();
    expect(reports.at(-1)).toMatchObject({
      EnvironmentId: ENV,
      Scopes: [{ type: "provider-status" }],
    });

    await server.sendShell({
      kind: "snapshot",
      snapshot: {
        snapshotSequence: 1,
        projects: [{ id: "project-1", title: "One", workspaceRoot: "/repo" }],
        threads: [],
      },
    } as unknown as IWireShellItem);
    await server.open();
    await server.runtime.dispatch(selectThread, server.envId(), THREAD_ID);
    await server.sendThread(snapshotOf(emptyProjection(), 1));
    await tick();
    expect(reports.at(-1)?.Scopes).toEqual([
      { type: "provider-status" },
      { type: "vcs-status", cwd: "/repo" },
    ]);

    await server.runtime.dispatch(openView, server.envId(), { Kind: "settings", Page: "general" });
    await tick();
    expect(reports.at(-1)?.Scopes).toEqual([{ type: "provider-status" }]);
  });

  it("reports the device's visibility, focus and interaction as each changes", async () => {
    const { reports, deliver } = await reporting();
    await deliver({
      Type: "Device/Activity",
      Visible: true,
      Focused: true,
      RecentlyInteracted: true,
    });
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ Visible: true, Focused: true, RecentlyInteracted: true });
    await deliver({
      Type: "Device/Activity",
      Visible: false,
      Focused: false,
      RecentlyInteracted: false,
    });
    expect(reports).toHaveLength(2);
    expect(reports[1]).toMatchObject({ Visible: false, Focused: false, RecentlyInteracted: false });
  });
});
