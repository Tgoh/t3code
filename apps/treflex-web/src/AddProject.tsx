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
  createUniqueId,
  For,
  Match,
  Show,
  Switch,
  untrack,
} from "solid-js";
import type { JSX } from "@solidjs/web";

import {
  CommandPaletteContent,
  ITEM_ICON_CLASS,
  PaletteBackButton,
  PaletteEmptyState,
  PaletteResultRow,
  PaletteSubmitButton,
  PaletteTitleIcon,
} from "./CommandPaletteContent";
import {
  browsePlatform,
  browseTarget,
  chosenFolder,
  defaultCloneDestination,
  enterFolder,
  folderChoices,
  type IAddProjectSettings,
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
import Environment, { AddingProject } from "./Environment";
import { serverError } from "./Infrastructure/serverError";
import { arrowStep, stepHighlight } from "./listNavigation";
import { CornerLeftUp, Folder, FolderGit2, FolderPlus, Link } from "./icons";
import { toastManager } from "./ui/toastStore";
import { browseFoldersEffect, type IFolderListing } from "./Infrastructure/commandEffects";
import {
  CommandDialog,
  CommandDialogPopup,
  CommandGroup,
  CommandList,
  type ICommandInputEndInset,
} from "./ui/Command";

const failed = (title: string, description: string) =>
  toastManager.add({ type: "error", title, description });

const SUMMARY_ROW = "flex min-h-8 items-center gap-2 rounded-sm px-2 py-1.5";
const SUMMARY_TEXT = "flex min-w-0 flex-1 flex-col";
const SUMMARY_TITLE = "truncate text-foreground text-sm";
const SUMMARY_DETAIL = "truncate text-muted-foreground/85 text-xs";
const DESCRIPTION = "min-w-0 text-muted-foreground/70 text-xs";
const STATUS = "px-4 py-3 text-sm text-muted-foreground";

const UNKNOWN_SETTINGS: IAddProjectSettings = {
  BaseDirectory: "",
  GhqCloneLayout: false,
  NewProjectsRoot: null,
  Os: "",
};

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
    draft.Error = serverError(error).message;
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
  new: () => <FolderGit2 class={ITEM_ICON_CLASS} />,
  local: () => <FolderPlus class={ITEM_ICON_CLASS} />,
  url: () => <Link class={ITEM_ICON_CLASS} />,
};

const isMac = () => typeof navigator !== "undefined" && navigator.platform.startsWith("Mac");
const modifierLabel = () => (isMac() ? "⌘" : "Ctrl");

