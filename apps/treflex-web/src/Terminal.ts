import { DEFAULT_TERMINAL_ID } from "@t3tools/contracts";
import {
  closeResource,
  getData,
  type IActionGenerator,
  type IOpenGenerator,
  type ISelectorGenerator,
  isEnded,
  leading,
  open,
  openResource,
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
  type ITerminalLaunch,
  rememberedTerminalEffect,
  rememberTerminalEffect,
} from "./Infrastructure/terminalMemory";
import type { ITerminalStatus } from "./Infrastructure/terminalSession";

declare module "treflex" {
  interface IResourceRegistry {
    "Terminal/Session": { Type: "terminalSession" };
  }
}

export interface ITerminal extends IThreadPart {
  TerminalId: string;
  Open: boolean;
  Error?: string;
  Status: ITerminalStatus | null;
  /** The emulator takes focus when it mounts, which a reattach doesn't want. */
  FocusOnMount: boolean;
}

export function getDefaultTerminal(
  environmentId: string,
  threadId: string,
): Omit<ITerminal, "$Id"> {
  return {
    EnvironmentId: environmentId,
    ThreadId: threadId,
    TerminalId: DEFAULT_TERMINAL_ID,
    Open: false,
    Status: null,
    FocusOnMount: false,
  };
}

function* terminalLaunch(draft: ITerminal): ISelectorGenerator<ITerminalLaunch | null> {
  const held = yield* checkout(draft);
  if (held === null) return null;
  return { Cwd: held.Cwd, WorktreePath: held.WorktreePath, ProjectRoot: held.ProjectRoot };
}

function* isThreadSelected(draft: ITerminal): ISelectorGenerator<boolean> {
  const selection = yield* getData(draft, "Selection");
  return selection?.SelectedThreadId === draft.ThreadId;
}

function* terminalScheme(draft: ITerminal): ISelectorGenerator<IColorScheme> {
  const selection = yield* getData(draft, "Selection");
  return selection === undefined
    ? "light"
    : resolveScheme(selection.Preferences.AppearanceMode, selection.SystemDark);
}

function* attachTerminal(draft: ITerminal, launch: ITerminalLaunch): IActionGenerator {
  yield* openResource(draft, "Terminal/Session", TerminalReceiver, {
    Type: "terminalSession",
    EnvironmentId: draft.EnvironmentId,
    ThreadId: draft.ThreadId,
    TerminalId: draft.TerminalId,
    Cwd: launch.Cwd,
    WorktreePath: launch.WorktreePath,
    ProjectRoot: launch.ProjectRoot,
  });
  yield* followColorScheme(draft, yield* select(terminalScheme));
}

export function* followColorScheme(draft: ITerminal, scheme: IColorScheme): IActionGenerator {
  yield* resource(draft, "Terminal/Session").setScheme(scheme);
}

export function* restoreTerminal(draft: ITerminal): IActionGenerator {
  const launch = yield* rememberedTerminalEffect({ ThreadId: draft.ThreadId });
  if (launch === null || !(yield* select(isThreadSelected))) return;
  draft.Open = true;
  draft.FocusOnMount = false;
  yield* attachTerminal(draft, launch);
}

export function* openTerminal(draft: ITerminal): IActionGenerator {
  draft.Open = true;
  delete draft.Error;
  draft.Status = null;
  draft.FocusOnMount = true;
  const launch = yield* select(terminalLaunch);
  if (launch === null) {
    draft.Error = "This thread's project isn't loaded yet.";
    return;
  }
  yield* attachTerminal(draft, launch);
  yield* rememberTerminalEffect({ ThreadId: draft.ThreadId, Launch: launch });
}

export function* detachTerminal(draft: ITerminal): IActionGenerator {
  draft.Status = null;
  yield* closeResource(draft, "Terminal/Session");
}

export function* closeTerminal(draft: ITerminal): IActionGenerator {
  draft.Open = false;
  delete draft.Error;
  yield* detachTerminal(draft);
  yield* rememberTerminalEffect({ ThreadId: draft.ThreadId, Launch: null });
}

export function* toggleTerminal(draft: ITerminal): IActionGenerator {
  if (draft.Open) yield* closeTerminal(draft);
  else yield* openTerminal(draft);
}

export function* endTerminal(draft: ITerminal): IOpenGenerator {
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
  yield* closeTerminal(draft);
}
leading(endTerminal);

export const TerminalReceiver = receiver<ITerminal>("TerminalReceiver")({
  *"Terminal/Session"(draft, message) {
    if (isEnded(message)) return;
    draft.Status = message.Status;
    if (message.Error === null) delete draft.Error;
    else draft.Error = message.Error;
  },
});

export default createEntityFeature<ITerminal>("Terminal")(
  { openTerminal, closeTerminal, toggleTerminal, endTerminal },
  {},
);
