import {
  type IActionGenerator,
  type ISelectorGenerator,
  isEnded,
  openResource,
  receiver,
  resource,
  start,
  startTimer,
} from "treflex";

import { type IAppearanceMode, type IColorScheme, resolveScheme } from "./colorScheme";
import type { IEnvironment } from "./Environment";
import {
  clockNowEffect,
  type IPreferences,
  storePreferencesEffect,
} from "./Infrastructure/preferences";
import { sidebarThreads, subagentRequests } from "./Shell";
import { type ISidebarLayout, layoutSidebar, SETTLED_PAGE } from "./sidebarLayout";
import { followColorScheme } from "./ThreadSession";
import { liveScope } from "./threadSearch";
import { MINUTE } from "./timestamps";

declare module "treflex" {
  interface IResourceRegistry {
    "Device/Appearance": { Type: "appearance" };
  }
  interface ITimerRegistry {
    "Environment/Clock": {};
  }
}

/** Opens what keeps `Local`'s clock and system scheme current. */
export function* followDevice(draft: IEnvironment): IActionGenerator {
  yield* startTimer(draft, "Environment/Clock", PreferencesReceiver, MINUTE);
  yield* openResource(draft, "Device/Appearance", PreferencesReceiver, { Type: "appearance" });
}

export function* setPreferences(
  draft: IEnvironment,
  patch: Partial<IPreferences>,
): IActionGenerator {
  Object.assign(draft.Local.Preferences, patch);
  yield* storePreferencesEffect({ Patch: patch });
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
  const pickable = Object.values(draft.Replica.Shell.Projects)
    .filter(
      (project) => project.archivedAt == null && !preferences.HiddenProjects.includes(project.id),
    )
    .map((project) => project.id);
  const held = [...liveScope(new Set(preferences.ProjectScope), new Set(pickable))];
  yield* setPreferences(draft, {
    ProjectScope: toggled(held, projectId, !held.includes(projectId)),
  });
}

export function* toggleShelf(draft: IEnvironment, shelf: "Snoozed" | "Settled"): IActionGenerator {
  const shelves = draft.Local.Shelves;
  if (shelf === "Snoozed") shelves.SnoozedOpen = !shelves.SnoozedOpen;
  else shelves.SettledOpen = !shelves.SettledOpen;
}

export function* showMoreSettled(draft: IEnvironment): IActionGenerator {
  draft.Local.Shelves.SettledShown += SETTLED_PAGE;
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
  if (session?.Terminal.Open === true) yield* start(followColorScheme, session, scheme);
}

export function* colorScheme(draft: IEnvironment): ISelectorGenerator<IColorScheme> {
  return resolveScheme(draft.Local.Preferences.AppearanceMode, draft.Local.SystemDark);
}

export function* sidebarLayout(draft: IEnvironment): ISelectorGenerator<ISidebarLayout> {
  const shell = draft.Replica.Shell;
  return layoutSidebar({
    Threads: yield* sidebarThreads(shell),
    Projects: shell.Projects,
    SelectedId: draft.Local.SelectedThreadId,
    Now: draft.Local.Now,
    Subagents: yield* subagentRequests(shell),
    Preferences: draft.Local.Preferences,
    Shelves: draft.Local.Shelves,
  });
}

export const PreferencesReceiver = receiver<IEnvironment>("PreferencesReceiver")({
  *"Environment/Clock"(draft) {
    draft.Local.Now = yield* clockNowEffect();
  },
  *"Device/Appearance"(draft, message) {
    if (isEnded(message)) return;
    draft.Local.SystemDark = message.SystemDark;
    if (message.Mode !== null) draft.Local.Preferences.AppearanceMode = message.Mode;
    yield* start(applyColorScheme, draft);
  },
});