export function AddProjectPalette(props: { onClose: () => void }) {
  const environment = Environment.use();
  const listId = createUniqueId();
  const submitId = createUniqueId();
  const settings = () => environment.addProjectSettings();
  const cwd = () => environment.currentProjectRoot();
  const platform = () => browsePlatform(settings()?.Os ?? "");
  const busy = useInFlight(AddingProject, () => environment.state);

  const [stack, setStack] = createSignal<IView[]>([{ Kind: "sources" }]);
  const view = () => stack().at(-1)!;
  const [query, setQuery] = createSignal("");
  const [highlight, setHighlight] = createSignal<number | null>(0);
  const [input, setInput] = createSignal<HTMLInputElement>();
  const [list, setList] = createSignal<HTMLElement>();

  const focusInput = () =>
    queueMicrotask(() => {
      const element = input();
      element?.focus();
      element?.setSelectionRange(element.value.length, element.value.length);
    });

  const initialQuery = (next: IView): string => {
    const held = settings() ?? UNKNOWN_SETTINGS;
    if (next.Kind === "folder") return initialFolderQuery(held);
    if (next.Kind === "clone-dest") return defaultCloneDestination(held, next.Remote);
    return "";
  };
  const show = (next: IView[]) => {
    setStack(next);
    changeQuery(initialQuery(next.at(-1)!), next.at(-1)!);
    setHighlight(next.at(-1)!.Kind === "sources" ? 0 : null);
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
  const directoryOf = (held: IView, text: string) =>
    held.Kind === "folder" || held.Kind === "clone-dest"
      ? browseTarget(text, platform(), cwd())
      : "";
  const directory = createMemo(() => directoryOf(view(), query()));
  const browsed = { Path: "" };
  const browseDirectory = (path = directory()) => {
    if (path === browsed.Path) return;
    browsed.Path = path;
    if (path !== "") void picker.dispatch(browse, environment.state.EnvironmentId, path, cwd());
  };
  const changeQuery = (next: string, held = view()) => {
    setQuery(next);
    browseDirectory(directoryOf(held, next));
  };
  // The folder view's target depends on the platform the config reports, which can arrive late.
  createEffect(platform, () => untrack(browseDirectory), { defer: true });
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
    changeQuery(next);
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
    const current = view();
    // Follows reportProjectFailure and the clone failures in apps/web/src/components/CommandPalette.tsx.
    const title = current.Kind === "clone-dest" ? "Clone failed" : "Failed to add project";
    if (!resolved.ok) return failed(title, resolved.error);
    const failure =
      current.Kind === "clone-dest"
        ? await environment.cloneProject(current.Remote, resolved.path)
        : await environment.addFolder(resolved.path);
    if (failure === null) props.onClose();
    else if (failure !== undefined) failed(title, failure);
  };

  const continueClone = () => {
    const raw = query().trim();
    if (raw !== "") push({ Kind: "clone-dest", Remote: normalizePastedCloneUrl(raw) });
  };

  const newProjectName = () => query().trim();
  const submitNew = async () => {
    const created = newProjectName();
    if (created === "" || busy()) return;
    const outcome = await environment.newProject(created);
    if (outcome === undefined) return;
    // Follows the toasts in apps/web/src/hooks/useNewProject.ts.
    if ("Error" in outcome) return failed("Could not create the project", outcome.Error);
    toastManager.add(
      outcome.CommitError === null
        ? { type: "success", title: `Created ${created}`, description: outcome.WorkspaceRoot }
        : {
            type: "warning",
            title: `Created ${created} without a first commit`,
            description: `${outcome.CommitError} The project is in ${outcome.WorkspaceRoot}.`,
          },
    );
    props.onClose();
  };

  const rowCount = () =>
    view().Kind === "sources" ? sources().length : browsing() ? rows().length : 0;
  createEffect(sources, (listed) => {
    if (untrack(view).Kind === "sources") setHighlight(listed.length === 0 ? null : 0);
  });
  createEffect(highlight, (held) => {
    if (held === null) return;
    untrack(list)?.querySelector(`[data-row="${held}"]`)?.scrollIntoView({ block: "nearest" });
  });

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.isComposing || event.keyCode === 229) return;
    const current = view();
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
    if (pending() || listingError() !== null) return null;
    if (browsing() && directory() !== "") return "No folders here.";
    if (kind === "sources") return "No matching sources.";
    return null;
  };

  const endInset = (): ICommandInputEndInset => {
    const kind = view().Kind;
    if (kind === "clone-url" || kind === "new") return "lg";
    if (!browsing()) return "none";
    if (willCreate()) return "xl";
    return highlight() === null ? "sm" : "md";
  };
  const rowId = (index: number) => `${listId}-${index}`;
  const activeRow = () => {
    const held = highlight();
    return held === null || rowCount() === 0 ? undefined : rowId(held);
  };

  return (
    <CommandDialog onClose={props.onClose}>
      <CommandDialogPopup aria-label="Add project" class="overflow-hidden">
        <CommandPaletteContent
          inputProps={{
            "aria-label": view().Kind === "sources" ? "Search sources" : placeholder() || "Path",
            placeholder: placeholder(),
            "aria-controls": settings() && rowCount() > 0 ? listId : undefined,
            "aria-activedescendant": activeRow(),
            "aria-describedby": accessory() === null ? undefined : submitId,
            value: query(),
            ref: setInput,
            onInput: (event) => {
              changeQuery(event.currentTarget.value);
              if (browsing()) setHighlight(null);
            },
            onKeyDown,
          }}
          startAddon={
            <Show when={stack().length > 1} fallback={<FolderPlus />}>
              <PaletteBackButton onClick={back} />
            </Show>
          }
          endInset={endInset()}
          inputAccessory={
            <Show when={accessory()}>
              {(button) => (
                <PaletteSubmitButton
                  id={submitId}
                  label={button().Label}
                  shortcutLabel={shortcut()}
                  ariaLabel={`${button().Label} (${shortcut()})`}
                  disabled={button().Disabled}
                  onSubmit={() => button().Run()}
                />
              )}
            </Show>
          }
          footerActionLabel={footerAction()}
          showBackHint={stack().length > 1}
        >
          <Show when={settings()} fallback={<div class={STATUS}>Loading…</div>}>
            <Switch>
              <Match when={cloneRemote()}>
                {(remote) => (
                  <div class="shrink-0 p-2 pb-0">
                    <div class="px-2 py-1.5 font-medium text-muted-foreground text-xs">
                      Repository
                    </div>
                    <div class={SUMMARY_ROW}>
                      <PaletteTitleIcon>
                        <Link class={ITEM_ICON_CLASS} />
                      </PaletteTitleIcon>
                      <span class={SUMMARY_TEXT}>
                        <span class={SUMMARY_TITLE}>{cloneFolder()}</span>
                        <span class={SUMMARY_DETAIL}>{remote()}</span>
                      </span>
                    </div>
                  </div>
                )}
              </Match>
              <Match when={view().Kind === "new" && settings()?.NewProjectsRoot}>
                {(root) => (
                  <div class="p-2 pb-0">
                    <div class={SUMMARY_ROW}>
                      <PaletteTitleIcon>
                        <FolderGit2 class={ITEM_ICON_CLASS} />
                      </PaletteTitleIcon>
                      <span class={SUMMARY_TEXT}>
                        <span class={SUMMARY_TITLE}>
                          {newProjectName() === "" ? "New project" : newProjectName()}
                        </span>
                        <span class={SUMMARY_DETAIL}>
                          {newProjectName() === ""
                            ? `Goes in ${root()}`
                            : `Creates ${getNewProjectPathPreview(root(), newProjectName())}`}
                        </span>
                      </span>
                    </div>
                  </div>
                )}
              </Match>
            </Switch>
            <Show when={listingError()}>
              {(failure) => (
                <div role="alert" class={STATUS}>
                  Couldn't list this folder: {failure()}
                </div>
              )}
            </Show>
            <Show when={pending()}>
              <div role="status" class={STATUS}>
                Loading folders…
              </div>
            </Show>
            <Show
              when={rowCount() > 0}
              fallback={
                <Show when={emptyMessage()}>
                  {(message) => <PaletteEmptyState message={message()} />}
                </Show>
              }
            >
              <CommandList id={listId} ref={setList}>
                <Show when={view().Kind === "sources"}>
                  <CommandGroup label="Sources">
                    <For each={sources()}>
                      {(source, index) => (
                        <PaletteResultRow
                          id={rowId(index())}
                          index={index()}
                          active={highlight() === index()}
                          icon={SOURCE_ICONS[source.Id]()}
                          title={source.Title}
                          detail={<span class={DESCRIPTION}>{source.Description}</span>}
                          onHover={() => setHighlight(index())}
                          onChoose={() => runSource(source.Id)}
                        />
                      )}
                    </For>
                  </CommandGroup>
                </Show>
                <Show when={browsing()}>
                  <CommandGroup
                    label={view().Kind === "clone-dest" ? "Select where to clone" : "Directories"}
                  >
                    <For each={rows()}>
                      {(row, index) => (
                        <PaletteResultRow
                          id={rowId(index())}
                          index={index()}
                          active={highlight() === index()}
                          icon={
                            row.Kind === "up" ? (
                              <CornerLeftUp class={ITEM_ICON_CLASS} />
                            ) : (
                              <Folder class={ITEM_ICON_CLASS} />
                            )
                          }
                          title={row.Kind === "up" ? ".." : row.Name}
                          tip={row.Kind === "folder" ? row.FullPath : undefined}
                          onHover={() => setHighlight(index())}
                          onChoose={() => openRow(row)}
                        />
                      )}
                    </For>
                  </CommandGroup>
                </Show>
              </CommandList>
            </Show>
          </Show>
        </CommandPaletteContent>
      </CommandDialogPopup>
    </CommandDialog>
  );
}
