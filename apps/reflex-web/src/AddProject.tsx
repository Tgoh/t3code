import {
  getCloneDirectoryLeafName,
  getNewProjectPathPreview,
  normalizePastedCloneUrl,
  resolveAddProjectPath,
} from "@t3tools/client-runtime/operations/projects";
import {
  getFilesystemBrowsePath,
  getFilesystemBrowseTabCompletion,
} from "@t3tools/client-runtime/state/filesystem";
import { type IActionGenerator, type IEntity, latest } from "treflex";
import { useComponentState } from "treflex-solid";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  onMount,
  Show,
  Switch,
} from "solid-js";

import {
  browsePlatform,
  chosenFolder,
  defaultCloneDestination,
  enterFolder,
  folderChoices,
  initialFolderQuery,
  leaveFolder,
} from "./addProjectPaths";
import Environment from "./Environment";
import { CornerLeftUp, Folder } from "./icons";
import {
  addProjectSettingsEffect,
  browseFoldersEffect,
  type IAddProjectSettings,
  type IFolderListing,
} from "./Infrastructure/commandEffects";

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

const UNKNOWN_SETTINGS: IAddProjectSettings = {
  BaseDirectory: "",
  GhqCloneLayout: false,
  NewProjectsRoot: null,
  Os: "",
};

interface IAddProjectPanel extends IEntity {
  Settings: IAddProjectSettings | null;
  SettingsError: string | null;
}

