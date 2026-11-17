// @effect-diagnostics globalDate:off -- View-only relative times, outside any Effect runtime.
import type { ResolvedKeybindingsConfig } from "@t3tools/contracts";
import { createMemo, createSignal, For, type JSX, Match, onCleanup, Show, Switch } from "solid-js";
import { Dynamic } from "solid-js/web";

import { ProjectBadge, ProviderIcon } from "./brand";
import type { IAppearanceMode } from "./colorScheme";
import Environment from "./Environment";
import * as Icons from "./icons";
import type { IWireArchivedShell } from "./Infrastructure/settings";
import type { IWireProject } from "./Infrastructure/wire";
import { keybindingGroups, keyCaps } from "./keybindingRows";
import { arrowStep, stepHighlight } from "./listNavigation";
import { RemoveProjectDialog } from "./ProjectFolder";
import {
  allBuiltInHidden,
  bulkHiddenPatch,
  filterModels,
  type IProviderRow,
  MODEL_FILTER_THRESHOLD,
  modelFavoritePatch,
  modelHiddenPatch,
  modelMovePatch,
  providerEnabledWrite,
  providerRows,
} from "./providerSettings";
import {
  builtSettingsPage,
  type ISettingRow,
  type ISettingsHeld,
  type ISettingsSection,
  type ISettingValue,
  SETTINGS_NAV,
  type ISettingsSearchItem,
  searchSettings,
  SETTINGS_SECTIONS,
  settingsPageOf,
  settingsSearchItems,
} from "./settingsPages";
import Shell from "./Shell";
import { SidebarToggle } from "./Sidebar";
import { clockNow, relativeTime } from "./timestamps";
import { Button, button, buttonLink } from "./ui/Button";
import { Input, Select, Textarea } from "./ui/Field";
import { IconButton } from "./ui/IconButton";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/Modal";
import { Switch as Toggle } from "./ui/Switch";

const PRIVACY_POLICY_URL = "https://t3.codes/privacy-policy";

export function SettingsView(props: { page: string }) {
  const environment = Environment.use();
  const page = () => builtSettingsPage(props.page);
  const label = () => settingsPageOf(page())?.Label ?? "";
  return (
    <div class="settings-view">
      <header class="thread-header settings-header">
        <SidebarToggle />
        <div class="breadcrumb">
          <span class="crumb-project">Settings</span>
          <span class="crumb-separator">/</span>
          <h1>{label()}</h1>
        </div>
        <IconButton
          aria-label="Close settings"
          data-tip="Close"
          onClick={() => environment.openView(null)}
        >
          <Icons.X />
        </IconButton>
      </header>
      <div class="settings-body">
        <SettingsNav page={page()} />
        <div class="settings-content">
          <div class="settings-column">
            <Switch>
              <Match when={page() === "appearance"}>
                <ColorSchemeSection />
                <Sections sections={SETTINGS_SECTIONS.appearance} />
              </Match>
              <Match when={page() === "general"}>
                <Sections sections={SETTINGS_SECTIONS.general} />
              </Match>
              <Match when={page() === "chat"}>
                <Sections sections={SETTINGS_SECTIONS.chat} />
              </Match>
              <Match when={page() === "threads"}>
                <Sections sections={SETTINGS_SECTIONS.threads} />
              </Match>
              <Match when={page() === "providers"}>
                <ProvidersPage />
              </Match>
              <Match when={page() === "projects"}>
                <ProjectsPage state={environment.state.Replica.Shell} />
              </Match>
              <Match when={page() === "keybindings"}>
                <KeybindingsPage />
              </Match>
              <Match when={page() === "archived"}>
                <ArchivedPage />
              </Match>
              <Match when={page() === "about"}>
                <AboutPage />
              </Match>
            </Switch>
          </div>
        </div>
      </div>
    </div>
  );
}

const SEARCH_ITEMS = settingsSearchItems();

const navItem =
  "flex cursor-pointer gap-2 rounded-lg border-0 bg-transparent px-2 text-left text-[14px] text-muted-foreground hover:not-disabled:bg-accent hover:not-disabled:text-foreground disabled:cursor-default disabled:opacity-45 aria-selected:bg-accent aria-selected:font-medium aria-selected:text-foreground aria-[current=page]:bg-accent aria-[current=page]:font-medium aria-[current=page]:text-foreground max-md:justify-center";
const navGroup = "flex flex-col gap-0.5";

