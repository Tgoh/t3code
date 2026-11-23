import {
  type IActionGenerator,
  type ISelectorGenerator,
  isEnded,
  openResource,
  receiver,
  resource,
  start,
} from "treflex";

import { type IAppearanceMode, type IColorScheme, resolveScheme } from "./colorScheme";
import { activeProjects, type IEnvironment } from "./Environment";
import { minute } from "./Infrastructure/clock";
import { type IPreferences, storePreferencesEffect } from "./Infrastructure/preferences";
import type { IProjectSort } from "./projectOrder";
import {
  followInbox,
  shellInbox,
  sidebarRowThreadId,
  sidebarThreads,
  subagentRequests,
  workingShelfShown,
} from "./Shell";
import { type ISidebarLayout, layoutSidebar, SETTLED_PAGE } from "./sidebarLayout";
import { followColorScheme } from "./Terminal";
import { liveScope } from "./threadSearch";

declare module "treflex" {
  interface IResourceRegistry {
    "Device/Appearance": { Type: "appearance" };
  }
}

/** Opens what keeps `Local`'s system scheme current. */
export function* followDevice(draft: IEnvironment): IActionGenerator {
  yield* openResource(draft, "Device/Appearance", PreferencesReceiver, { Type: "appearance" });
}

export function* setPreferences(
  draft: IEnvironment,
  patch: Partial<IPreferences>,
): IActionGenerator {
  Object.assign(draft.Local.Preferences, patch);
  yield* storePreferencesEffect({ Patch: patch });
  if (patch.GroupByProject !== undefined) yield* start(followInbox, draft.Replica.Shell);
}

const toggled = (held: readonly string[], id: string, on: boolean) =>
  on ? (held.includes(id) ? [...held] : [...held, id]) : held.filter((other) => other !== id);

export function* setProjectHidden(
  draft: IEnvironment,
  projectId: string,
  hide: boolean,
): IActionGenerator {
  const held = draft.Local.Preferences.HiddenProjects;
  yield* setPreferences(draft, { HiddenProjects: toggled(held, projectId, hide) });
}

export function* toggleFolder(draft: IEnvironment, projectId: string): IActionGenerator {
  const held = draft.Local.Preferences.ClosedFolders;
  yield* setPreferences(draft, {
    ClosedFolders: toggled(held, projectId, !held.includes(projectId)),
  });
}

/** Adds or removes a project from the filter, or clears it with null. */
export function* toggleProjectScope(
  draft: IEnvironment,
  projectId: string | null,
): IActionGenerator {
  if (projectId === null) {
    yield* setPreferences(draft, { ProjectScope: [] });
    return;
  }
  const preferences = draft.Local.Preferences;
  const pickable = (yield* activeProjects(draft))
    .filter((project) => !preferences.HiddenProjects.includes(project.id))
    .map((project) => project.id);
  const held = [...liveScope(new Set(preferences.ProjectScope), new Set(pickable))];
  yield* setPreferences(draft, {
    ProjectScope: toggled(held, projectId, !held.includes(projectId)),
  });
}

export function* toggleShelf(
  draft: IEnvironment,
  shelf: "Working" | "Snoozed" | "Settled",
): IActionGenerator {
  const shelves = draft.Local.Shelves;
  if (shelf === "Working") shelves.WorkingOpen = !shelves.WorkingOpen;
  else if (shelf === "Snoozed") shelves.SnoozedOpen = !shelves.SnoozedOpen;
  else shelves.SettledOpen = !shelves.SettledOpen;
}

export function* showMoreSettled(draft: IEnvironment): IActionGenerator {
  draft.Local.Shelves.SettledShown += SETTLED_PAGE;
}

export function* toggleViewportDebug(draft: IEnvironment): IActionGenerator {
  draft.Local.ViewportDebug = !draft.Local.ViewportDebug;
}

export function* setAppearanceMode(draft: IEnvironment, mode: IAppearanceMode): IActionGenerator {
  yield* setPreferences(draft, { AppearanceMode: mode });
  yield* applyColorScheme(draft);
}

function* applyColorScheme(draft: IEnvironment): IActionGenerator {
  const scheme = yield* colorScheme(draft);
  yield* resource(draft, "Device/Appearance").apply(scheme);
  const selectedId = draft.Local.SelectedThreadId;
  const session = selectedId === null ? undefined : draft.Local.ThreadSessions[selectedId];
  if (session?.Terminal.Open === true) yield* start(followColorScheme, session.Terminal, scheme);
}

export function* colorScheme(draft: IEnvironment): ISelectorGenerator<IColorScheme> {
  return resolveScheme(draft.Local.Preferences.AppearanceMode, draft.Local.SystemDark);
}

export function* sidebarLayout(draft: IEnvironment): ISelectorGenerator<ISidebarLayout> {
  const shell = draft.Replica.Shell;
  return layoutSidebar({
    Threads: yield* sidebarThreads(shell),
    Projects: shell.Projects,
    SelectedId: yield* sidebarRowThreadId(shell),
    Now: yield* minute(),
    Subagents: yield* subagentRequests(shell),
    Preferences: draft.Local.Preferences,
    ProjectSort: yield* projectSort(draft),
    Inbox: workingShelfShown(draft.Local) ? yield* shellInbox(shell) : null,
    Shelves: draft.Local.Shelves,
  });
}

export function* projectSort(draft: IEnvironment): ISelectorGenerator<IProjectSort> {
  return draft.Local.ClientSettings?.sidebarProjectSortOrder ?? "manual";
}

export const PreferencesReceiver = receiver<IEnvironment>("PreferencesReceiver")({
  *"Device/Appearance"(draft, message) {
    if (isEnded(message)) return;
    draft.Local.SystemDark = message.SystemDark;
    if (message.Mode !== null) draft.Local.Preferences.AppearanceMode = message.Mode;
    yield* start(applyColorScheme, draft);
  },
});