function* loadSettings(draft: IAddProjectPanel, environmentId: string): IActionGenerator {
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

function* browse(draft: IFolderPicker, environmentId: string, path: string): IActionGenerator {
  draft.Path = path;
  draft.Listing = null;
  draft.Error = null;
  try {
    draft.Listing = yield* browseFoldersEffect({ EnvironmentId: environmentId, PartialPath: path });
  } catch (error) {
    draft.Error = errorText(error);
  }
}
latest(browse);

type IMode = "folder" | "clone" | "new";

export function AddProjectPanel(props: { onClose: () => void }) {
  const environment = Environment.use();
  const panel = useComponentState<IAddProjectPanel>(() => ({
    Settings: null,
    SettingsError: null,
  }));
  onMount(() => panel.dispatch(loadSettings, environment.state.EnvironmentId));
  const [mode, setMode] = createSignal<IMode>("folder");
  const settings = () =>
    panel.state.Settings ?? (panel.state.SettingsError === null ? null : UNKNOWN_SETTINGS);
  const modes = (): Array<{ Id: IMode; Label: string }> => [
    { Id: "folder", Label: "Folder" },
    { Id: "clone", Label: "Clone" },
    ...(settings()?.NewProjectsRoot == null ? [] : [{ Id: "new" as const, Label: "New" }]),
  ];
  return (
    <div
      class="add-project"
      onKeyDown={(event) => {
        if (event.key === "Escape") props.onClose();
      }}
    >
      <div class="add-project-modes" role="tablist" aria-label="Add project">
        <For each={modes()}>
          {(option) => (
            <button
              type="button"
              role="tab"
              class="add-project-mode"
              classList={{ selected: mode() === option.Id }}
              aria-selected={mode() === option.Id}
              onClick={() => setMode(option.Id)}
            >
              {option.Label}
            </button>
          )}
        </For>
      </div>
      <Show when={panel.state.SettingsError}>
        {(error) => (
          <p class="add-project-note">Couldn't read the server's project settings: {error()}</p>
        )}
      </Show>
      <Show when={settings()} fallback={<p class="add-project-note">Loading…</p>} keyed>
        {(held) => (
          <Switch>
            <Match when={mode() === "folder"}>
              <AddFolder settings={held} onDone={props.onClose} />
            </Match>
            <Match when={mode() === "clone"}>
              <CloneRepository settings={held} onDone={props.onClose} />
            </Match>
            <Match when={mode() === "new" && held.NewProjectsRoot}>
              {(root) => <NewProject root={root()} onDone={props.onClose} />}
            </Match>
          </Switch>
        )}
      </Show>
    </div>
  );
}

function AddFolder(props: { settings: IAddProjectSettings; onDone: () => void }) {
  const environment = Environment.use();
  const [error, setError] = createSignal<string | null>(null);
  const platform = () => browsePlatform(props.settings.Os);
  const submit = async (rawPath: string) => {
    const resolved = resolveAddProjectPath({ rawPath, platform: platform() });
    if (!resolved.ok) return setError(resolved.error);
    setError(null);
    const failure = await environment.addFolder(resolved.path);
    if (failure === null) props.onDone();
    else if (failure !== undefined) setError(failure);
  };
  return (
    <FolderPicker
      initialQuery={initialFolderQuery(props.settings)}
      platform={platform()}
      cloneFolder=""
      label="Project folder"
      submitLabel="Add"
      error={error()}
      onSubmit={submit}
    />
  );
}

function CloneRepository(props: { settings: IAddProjectSettings; onDone: () => void }) {
  const environment = Environment.use();
  const [url, setUrl] = createSignal("");
  const [remoteUrl, setRemoteUrl] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const platform = () => browsePlatform(props.settings.Os);
  const submit = async (remote: string, rawPath: string) => {
    const resolved = resolveAddProjectPath({ rawPath, platform: platform() });
    if (!resolved.ok) return setError(resolved.error);
    setError(null);
    const failure = await environment.cloneProject(remote, resolved.path);
    if (failure === null) props.onDone();
    else if (failure !== undefined) setError(failure);
  };
  return (
    <Show
      when={remoteUrl()}
      keyed
      fallback={
        <form
          class="add-project-row"
          onSubmit={(event) => {
            event.preventDefault();
            const raw = url().trim();
            if (raw !== "") setRemoteUrl(normalizePastedCloneUrl(raw));
          }}
        >
          <input
            class="card-rename"
            aria-label="Repository"
            placeholder="Git URL or repository page"
            spellcheck={false}
            autocomplete="off"
            value={url()}
            ref={(input) => queueMicrotask(() => input.focus())}
            onInput={(event) => setUrl(event.currentTarget.value)}
          />
          <button type="submit" class="button" disabled={url().trim() === ""}>
            Next
          </button>
        </form>
      }
    >
      {(remote) => (
        <>
          <p class="add-project-note add-project-remote">
            <span data-tip={remote}>{remote}</span>
            <button
              type="button"
              class="card-action"
              onClick={() => {
                setError(null);
                setRemoteUrl(null);
              }}
            >
              Change
            </button>
          </p>
          <FolderPicker
            initialQuery={defaultCloneDestination(props.settings, remote)}
            platform={platform()}
            cloneFolder={getCloneDirectoryLeafName(remote, props.settings.GhqCloneLayout)}
            label="Clone into"
            submitLabel="Clone"
            error={error()}
            onSubmit={(path) => submit(remote, path)}
          />
        </>
      )}
    </Show>
  );
}

function NewProject(props: { root: string; onDone: () => void }) {
  const environment = Environment.use();
  const [name, setName] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const trimmed = () => name().trim();
  const submit = async () => {
    if (trimmed() === "" || environment.addingProject()) return;
    setError(null);
    const failure = await environment.newProject(trimmed());
    if (failure === null) props.onDone();
    else if (failure !== undefined) setError(failure);
  };
  return (
    <>
      <form
        class="add-project-row"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <input
          class="card-rename"
          aria-label="Project name"
          placeholder="Project name"
          autocomplete="off"
          value={name()}
          ref={(input) => queueMicrotask(() => input.focus())}
          onInput={(event) => setName(event.currentTarget.value)}
        />
        <button
          type="submit"
          class="button"
          disabled={trimmed() === "" || environment.addingProject()}
        >
          Create
        </button>
      </form>
      <p class="add-project-note">
        {trimmed() === ""
          ? `Goes in ${props.root}`
          : `Creates ${getNewProjectPathPreview(props.root, trimmed())}`}
      </p>
      <Show when={error()}>{(shown) => <p class="add-project-error">{shown()}</p>}</Show>
    </>
  );
}

function FolderPicker(props: {
  initialQuery: string;
  platform: string;
  cloneFolder: string;
  label: string;
  submitLabel: string;
  error: string | null;
  onSubmit: (path: string) => void;
}) {
  const environment = Environment.use();
  const picker = useComponentState<IFolderPicker>(() => ({
    Path: null,
    Listing: null,
    Error: null,
  }));
  const [input, setInput] = createSignal<HTMLInputElement>();
  createEffect(() => {
    const element = input();
    element?.focus();
    element?.setSelectionRange(element.value.length, element.value.length);
  });
  const [query, setQuery] = createSignal(props.initialQuery);
  const directory = createMemo(() => {
    const browsed = getFilesystemBrowsePath(query(), props.platform);
    return browsed.isBrowsing ? browsed.directoryPath : "";
  });
  createEffect(() => {
    const path = directory();
    if (path !== "") picker.dispatch(browse, environment.state.EnvironmentId, path);
  });
  const listing = () => (picker.state.Path === directory() ? picker.state.Listing : null);
  const choices = createMemo(() =>
    folderChoices({
      query: query(),
      platform: props.platform,
      entries: listing()?.Entries ?? [],
      cloneFolder: props.cloneFolder,
    }),
  );
  const go = (next: string) => {
    setQuery(next);
    input()?.focus();
  };
  const open = (name: string) =>
    go(
      enterFolder({
        query: query(),
        directoryPath: choices().browse.directoryPath,
        name,
        cloneFolder: props.cloneFolder,
        platform: props.platform,
      }),
    );
  const up = () => {
    const parent = choices().browse.parentPath;
    if (parent !== null) go(leaveFolder(parent, props.cloneFolder));
  };
  const complete = () => {
    const completion = getFilesystemBrowseTabCompletion(
      choices().visibleEntries,
      choices().browse.filterQuery,
    );
    if (completion?.isComplete) open(completion.name);
    else if (completion !== null && props.cloneFolder === "")
      go(`${choices().browse.directoryPath}${completion.name}`);
  };
  const busy = () => environment.addingProject();
  return (
    <form
      class="add-project-browse"
      onSubmit={(event) => {
        event.preventDefault();
        if (query().trim() === "" || busy()) return;
        props.onSubmit(chosenFolder(query(), listing(), choices().exactEntry));
      }}
    >
      <div class="add-project-row">
        <input
          class="card-rename"
          aria-label={props.label}
          spellcheck={false}
          autocomplete="off"
          value={query()}
          ref={setInput}
          onInput={(event) => setQuery(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key !== "Tab" || event.shiftKey || event.isComposing) return;
            if (!choices().browse.isBrowsing) return;
            event.preventDefault();
            complete();
          }}
        />
        <button type="submit" class="button" disabled={query().trim() === "" || busy()}>
          {props.submitLabel}
        </button>
      </div>
      <Show when={props.error}>{(shown) => <p class="add-project-error">{shown()}</p>}</Show>
      <Show when={choices().browse.isBrowsing}>
        <ul class="folder-list">
          <Show when={choices().browse.canBrowseUp}>
            <li>
              <button
                type="button"
                class="folder-entry"
                onMouseDown={(event) => event.preventDefault()}
                onClick={up}
              >
                <CornerLeftUp />
                <span>..</span>
              </button>
            </li>
          </Show>
          <For each={choices().visibleEntries}>
            {(entry) => (
              <li>
                <button
                  type="button"
                  class="folder-entry"
                  data-tip={entry.fullPath}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => open(entry.name)}
                >
                  <Folder />
                  <span>{entry.name}</span>
                </button>
              </li>
            )}
          </For>
        </ul>
        <Show
          when={picker.state.Error}
          fallback={
            <Show when={listing()} fallback={<p class="add-project-note">Loading folders…</p>}>
              <Show when={choices().visibleEntries.length === 0}>
                <p class="add-project-note">No folders here.</p>
              </Show>
            </Show>
          }
        >
          {(failure) => <p class="add-project-error">Couldn't list this folder: {failure()}</p>}
        </Show>
      </Show>
    </form>
  );
}