function SettingsNav(props: { page: string }) {
  const environment = Environment.use();
  const [query, setQuery] = createSignal("");
  const [active, setActive] = createSignal(0);
  const results = createMemo(() => searchSettings(SEARCH_ITEMS, query()));
  const searching = () => query().trim() !== "";
  const [searchBox, setSearchBox] = createSignal<HTMLInputElement>();
  const open = (item: ISettingsSearchItem) => {
    setQuery("");
    void environment
      .openView({ Kind: "settings", Page: item.Page })
      .then(() =>
        queueMicrotask(() =>
          document
            .querySelector(`[data-setting-id="${item.Id}"]`)
            ?.scrollIntoView({ block: "center" }),
        ),
      );
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    const editing =
      target !== null &&
      (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
    if (event.key === "/" && !editing && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      searchBox()?.focus();
    }
  };
  document.addEventListener("keydown", onKeyDown);
  onCleanup(() => document.removeEventListener("keydown", onKeyDown));
  return (
    <nav
      class="flex w-60 flex-none flex-col gap-4 overflow-y-auto border-r px-2 py-3 max-md:w-14 max-md:overflow-x-hidden"
      aria-label="Settings pages"
    >
      <div class="flex h-8 items-center gap-2 rounded-lg pr-1 pl-2 text-muted-foreground focus-within:bg-accent hover:bg-accent max-md:hidden">
        <Icons.Search />
        <input
          ref={setSearchBox}
          class="min-w-0 flex-1 border-0 bg-transparent text-[14px] text-foreground outline-none"
          type="text"
          placeholder="Search"
          aria-label="Search settings"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={searching() && results().length > 0}
          value={query()}
          onInput={(event) => {
            setQuery(event.currentTarget.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") setQuery("");
            if (!searching()) return;
            const step = arrowStep(event.key);
            if (step !== null) {
              event.preventDefault();
              setActive(stepHighlight(active(), results().length, step) ?? active());
            }
            if (event.key === "Enter") {
              const item = results()[active()];
              if (item !== undefined) open(item);
            }
          }}
        />
        <Show
          when={searching()}
          fallback={<kbd class="rounded-sm border bg-muted px-[5px] font-sans text-[11px]">/</kbd>}
        >
          <IconButton
            size="sm"
            aria-label="Clear settings search"
            onClick={() => {
              setQuery("");
              searchBox()?.focus();
            }}
          >
            <Icons.X />
          </IconButton>
        </Show>
      </div>
      <Show when={searching()}>
        <Show
          when={results().length > 0}
          fallback={
            <p class="m-0 px-2 py-6 text-center text-[12px] text-muted-foreground" role="status">
              No settings found
            </p>
          }
        >
          <div class={navGroup} role="listbox" aria-label="Settings search results">
            <For each={results()}>
              {(item, index) => (
                <button
                  class={`${navItem} min-h-10 items-start pt-1.5 pb-1`}
                  role="option"
                  aria-selected={index() === active()}
                  tabindex="-1"
                  onMouseMove={() => setActive(index())}
                  onClick={() => open(item)}
                >
                  <Dynamic component={Icons[settingsPageOf(item.Page)?.Icon ?? "Settings2"]} />
                  <span class="flex min-w-0 flex-col max-md:hidden">
                    <span class="truncate font-medium text-foreground">{item.Title}</span>
                    <span class="text-[11px]">{settingsPageOf(item.Page)?.Label}</span>
                  </span>
                </button>
              )}
            </For>
          </div>
        </Show>
      </Show>
      <Show when={!searching()}>
        <For each={SETTINGS_NAV}>
          {(group) => (
            <div class={navGroup}>
              <Show when={group.Group}>
                {(title) => (
                  <span class="px-2 py-1 text-[12px] font-medium text-muted-foreground max-md:hidden">
                    {title()}
                  </span>
                )}
              </Show>
              <For each={group.Pages}>
                {(entry) => (
                  <button
                    class={`${navItem} h-8 items-center py-0`}
                    aria-current={props.page === entry.Id ? "page" : undefined}
                    disabled={!entry.Built}
                    data-tip={entry.Built ? undefined : "Not in this client yet"}
                    onClick={() => environment.openView({ Kind: "settings", Page: entry.Id })}
                  >
                    <Dynamic component={Icons[entry.Icon]} />
                    <span class="max-md:hidden">{entry.Label}</span>
                  </button>
                )}
              </For>
            </div>
          )}
        </For>
      </Show>
    </nav>
  );
}

export function SettingsSection(props: {
  title: string;
  action?: JSX.Element;
  plain?: boolean;
  children: JSX.Element;
}) {
  return (
    <section class="settings-section">
      <div class="settings-section-head">
        <h2>{props.title}</h2>
        {props.action}
      </div>
      <div class="settings-group" classList={{ plain: props.plain === true }}>
        {props.children}
      </div>
    </section>
  );
}

export function SettingsRowFrame(props: {
  title: JSX.Element;
  description?: JSX.Element;
  control?: JSX.Element;
  muted?: boolean;
  settingId?: string;
}) {
  return (
    <div
      class="settings-row"
      classList={{ muted: props.muted === true }}
      data-setting-id={props.settingId}
    >
      <div class="settings-row-text">
        <div class="settings-row-title">{props.title}</div>
        <Show when={props.description}>
          <p class="settings-row-description">{props.description}</p>
        </Show>
      </div>
      <Show when={props.control}>
        <div class="settings-row-control">{props.control}</div>
      </Show>
    </div>
  );
}

function useHeld(): () => ISettingsHeld | null {
  const environment = Environment.use();
  return () => {
    const client = environment.state.Local.ClientSettings;
    if (client === null) return null;
    return { Server: environment.state.Replica.Config?.settings ?? null, Client: client };
  };
}

function Sections(props: { sections: ISettingsSection[] }) {
  const held = useHeld();
  return (
    <Show when={held()} fallback={<p class="settings-loading">Loading settings…</p>}>
      {(current) => (
        <For each={props.sections}>
          {(section) => (
            <SettingsSection title={section.Title}>
              <For each={section.Rows.filter((row) => row.Visible?.(current()) ?? true)}>
                {(row) => <SettingRowView row={row} held={current()} />}
              </For>
            </SettingsSection>
          )}
        </For>
      )}
    </Show>
  );
}

function SettingRowView(props: { row: ISettingRow; held: ISettingsHeld }) {
  const environment = Environment.use();
  const value = () => props.row.Read(props.held);
  const write = (next: ISettingValue) => void environment.writeSetting(props.row.Write(next));
  const control = (): JSX.Element => {
    const control = props.row.Control;
    const current = value();
    if (current === null) return <span class="settings-unavailable">Unavailable</span>;
    switch (control.Kind) {
      case "switch":
        return <Toggle checked={current === true} label={props.row.Title} onChange={write} />;
      case "select":
        return (
          <Select
            class="min-w-44"
            aria-label={props.row.Title}
            value={String(current)}
            onChange={(event) => write(event.currentTarget.value)}
          >
            <For each={control.Options}>
              {(option) => <option value={option.Value}>{option.Label}</option>}
            </For>
          </Select>
        );
      case "number":
        return (
          <Input
            class="w-20 min-w-0"
            type="number"
            min={control.Min}
            max={control.Max}
            aria-label={props.row.Title}
            value={String(current)}
            onChange={(event) => write(Number(event.currentTarget.value))}
          />
        );
      case "text":
        return (
          <Input
            class="min-w-44"
            aria-label={props.row.Title}
            placeholder={control.Placeholder}
            value={String(current)}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
            onBlur={(event) => {
              if (event.currentTarget.value !== current) write(event.currentTarget.value);
            }}
          />
        );
      case "textarea":
        return (
          <Textarea
            class="min-w-72 max-md:w-full max-md:min-w-0"
            aria-label={props.row.Title}
            placeholder={control.Placeholder}
            value={String(current)}
            onBlur={(event) => {
              if (event.currentTarget.value !== current) write(event.currentTarget.value);
            }}
          />
        );
    }
  };
  return (
    <SettingsRowFrame
      title={
        <>
          {props.row.Title}
          <Show when={!props.row.Applied}>
            <span
              class="settings-badge"
              data-tip="Saved in this browser as stock saves it, but this client doesn't use it yet."
            >
              Not used here yet
            </span>
          </Show>
        </>
      }
      description={props.row.Description}
      settingId={props.row.Id}
      control={control()}
    />
  );
}

const APPEARANCE_MODES: Array<{ Mode: IAppearanceMode; Label: string }> = [
  { Mode: "system", Label: "System" },
  { Mode: "light", Label: "Light" },
  { Mode: "dark", Label: "Dark" },
];

// Follows the color scheme tiles in apps/web/src/components/settings/ThemeSettings.tsx.
function ColorSchemeSection() {
  const environment = Environment.use();
  return (
    <section class="settings-section">
      <div class="settings-section-head">
        <h2>Color scheme</h2>
      </div>
      <div class="scheme-tiles" role="radiogroup" aria-label="Color scheme">
        <For each={APPEARANCE_MODES}>
          {(entry) => (
            <button
              class="scheme-tile"
              role="radio"
              aria-checked={environment.state.Local.Preferences.AppearanceMode === entry.Mode}
              onClick={() => void environment.setAppearanceMode(entry.Mode)}
            >
              <span class={`scheme-preview ${entry.Mode}`}>
                <span class="scheme-preview-bar" />
                <span class="scheme-preview-line" />
                <span class="scheme-preview-line short" />
              </span>
              <span class="scheme-label">{entry.Label}</span>
            </button>
          )}
        </For>
      </div>
    </section>
  );
}

function ProvidersPage() {
  const environment = Environment.use();
  const config = () => environment.state.Replica.Config;
  const rows = createMemo(() => {
    const held = config();
    return held === null ? [] : providerRows(held);
  });
  const [selected, setSelected] = createSignal<string | null>(null);
  const current = () => rows().find((row) => row.InstanceId === selected()) ?? rows()[0] ?? null;
  const [modelFilter, setModelFilter] = createSignal("");
  const modelCount = (row: IProviderRow) => {
    const favorites = row.Models.filter((model) => model.Favorite).length;
    const hidden = row.Models.filter((model) => model.Hidden).length;
    return [
      `${row.Models.length} model${row.Models.length === 1 ? "" : "s"}`,
      ...(favorites > 0 ? [`${favorites} favorite${favorites === 1 ? "" : "s"}`] : []),
      ...(hidden > 0 ? [`${hidden} hidden`] : []),
    ].join(" · ");
  };
  return (
    <Show when={config()} fallback={<p class="settings-loading">Loading providers…</p>}>
      {(held) => (
        <>
          <SettingsSection title="Providers" plain>
            <div class="providers-layout">
              <ul class="provider-list">
                <For each={rows()}>
                  {(row) => (
                    <li
                      class="provider-list-row"
                      classList={{ active: current()?.InstanceId === row.InstanceId }}
                    >
                      <button
                        class="provider-list-pick"
                        onClick={() => {
                          setSelected(row.InstanceId);
                          setModelFilter("");
                        }}
                      >
                        <ProviderIcon driver={row.Driver} size={16} />
                        <span class="provider-list-text">
                          <span class="provider-list-name">
                            {row.Name}
                            <Show when={row.Version}>
                              {(version) => <code class="provider-version">v{version()}</code>}
                            </Show>
                          </span>
                          <span class="provider-list-headline">
                            <span
                              class={`provider-status ${row.Enabled ? row.Status : "disabled"}`}
                            />
                            {row.Headline}
                          </span>
                        </span>
                      </button>
                      <Toggle
                        checked={row.Enabled}
                        label={`Enable ${row.Name}`}
                        onChange={(enabled) => {
                          const write = providerEnabledWrite(held().settings, row, enabled);
                          void environment.updateServerSettings(write.Patch, write.Mutation);
                        }}
                      />
                    </li>
                  )}
                </For>
              </ul>
              <Show when={current()} keyed>
                {(row) => (
                  <div class="provider-editor">
                    <SettingsSection title={row.Name}>
                      <SettingsRowFrame
                        title="Status"
                        description={
                          <>
                            <span class="provider-list-headline">
                              <span
                                class={`provider-status ${row.Enabled ? row.Status : "disabled"}`}
                              />
                              {row.Headline}
                            </span>
                            <Show when={row.Message}>{(message) => <> · {message()}</>}</Show>
                          </>
                        }
                      />
                      <SettingsRowFrame
                        title="Display name"
                        control={<span class="settings-value">{row.Name}</span>}
                      />
                    </SettingsSection>
                    <SettingsSection title="Models">
                      <p class="settings-note">
                        Model preferences and custom models are saved on the selected environment
                        and shared across connected devices.
                      </p>
                      <div class="model-toolbar">
                        <Show when={row.Models.length > MODEL_FILTER_THRESHOLD}>
                          <Input
                            class="w-56"
                            placeholder="Filter models"
                            aria-label="Filter models"
                            spellcheck={false}
                            value={modelFilter()}
                            onInput={(event) => setModelFilter(event.currentTarget.value)}
                          />
                        </Show>
                        <Show when={row.Models.some((model) => !model.Custom)}>
                          <Button
                            variant="ghost"
                            onClick={() => {
                              const patch = bulkHiddenPatch(row);
                              if (patch !== null) void environment.updateServerSettings(patch);
                            }}
                          >
                            {allBuiltInHidden(row) ? "Enable all" : "Disable all"}
                          </Button>
                        </Show>
                        <span class="model-count">{modelCount(row)}</span>
                      </div>
                      <For each={filterModels(row.Models, modelFilter())}>
                        {(model) => (
                          <div class="model-row" classList={{ unlisted: model.Hidden }}>
                            <IconButton
                              size="sm"
                              pressed={model.Favorite}
                              aria-label={model.Favorite ? "Remove favorite" : "Add favorite"}
                              aria-pressed={model.Favorite}
                              data-tip={model.Favorite ? "Remove favorite" : "Add favorite"}
                              onClick={() =>
                                void environment.updateServerSettings(
                                  modelFavoritePatch(row.InstanceId, model.Slug, !model.Favorite),
                                )
                              }
                            >
                              <Icons.Star class={model.Favorite ? "star-on" : undefined} />
                            </IconButton>
                            <span class="model-name">
                              {model.Name}
                              <code class="model-slug">{model.Slug}</code>
                              <Show when={model.Custom}>
                                <span class="settings-badge">Custom</span>
                              </Show>
                            </span>
                            <For each={model.Tags}>
                              {(tag) => <span class="model-tag">{tag}</span>}
                            </For>
                            <IconButton
                              size="sm"
                              aria-label="Move up"
                              data-tip="Move up"
                              disabled={row.Models.indexOf(model) === 0}
                              onClick={() => {
                                const patch = modelMovePatch(row, model.Slug, -1);
                                if (patch !== null) void environment.updateServerSettings(patch);
                              }}
                            >
                              <Icons.ArrowUp />
                            </IconButton>
                            <IconButton
                              size="sm"
                              aria-label="Move down"
                              data-tip="Move down"
                              disabled={row.Models.indexOf(model) === row.Models.length - 1}
                              onClick={() => {
                                const patch = modelMovePatch(row, model.Slug, 1);
                                if (patch !== null) void environment.updateServerSettings(patch);
                              }}
                            >
                              <Icons.ArrowDown />
                            </IconButton>
                            <Toggle
                              class="ml-2"
                              checked={!model.Hidden}
                              label={`Show ${model.Name} in the model picker`}
                              disabled={model.Custom}
                              onChange={(shown) =>
                                void environment.updateServerSettings(
                                  modelHiddenPatch(row.InstanceId, model.Slug, !shown),
                                )
                              }
                            />
                          </div>
                        )}
                      </For>
                    </SettingsSection>
                  </div>
                )}
              </Show>
            </div>
          </SettingsSection>
        </>
      )}
    </Show>
  );
}

// Follows ProjectSettingsPanel.tsx: name, pin, archive and removal for one picked project.
const ProjectsPage = Shell.provider(() => {
  const environment = Environment.use();
  const shell = Shell.use();
  const projects = createMemo(() =>
    Object.values(shell.state.Projects).toSorted((left, right) =>
      left.title.localeCompare(right.title),
    ),
  );
  const [picked, setPicked] = createSignal<string | null>(null);
  const project = () =>
    shell.state.Projects[picked() ?? environment.currentProjectId() ?? ""] ?? null;
  const [removing, setRemoving] = createSignal<IWireProject | null>(null);
  return (
    <>
      <div class="settings-scope">
        <span>Applying settings for</span>
        <Select
          class="min-w-44"
          aria-label="Project"
          value={project()?.id ?? ""}
          onChange={(event) => setPicked(event.currentTarget.value || null)}
        >
          <option value="">Choose a project</option>
          <For each={projects()}>{(entry) => <option value={entry.id}>{entry.title}</option>}</For>
        </Select>
      </div>
      <Show
        when={project()}
        keyed
        fallback={
          <p class="settings-loading">
            Choose a project to manage its name, icon, checkouts and actions.
          </p>
        }
      >
        {(current) => (
          <>
            <SettingsSection title="Project">
              <SettingsRowFrame
                title="Name"
                description="The shared name for this project group in the sidebar and thread lists."
                control={
                  <Input
                    class="min-w-44"
                    aria-label="Project name"
                    value={current.title}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") event.currentTarget.blur();
                    }}
                    onBlur={(event) => {
                      const title = event.currentTarget.value.trim();
                      if (title && title !== current.title) {
                        void environment.projectCommand(current.id, {
                          Kind: "rename",
                          Title: title,
                        });
                      }
                    }}
                  />
                }
              />
              <SettingsRowFrame
                title={
                  <span class="settings-title-icon">
                    <ProjectBadge project={current} size={14} />
                    Project icon
                  </span>
                }
                description={current.workspaceRoot}
              />
              <SettingsRowFrame
                title="Pin"
                description="Pinned projects come first in project pickers."
                control={
                  <Toggle
                    checked={current.pinnedAt != null}
                    label="Pin"
                    onChange={(pinned) =>
                      void environment.projectCommand(current.id, {
                        Kind: pinned ? "pin" : "unpin",
                      })
                    }
                  />
                }
              />
              <SettingsRowFrame
                title="Archive"
                description={
                  current.archivedAt != null
                    ? "Hidden from project pickers. Threads and files are kept."
                    : "Hides the project from project pickers. Threads and files are kept."
                }
                control={
                  <Button
                    onClick={() =>
                      void environment.projectCommand(current.id, {
                        Kind: current.archivedAt != null ? "unarchive" : "archive",
                      })
                    }
                  >
                    {current.archivedAt != null ? "Unarchive" : "Archive"}
                  </Button>
                }
              />
            </SettingsSection>
            <SettingsSection title="Danger">
              <SettingsRowFrame
                title="Remove project"
                description="Removes this project and its threads from this environment."
                control={
                  <Button variant="destructive" onClick={() => setRemoving(current)}>
                    Remove
                  </Button>
                }
              />
            </SettingsSection>
          </>
        )}
      </Show>
      <Show when={removing()} keyed>
        {(target) => <RemoveProjectDialog project={target} onClose={() => setRemoving(null)} />}
      </Show>
    </>
  );
});

