import { nextTerminalId } from "@t3tools/shared/terminalLabels";
import {
  closeResource,
  entity,
  getData,
  type IActionGenerator,
  type IOpenGenerator,
  type IReceiverId,
  type ISelectorGenerator,
  isEnded,
  leading,
  open,
  openResource,
  publishToNearest,
  receiver,
  resource,
  select,
} from "treflex";
import { createEntityFeature } from "treflex-solid";

import { checkout, type IThreadPart } from "./checkout";
import { type IColorScheme, resolveScheme } from "./colorScheme";
import { closeTerminalEffect } from "./Infrastructure/commandEffects";
import { serverError } from "./Infrastructure/serverError";
import {
  DEFAULT_TERMINAL_HEIGHT,
  type IRememberedTerminal,
  type ITerminalLaunch,
  rememberedTerminalEffect,
  rememberTerminalEffect,
} from "./Infrastructure/terminalMemory";
import type { ITerminalStatus } from "./Infrastructure/terminalSession";
import {
  activateTerminal,
  EMPTY_TERMINAL_LAYOUT,
  type ISplitDirection,
  type ITerminalLayout,
  normalizeLayout,
  placeTerminal,
  removeTerminal,
} from "./terminalLayout";

declare module "treflex" {
  interface IResourceRegistry {
    "Terminal/Session": { Type: "terminalSession" };
  }
  interface IMessageRegistry {
    "Terminal/ShellEnded": { TerminalId: string };
  }
}

/** One shell in the drawer, a tab or a pane of a split. */
export interface ITerminalShell extends IThreadPart {
  TerminalId: string;
  Launch: ITerminalLaunch;
  Error?: string;
  Status: ITerminalStatus | null;
  /** The emulator takes focus when it mounts, which a reattach doesn't want. */
  FocusOnMount: boolean;
}

export interface ITerminal extends IThreadPart {
  readonly $Receiver?: IReceiverId<ITerminal>;
  Open: boolean;
  Height: number;
  Layout: ITerminalLayout;
  /** By terminal id, one for each id in the layout. */
  Shells: Record<string, ITerminalShell>;
  Error?: string;
}

export function getDefaultTerminal(
  environmentId: string,
  threadId: string,
): Omit<ITerminal, "$Id"> {
  return {
    $Receiver: TerminalReceiver.Id,
    EnvironmentId: environmentId,
    ThreadId: threadId,
    Open: false,
    Height: DEFAULT_TERMINAL_HEIGHT,
    Layout: EMPTY_TERMINAL_LAYOUT,
    Shells: {},
  };
}

function* terminalLaunch(draft: IThreadPart): ISelectorGenerator<ITerminalLaunch | null> {
  const held = yield* checkout(draft);
  if (held === null) return null;
  return { Cwd: held.Cwd, WorktreePath: held.WorktreePath, ProjectRoot: held.ProjectRoot };
}

function* isThreadSelected(draft: IThreadPart): ISelectorGenerator<boolean> {
  const selection = yield* getData(draft, "Selection");
  return selection?.SelectedThreadId === draft.ThreadId;
}

function* terminalScheme(draft: IThreadPart): ISelectorGenerator<IColorScheme> {
  const selection = yield* getData(draft, "Selection");
  return selection === undefined
    ? "light"
    : resolveScheme(selection.Preferences.AppearanceMode, selection.SystemDark);
}

function* attachShell(shell: ITerminalShell, scheme: IColorScheme): IActionGenerator {
  yield* openResource(shell, "Terminal/Session", TerminalShellReceiver, {
    Type: "terminalSession",
    EnvironmentId: shell.EnvironmentId,
    ThreadId: shell.ThreadId,
    TerminalId: shell.TerminalId,
    Cwd: shell.Launch.Cwd,
    WorktreePath: shell.Launch.WorktreePath,
    ProjectRoot: shell.Launch.ProjectRoot,
  });
  yield* resource(shell, "Terminal/Session").setScheme(scheme);
}

