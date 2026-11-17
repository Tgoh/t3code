import {
  getCloneDirectoryLeafName,
  getNewProjectPathPreview,
  normalizePastedCloneUrl,
  resolveAddProjectPath,
} from "@t3tools/client-runtime/operations/projects";
import { getFilesystemBrowseTabCompletion } from "@t3tools/client-runtime/state/filesystem";
import {
  hasTrailingPathSeparator,
  isExplicitRelativeProjectPath,
} from "@t3tools/client-runtime/state/projects";
import { type IActionGenerator, type IEntity, latest } from "treflex";
import { useComponentState, useInFlight } from "treflex-solid";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  Match,
  on,
  onMount,
  Show,
  Switch,
} from "solid-js";
import { Portal } from "solid-js/web";

import {
  browsePlatform,
  browseTarget,
  chosenFolder,
  defaultCloneDestination,
  enterFolder,
  folderChoices,
  initialFolderQuery,
  leaveFolder,
} from "./addProjectPaths";
import {
  addProjectSources,
  browseSubmitLabel,
  filterSources,
  type IAddProjectSourceId,
  willCreateFolder,
} from "./addProjectPalette";
import Environment, { addFolder, cloneProject, newProject } from "./Environment";
import { errorText } from "./errorText";
import { arrowStep, stepHighlight } from "./listNavigation";
import { ArrowLeft, CornerLeftUp, Folder, FolderGit2, FolderPlus, Link } from "./icons";
import {
  addProjectSettingsEffect,
  browseFoldersEffect,
  type IAddProjectSettings,
  type IFolderListing,
} from "./Infrastructure/commandEffects";
import {
  PALETTE,
  PALETTE_ADDON,
  PALETTE_BACK,
  PALETTE_BACKDROP,
  PALETTE_ERROR,
  PALETTE_FOOTER,
  PALETTE_GROUP,
  PALETTE_HINT,
  PALETTE_INPUT,
  PALETTE_INPUT_ROW,
  PALETTE_KBD,
  PALETTE_LIST,
  PALETTE_NOTE,
  PALETTE_ROW,
  PALETTE_ROW_COMPACT,
  PALETTE_ROW_DETAIL,
  PALETTE_ROW_TEXT,
  PALETTE_ROW_TITLE,
  PALETTE_SUBMIT,
  PALETTE_WARNING,
} from "./ui/palette";

const SUMMARY =
  "flex items-center gap-2.5 border-b border-border px-3.5 py-2 [&>svg]:size-4 [&>svg]:flex-none [&>svg]:text-muted-foreground";
const SUMMARY_TEXT = "flex min-w-0 flex-col";
const SUMMARY_TITLE = "text-[14px] font-medium";
const SUMMARY_DETAIL = "text-[12px] wrap-anywhere text-muted-foreground";

const UNKNOWN_SETTINGS: IAddProjectSettings = {
  BaseDirectory: "",
  GhqCloneLayout: false,
  NewProjectsRoot: null,
  Os: "",
};

interface IAddProjectPalette extends IEntity {
  Settings: IAddProjectSettings | null;
  SettingsError: string | null;
}

function* loadSettings(draft: IAddProjectPalette, environmentId: string): IActionGenerator {
  try {
    draft.Settings = yield* addProjectSettingsEffect({ EnvironmentId: environmentId });
  } catch (error) {
    draft.SettingsError = errorText(error);
  }
}

interface IFolderPicker extends IEntity {
  Path: string | null;
  Listing: IFolderListing | null;
  Error: string | null;
}

function* browse(
  draft: IFolderPicker,
  environmentId: string,
  path: string,
  cwd: string | null,
): IActionGenerator {
  draft.Path = path;
  draft.Listing = null;
  draft.Error = null;
  try {
    draft.Listing = yield* browseFoldersEffect({
      EnvironmentId: environmentId,
      PartialPath: path,
      Cwd: cwd,
    });
  } catch (error) {
    draft.Error = errorText(error);
  }
}
latest(browse);

type IView =
  | { Kind: "sources" }
  | { Kind: "folder" }
  | { Kind: "clone-url" }
  | { Kind: "clone-dest"; Remote: string }
  | { Kind: "new" };

type IBrowseRow = { Kind: "up" } | { Kind: "folder"; Name: string; FullPath: string };