function KeybindingsPage() {
  const environment = Environment.use();
  const [query, setQuery] = createSignal("");
  const groups = createMemo(() => {
    const config = environment.state.Replica.Config;
    if (config === null) return [];
    const all = keybindingGroups(config.keybindings as unknown as ResolvedKeybindingsConfig);
    const needle = query().trim().toLowerCase();
    if (needle === "") return all;
    return all
      .map((group) => ({
        ...group,
        Rows: group.Rows.filter((row) =>
          [row.Command, row.Label, row.Key, row.When, row.Source].some((field) =>
            field.toLowerCase().includes(needle),
          ),
        ),
      }))
      .filter((group) => group.Rows.length > 0);
  });
  return (
    <Show
      when={environment.state.Replica.Config}
      fallback={<p class="settings-loading">Loading keybindings…</p>}
    >
      {(config) => (
        <>
          <div class="settings-toolbar">
            <Input
              class="w-full min-w-44"
              type="search"
              placeholder="Search keybindings"
              aria-label="Search keybindings"
              value={query()}
              onInput={(event) => setQuery(event.currentTarget.value)}
            />
          </div>
          <p class="settings-note">
            Read-only here. Edit them in stock T3 Code or in{" "}
            <code>{config().keybindingsConfigPath}</code>.
          </p>
          <For each={groups()}>
            {(group) => (
              <SettingsSection title={group.Title}>
                <For each={group.Rows}>
                  {(row) => (
                    <SettingsRowFrame
                      title={
                        <span data-tip={row.Command}>
                          {row.Label}
                          <Show when={row.Source !== "Default"}>
                            <span class="settings-badge">{row.Source}</span>
                          </Show>
                        </span>
                      }
                      description={row.When === "" ? undefined : `When ${row.When}`}
                      control={
                        <span class="key-caps">
                          <For each={keyCaps(row.Key)}>{(cap) => <kbd>{cap}</kbd>}</For>
                        </span>
                      }
                    />
                  )}
                </For>
              </SettingsSection>
            )}
          </For>
        </>
      )}
    </Show>
  );
}