function* attachAll(draft: ITerminal, focusId: string | null): IActionGenerator {
  const scheme = yield* select(terminalScheme);
  for (const shell of Object.values(draft.Shells)) {
    shell.FocusOnMount = shell.TerminalId === focusId;
    yield* attachShell(shell, scheme);
  }
}

function* detachShell(shell: ITerminalShell): IActionGenerator {
  shell.Status = null;
  yield* closeResource(shell, "Terminal/Session");
}

function* remember(draft: ITerminal): IActionGenerator {
  const terminal: IRememberedTerminal | null =
    draft.Layout.TerminalIds.length === 0
      ? null
      : {
          Open: draft.Open,
          Height: draft.Height,
          Layout: draft.Layout,
          Launches: Object.fromEntries(
            Object.values(draft.Shells).map((shell) => [shell.TerminalId, shell.Launch]),
          ),
        };
  yield* rememberTerminalEffect({ ThreadId: draft.ThreadId, Terminal: terminal });
}

function* addShell(
  draft: ITerminal,
  terminalId: string,
  launch: ITerminalLaunch,
): IActionGenerator<ITerminalShell> {
  draft.Shells[terminalId] = yield* entity<ITerminalShell>({
    EnvironmentId: draft.EnvironmentId,
    ThreadId: draft.ThreadId,
    TerminalId: terminalId,
    Launch: launch,
    Status: null,
    FocusOnMount: false,
  });
  return draft.Shells[terminalId]!;
}

export function* followColorScheme(draft: ITerminal, scheme: IColorScheme): IActionGenerator {
  if (!draft.Open) return;
  for (const shell of Object.values(draft.Shells)) {
    yield* resource(shell, "Terminal/Session").setScheme(scheme);
  }
}

/** Puts back the drawer this device left, and reattaches it if it was open. */
export function* restoreTerminal(draft: ITerminal): IActionGenerator {
  if (draft.Layout.TerminalIds.length === 0) {
    const held = yield* rememberedTerminalEffect({ ThreadId: draft.ThreadId });
    if (held === null) return;
    const layout = normalizeLayout(held.Layout);
    const launched = layout.TerminalIds.filter((id) => held.Launches[id] !== undefined);
    if (launched.length === 0) return;
    let kept = layout;
    for (const id of layout.TerminalIds) {
      if (!launched.includes(id)) kept = removeTerminal(kept, id);
    }
    draft.Layout = kept;
    draft.Height = held.Height;
    draft.Open = held.Open;
    for (const id of kept.TerminalIds) yield* addShell(draft, id, held.Launches[id]!);
  }
  if (!draft.Open || !(yield* select(isThreadSelected))) return;
  yield* attachAll(draft, null);
}

export function* openTerminal(draft: ITerminal): IActionGenerator {
  draft.Open = true;
  delete draft.Error;
  if (draft.Layout.TerminalIds.length === 0) {
    const launch = yield* select(terminalLaunch);
    if (launch === null) {
      draft.Error = "This thread's project isn't loaded yet.";
      return;
    }
    const terminalId = nextTerminalId([]);
    draft.Layout = placeTerminal(draft.Layout, terminalId, "new");
    yield* addShell(draft, terminalId, launch);
  }
  yield* attachAll(draft, draft.Layout.ActiveTerminalId);
  yield* remember(draft);
}

/** Hides the drawer. Its shells keep running on the server, and an open reattaches them. */
export function* closeTerminal(draft: ITerminal): IActionGenerator {
  draft.Open = false;
  delete draft.Error;
  for (const shell of Object.values(draft.Shells)) yield* detachShell(shell);
  yield* remember(draft);
}

export function* detachTerminal(draft: ITerminal): IActionGenerator {
  for (const shell of Object.values(draft.Shells)) yield* detachShell(shell);
}