const SOURCE_ICONS: Record<IAddProjectSourceId, () => JSX.Element> = {
  new: () => <FolderGit2 />,
  local: () => <FolderPlus />,
  url: () => <Link />,
};

const isMac = () => typeof navigator !== "undefined" && navigator.platform.startsWith("Mac");
const modifierLabel = () => (isMac() ? "⌘" : "Ctrl");

// Follows the add-project views of CommandPalette in apps/web/src/components/CommandPalette.tsx:
// a sources list, then a folder browser, a clone URL and destination, or a new project's name.
export function AddProjectPalette(props: { onClose: () => void }) {
  const environment = Environment.use();
  const palette = useComponentState<IAddProjectPalette>(() => ({
    Settings: null,
    SettingsError: null,
  }));
  onMount(() => palette.dispatch(loadSettings, environment.state.EnvironmentId));
  const settings = () =>
    palette.state.Settings ?? (palette.state.SettingsError === null ? null : UNKNOWN_SETTINGS);
  const cwd = () => environment.currentProjectRoot();
  const platform = () => browsePlatform(settings()?.Os ?? "");
  const busy = useInFlight([addFolder, cloneProject, newProject], () => environment.state);

  const [stack, setStack] = createSignal<IView[]>([{ Kind: "sources" }]);
  const view = () => stack().at(-1)!;
  const [query, setQuery] = createSignal("");
  const [highlight, setHighlight] = createSignal<number | null>(0);
  const [error, setError] = createSignal<string | null>(null);
  const [notice, setNotice] = createSignal<string | null>(null);
  const [input, setInput] = createSignal<HTMLInputElement>();
  const [list, setList] = createSignal<HTMLElement>();

  const focusInput = () =>
    queueMicrotask(() => {
      const element = input();
      element?.focus();
      element?.setSelectionRange(element.value.length, element.value.length);
    });
  onMount(focusInput);

  const initialQuery = (next: IView): string => {
    const held = settings() ?? UNKNOWN_SETTINGS;
    if (next.Kind === "folder") return initialFolderQuery(held);
    if (next.Kind === "clone-dest") return defaultCloneDestination(held, next.Remote);
    return "";
  };
  const show = (next: IView[]) => {
    setStack(next);
    setQuery(initialQuery(next.at(-1)!));
    setHighlight(next.at(-1)!.Kind === "sources" ? 0 : null);
    setError(null);
    setNotice(null);
    focusInput();
  };
  const push = (next: IView) => show([...stack(), next]);
  const back = () => {
    if (stack().length > 1) show(stack().slice(0, -1));
  };

  const sources = createMemo(() =>
    filterSources(addProjectSources(settings()?.NewProjectsRoot != null), query()),
  );
  const runSource = (id: IAddProjectSourceId) => {
    if (id === "local") push({ Kind: "folder" });
    else if (id === "url") push({ Kind: "clone-url" });
    else push({ Kind: "new" });
  };

  // Browsing, for a local folder or a clone's destination.
  const browsing = () => view().Kind === "folder" || view().Kind === "clone-dest";
  const cloneRemote = () => {
    const current = view();
    return current.Kind === "clone-dest" ? current.Remote : null;
  };
  const cloneFolder = () => {
    const remote = cloneRemote();
    return remote === null
      ? ""
      : getCloneDirectoryLeafName(remote, (settings() ?? UNKNOWN_SETTINGS).GhqCloneLayout);
  };
  const picker = useComponentState<IFolderPicker>(() => ({
    Path: null,
    Listing: null,
    Error: null,
  }));
  const directory = createMemo(() => (browsing() ? browseTarget(query(), platform(), cwd()) : ""));
  createEffect(() => {
    const path = directory();
    if (path !== "") picker.dispatch(browse, environment.state.EnvironmentId, path, cwd());
  });
  const listed = () => picker.state.Path === directory();
  const listing = () => (listed() ? picker.state.Listing : null);
  const listingError = () => (listed() ? picker.state.Error : null);
  const pending = () => directory() !== "" && listing() === null && listingError() === null;
  const choices = createMemo(() =>
    folderChoices({
      query: query(),
      platform: platform(),
      entries: listing()?.Entries ?? [],
      cloneFolder: cloneFolder(),
    }),
  );
  const relativeNeedsProject = () =>
    browsing() && cwd() === null && isExplicitRelativeProjectPath(query().trim());
  const rows = createMemo((): IBrowseRow[] => {
    if (directory() === "") return [];
    return [
      ...(choices().browse.canBrowseUp ? [{ Kind: "up" as const }] : []),
      ...choices().visibleEntries.map((entry) => ({
        Kind: "folder" as const,
        Name: entry.name,
        FullPath: entry.fullPath,
      })),
    ];
  });
  const willCreate = () =>
    browsing() &&
    !relativeNeedsProject() &&
    willCreateFolder({
      query: query(),
      pending: pending(),
      highlighted: highlight() !== null,
      trailingSeparator: hasTrailingPathSeparator(query()),
      listed: listing() !== null,
      exactMatch: choices().exactEntry !== null,
    });
  const go = (next: string) => {
    setHighlight(null);
    setQuery(next);
    focusInput();
  };
  const open = (name: string) =>
    go(
      enterFolder({
        query: query(),
        directoryPath: choices().browse.directoryPath,
        name,
        cloneFolder: cloneFolder(),
        platform: platform(),
      }),
    );
  const up = () => {
    const parent = choices().browse.parentPath;
    if (parent !== null) go(leaveFolder(parent, cloneFolder()));
  };
  const openRow = (row: IBrowseRow | undefined) => {
    if (row === undefined) return;
    if (row.Kind === "up") up();
    else open(row.Name);
  };
  // Follows the Tab branch of handleKeyDown in apps/web/src/components/CommandPalette.tsx.
  const complete = () => {
    const held = highlight();
    if (held !== null) return openRow(rows()[held]);
    const completion = getFilesystemBrowseTabCompletion(
      choices().visibleEntries,
      choices().browse.filterQuery,
    );
    if (completion?.isComplete) open(completion.name);
    else if (completion !== null && cloneFolder() === "")
      go(`${choices().browse.directoryPath}${completion.name}`);
  };
  const submitPath = async () => {
    if (query().trim() === "" || relativeNeedsProject() || busy()) return;
    const resolved = resolveAddProjectPath({
      rawPath: chosenFolder(query(), listing(), choices().exactEntry),
      platform: platform(),
      currentProjectCwd: cwd(),
    });
    if (!resolved.ok) return setError(resolved.error);
    setError(null);
    const current = view();
    const failure =
      current.Kind === "clone-dest"
        ? await environment.cloneProject(current.Remote, resolved.path)
        : await environment.addFolder(resolved.path);
    if (failure === null) props.onClose();
    else if (failure !== undefined) setError(failure);
  };

  const continueClone = () => {
    const raw = query().trim();
    if (raw !== "") push({ Kind: "clone-dest", Remote: normalizePastedCloneUrl(raw) });
  };

  const newProjectName = () => query().trim();
  const submitNew = async () => {
    const created = newProjectName();
    if (created === "" || busy()) return;
    setError(null);
    setNotice(null);
    const outcome = await environment.newProject(created);
    if (outcome === undefined) return;
    if ("Error" in outcome) return setError(outcome.Error);
    if (outcome.CommitError === null) return props.onClose();
    setQuery("");
    setNotice(
      `Created ${created} without a first commit: ${outcome.CommitError} The project is in ${outcome.WorkspaceRoot}.`,
    );
  };

  const rowCount = () =>
    view().Kind === "sources" ? sources().length : browsing() ? rows().length : 0;
  // A new filter keeps the first source highlighted, as stock's autocomplete does.
  createEffect(
    on(sources, () => {
      if (view().Kind === "sources") setHighlight(sources().length === 0 ? null : 0);
    }),
  );
  createEffect(
    on(highlight, (held) => {
      if (held === null) return;
      list()?.querySelector(`[data-row="${held}"]`)?.scrollIntoView({ block: "nearest" });
    }),
  );

  // Follows handleKeyDown in apps/web/src/components/CommandPalette.tsx.
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.isComposing || event.keyCode === 229) return;
    const current = view();
    if (event.key === "Escape") {
      event.preventDefault();
      props.onClose();
      return;
    }
    if (event.key === "Backspace" && query() === "" && stack().length > 1) {
      event.preventDefault();
      back();
      return;
    }
    const step = arrowStep(event.key);
    if (step !== null) {
      if (rowCount() === 0) return;
      event.preventDefault();
      setHighlight((held) => stepHighlight(held, rowCount(), step));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (current.Kind === "sources") {
        const source = sources()[highlight() ?? 0];
        if (source !== undefined) runSource(source.Id);
      } else if (current.Kind === "clone-url") continueClone();
      else if (current.Kind === "new") void submitNew();
      else {
        const held = highlight();
        const modified = isMac() ? event.metaKey : event.ctrlKey;
        if (held !== null && !modified) openRow(rows()[held]);
        else void submitPath();
      }
      return;
    }
    if (event.key !== "Tab" || !browsing()) return;
    if (event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return;
    if (directory() === "") return;
    event.preventDefault();
    complete();
  };

  const placeholder = () => {
    const kind = view().Kind;
    if (kind === "sources") return "Search…";
    if (kind === "clone-url") return "Git URL or repository page";
    if (kind === "new") return "Project name";
    return "";
  };
  const shortcut = () =>
    browsing() && highlight() !== null ? `${modifierLabel()} Enter` : "Enter";
  const accessory = (): { Label: string; Disabled: boolean; Run: () => void } | null => {
    const kind = view().Kind;
    if (kind === "clone-url")
      return { Label: "Continue", Disabled: query().trim() === "", Run: continueClone };
    if (kind === "new")
      return {
        Label: busy() ? "Creating" : "Create",
        Disabled: newProjectName() === "" || busy(),
        Run: () => void submitNew(),
      };
    if (!browsing()) return null;
    const clone = kind === "clone-dest";
    return {
      Label: clone && busy() ? "Cloning" : browseSubmitLabel(clone, willCreate()),
      Disabled: query().trim() === "" || relativeNeedsProject() || busy(),
      Run: () => void submitPath(),
    };
  };
  const footerAction = () => {
    const kind = view().Kind;
    if (kind === "sources") return "Select";
    if (kind === "clone-url") return "Continue";
    if (kind === "new") return "Create";
    return highlight() === null ? null : "Select";
  };
  const emptyMessage = () => {
    const kind = view().Kind;
    if (kind === "clone-url") return "Enter a Git clone URL and press Enter to continue.";
    if (relativeNeedsProject()) return "Relative paths require an active project.";
    if (willCreate())
      return kind === "clone-dest"
        ? "Press Enter to create this folder and clone into it."
        : "Press Enter to create this folder and add it as a project.";
    if (pending()) return "Loading folders…";
    const failure = listingError();
    if (failure !== null) return `Couldn't list this folder: ${failure}`;
    if (browsing() && directory() !== "" && rows().length === 0) return "No folders here.";
    if (kind === "sources" && sources().length === 0) return "No matching sources.";
    return null;
  };

  return (
    <Portal>
      <div
        class={PALETTE_BACKDROP}
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) props.onClose();
        }}
      >
        <div class={PALETTE} role="dialog" aria-modal="true" aria-label="Add project">
          <div class={PALETTE_INPUT_ROW}>
            <Show
              when={stack().length > 1}
              fallback={
                <span class={PALETTE_ADDON}>
                  <FolderPlus />
                </span>
              }
            >
              <button type="button" class={PALETTE_BACK} aria-label="Back" onClick={back}>
                <ArrowLeft />
              </button>
            </Show>
            <input
              class={PALETTE_INPUT}
              aria-label={view().Kind === "sources" ? "Search sources" : placeholder() || "Path"}
              placeholder={placeholder()}
              spellcheck={false}
              autocomplete="off"
              value={query()}
              ref={setInput}
              onInput={(event) => {
                setQuery(event.currentTarget.value);
                if (browsing()) setHighlight(null);
                setError(null);
              }}
              onKeyDown={onKeyDown}
            />
            <Show when={accessory()}>
              {(button) => (
                <button
                  type="button"
                  class={PALETTE_SUBMIT}
                  disabled={button().Disabled}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => button().Run()}
                >
                  {button().Label}
                  <kbd class={PALETTE_KBD}>{shortcut()}</kbd>
                </button>
              )}
            </Show>
          </div>
          <Show when={palette.state.SettingsError}>
            {(failure) => (
              <p class={PALETTE_NOTE}>Couldn't read the server's project settings: {failure()}</p>
            )}
          </Show>
          <Show when={settings()} fallback={<p class={PALETTE_NOTE}>Loading…</p>}>
            <Switch>
              <Match when={cloneRemote()}>
                {(remote) => (
                  <div class={SUMMARY}>
                    <Link />
                    <div class={SUMMARY_TEXT}>
                      <span class={SUMMARY_TITLE}>{cloneFolder()}</span>
                      <span class={SUMMARY_DETAIL}>{remote()}</span>
                    </div>
                  </div>
                )}
              </Match>
              <Match when={view().Kind === "new" && settings()?.NewProjectsRoot}>
                {(root) => (
                  <div class={SUMMARY}>
                    <FolderGit2 />
                    <div class={SUMMARY_TEXT}>
                      <span class={SUMMARY_TITLE}>
                        {newProjectName() === "" ? "New project" : newProjectName()}
                      </span>
                      <span class={SUMMARY_DETAIL}>
                        {newProjectName() === ""
                          ? `Goes in ${root()}`
                          : `Creates ${getNewProjectPathPreview(root(), newProjectName())}`}
                      </span>
                    </div>
                  </div>
                )}
              </Match>
            </Switch>
            <Show when={error()}>{(shown) => <p class={PALETTE_ERROR}>{shown()}</p>}</Show>
            <Show when={notice()}>{(shown) => <p class={PALETTE_WARNING}>{shown()}</p>}</Show>
            <div class={PALETTE_LIST} ref={setList} role="listbox">
              <Show when={view().Kind === "sources" && sources().length > 0}>
                <p class={PALETTE_GROUP}>Sources</p>
                <For each={sources()}>
                  {(source, index) => (
                    <button
                      type="button"
                      class={PALETTE_ROW}
                      role="option"
                      aria-selected={highlight() === index()}
                      data-row={index()}
                      onMouseDown={(event) => event.preventDefault()}
                      onPointerMove={() => setHighlight(index())}
                      onClick={() => runSource(source.Id)}
                    >
                      {SOURCE_ICONS[source.Id]()}
                      <span class={PALETTE_ROW_TEXT}>
                        <span class={PALETTE_ROW_TITLE}>{source.Title}</span>
                        <span class={PALETTE_ROW_DETAIL}>{source.Description}</span>
                      </span>
                    </button>
                  )}
                </For>
              </Show>
              <Show when={browsing() && rows().length > 0}>
                <p class={PALETTE_GROUP}>
                  {view().Kind === "clone-dest" ? "Select where to clone" : "Directories"}
                </p>
                <For each={rows()}>
                  {(row, index) => (
                    <button
                      type="button"
                      class={PALETTE_ROW_COMPACT}
                      role="option"
                      aria-selected={highlight() === index()}
                      data-row={index()}
                      data-tip={row.Kind === "folder" ? row.FullPath : undefined}
                      onMouseDown={(event) => event.preventDefault()}
                      onPointerMove={() => setHighlight(index())}
                      onClick={() => openRow(row)}
                    >
                      {row.Kind === "up" ? <CornerLeftUp /> : <Folder />}
                      <span class={PALETTE_ROW_TITLE}>{row.Kind === "up" ? ".." : row.Name}</span>
                    </button>
                  )}
                </For>
              </Show>
              <Show when={emptyMessage()}>
                {(message) => <p class={PALETTE_NOTE}>{message()}</p>}
              </Show>
            </div>
          </Show>
          <footer class={PALETTE_FOOTER}>
            <span class={PALETTE_HINT}>
              <kbd class={PALETTE_KBD}>↑</kbd>
              <kbd class={PALETTE_KBD}>↓</kbd> Navigate
            </span>
            <Show when={footerAction()}>
              {(action) => (
                <span class={PALETTE_HINT}>
                  <kbd class={PALETTE_KBD}>Enter</kbd> {action()}
                </span>
              )}
            </Show>
            <Show when={stack().length > 1}>
              <span class={PALETTE_HINT}>
                <kbd class={PALETTE_KBD}>Backspace</kbd> Back
              </span>
            </Show>
            <span class={PALETTE_HINT}>
              <kbd class={PALETTE_KBD}>Esc</kbd> Close
            </span>
          </footer>
        </div>
      </div>
    </Portal>
  );
}