type IArchivedThread = IWireArchivedShell["threads"][number];

// Follows ArchivedThreadsPanel.tsx.
function ArchivedPage() {
  const environment = Environment.use();
  const groups = createMemo(() => {
    const archived = environment.state.Replica.Archived;
    if (archived === null) return null;
    const byProject = new Map<string, IArchivedThread[]>();
    for (const thread of archived.threads) {
      const held = byProject.get(thread.projectId) ?? [];
      held.push(thread);
      byProject.set(thread.projectId, held);
    }
    const stamp = (thread: IArchivedThread) => thread.archivedAt ?? thread.createdAt;
    return [...byProject].map(([projectId, threads]) => ({
      Project:
        archived.projects.find((project) => project.id === projectId) ??
        environment.state.Replica.Shell.Projects[projectId],
      ProjectId: projectId,
      Threads: threads.toSorted((left, right) => stamp(right).localeCompare(stamp(left))),
    }));
  });
  const [now] = createSignal(clockNow());
  const [deleting, setDeleting] = createSignal<IArchivedThread | null>(null);
  return (
    <Show
      when={groups()}
      fallback={
        <SettingsSection title="Archived threads">
          <SettingsRowFrame
            title="Loading archived threads"
            description="Checking connected environments."
          />
        </SettingsSection>
      }
    >
      {(held) => (
        <Show
          when={held().length > 0}
          fallback={
            <SettingsSection title="Archived threads">
              <SettingsRowFrame
                title={
                  <span class="settings-title-icon">
                    <Icons.Archive />
                    No archived threads
                  </span>
                }
                description="Archived threads will appear here."
              />
            </SettingsSection>
          }
        >
          <For each={held()}>
            {(group) => (
              <SettingsSection title={group.Project?.title ?? "Unknown project"}>
                <For each={group.Threads}>
                  {(thread) => (
                    <SettingsRowFrame
                      title={thread.title}
                      description={`Archived ${relativeTime(thread.archivedAt ?? thread.createdAt, now())} ago · Created ${relativeTime(thread.createdAt, now())} ago`}
                      control={
                        <span class="settings-actions">
                          <IconButton
                            variant="outline"
                            aria-label="Unarchive"
                            data-tip="Unarchive"
                            onClick={() =>
                              void environment.archivedThreadCommand(thread.id, "unarchive")
                            }
                          >
                            <Icons.ArchiveX />
                          </IconButton>
                          <IconButton
                            variant="outline-destructive"
                            aria-label="Delete"
                            data-tip="Delete"
                            onClick={() => setDeleting(thread)}
                          >
                            <Icons.Trash2 />
                          </IconButton>
                        </span>
                      }
                    />
                  )}
                </For>
              </SettingsSection>
            )}
          </For>
          <Show when={deleting()} keyed>
            {(thread) => (
              <Dialog aria-labelledby="delete-archived-title" onClose={() => setDeleting(null)}>
                <DialogHeader>
                  <DialogTitle id="delete-archived-title">
                    Delete thread "{thread.title}"?
                  </DialogTitle>
                  <DialogDescription>
                    This permanently clears conversation history for this thread.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button autofocus onClick={() => setDeleting(null)}>
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => {
                      setDeleting(null);
                      void environment.archivedThreadCommand(thread.id, "delete");
                    }}
                  >
                    Delete
                  </Button>
                </DialogFooter>
              </Dialog>
            )}
          </Show>
        </Show>
      )}
    </Show>
  );
}

function AboutPage() {
  const environment = Environment.use();
  const version = () => environment.state.Replica.Config?.environment.serverVersion ?? null;
  const [copied, setCopied] = createSignal(false);
  return (
    <>
      <SettingsSection title="App">
        <SettingsRowFrame
          title={
            <span class="settings-title-icon">
              Version
              <Show when={version()}>
                {(text) => (
                  <button
                    class="version-chip"
                    data-tip={copied() ? "Copied" : "Copy version"}
                    onClick={() => {
                      void navigator.clipboard.writeText(text()).then(() => setCopied(true));
                    }}
                  >
                    <code>{text()}</code>
                  </button>
                )}
              </Show>
            </span>
          }
          description="Current version of the application."
        />
      </SettingsSection>
      <SettingsSection title="Legal">
        <SettingsRowFrame
          title="Privacy policy"
          description="How we handle your data, including the anonymous usage data T3 Code collects."
          control={
            <a
              class={`${button()} ${buttonLink}`}
              href={PRIVACY_POLICY_URL}
              target="_blank"
              rel="noreferrer"
            >
              View policy
            </a>
          }
        />
      </SettingsSection>
    </>
  );
}