export function* toggleTerminal(draft: ITerminal): IActionGenerator {
  if (draft.Open) yield* closeTerminal(draft);
  else yield* openTerminal(draft);
}

/** A new tab, or with a direction a split beside the active shell, starting where the thread runs. */
export function* addTerminal(draft: ITerminal, split: ISplitDirection | null): IActionGenerator {
  delete draft.Error;
  const launch = yield* select(terminalLaunch);
  if (launch === null) {
    draft.Error = "This thread's project isn't loaded yet.";
    return;
  }
  const terminalId = nextTerminalId(draft.Layout.TerminalIds);
  const layout = placeTerminal(
    draft.Layout,
    terminalId,
    split === null ? "new" : "split",
    split ?? "horizontal",
  );
  if (!layout.TerminalIds.includes(terminalId)) return;
  draft.Layout = layout;
  draft.Open = true;
  const shell = yield* addShell(draft, terminalId, launch);
  shell.FocusOnMount = true;
  yield* attachShell(shell, yield* select(terminalScheme));
  yield* remember(draft);
}

export function* activateShell(draft: ITerminal, terminalId: string): IActionGenerator {
  const layout = activateTerminal(draft.Layout, terminalId);
  if (
    layout.ActiveTerminalId === draft.Layout.ActiveTerminalId &&
    layout.ActiveGroupId === draft.Layout.ActiveGroupId
  )
    return;
  draft.Layout = layout;
  yield* remember(draft);
}

export function* setTerminalHeight(draft: ITerminal, height: number): IActionGenerator {
  if (!Number.isFinite(height) || height <= 0 || height === draft.Height) return;
  draft.Height = Math.round(height);
  yield* remember(draft);
}

/** Ends a shell on the server and deletes its history; its tab goes once the server agrees. */
export function* endShell(draft: ITerminalShell): IOpenGenerator {
  delete draft.Error;
  const request = {
    EnvironmentId: draft.EnvironmentId,
    ThreadId: draft.ThreadId,
    TerminalId: draft.TerminalId,
  };
  try {
    yield* open(closeTerminalEffect(request));
  } catch (error) {
    draft.Error = serverError(error).message;
    return;
  }
  yield* publishToNearest(draft, "Terminal/ShellEnded", { TerminalId: draft.TerminalId });
}
leading(endShell);

/** Starts an exited shell again in the same tab, or retries a failed attach. */
export function* restartShell(draft: ITerminalShell): IActionGenerator {
  delete draft.Error;
  draft.FocusOnMount = true;
  yield* detachShell(draft);
  yield* attachShell(draft, yield* select(terminalScheme));
}

export const TerminalReceiver = receiver<ITerminal>("TerminalReceiver")({
  *"Terminal/ShellEnded"(draft, { TerminalId }) {
    draft.Layout = removeTerminal(draft.Layout, TerminalId);
    delete draft.Shells[TerminalId];
    if (draft.Layout.TerminalIds.length === 0) draft.Open = false;
    yield* remember(draft);
  },
});

export const TerminalShellReceiver = receiver<ITerminalShell>("TerminalShellReceiver")({
  *"Terminal/Session"(draft, message) {
    if (isEnded(message)) return;
    draft.Status = message.Status;
    if (message.Error === null) delete draft.Error;
    else draft.Error = message.Error;
  },
});

/** The shell a project script runs in: the active one, or the first a new drawer opens. */
export function scriptTerminalId(draft: ITerminal): string {
  return draft.Layout.ActiveTerminalId || nextTerminalId([]);
}

export const TerminalShell = createEntityFeature<ITerminalShell>("TerminalShell")(
  { endShell, restartShell },
  {},
);

export default createEntityFeature<ITerminal>("Terminal")(
  {
    openTerminal,
    closeTerminal,
    toggleTerminal,
    addTerminal,
    activateShell,
    setTerminalHeight,
  },
  {},
);
