// @effect-diagnostics globalDate:off -- View-only relative times, outside any Effect runtime.
import type { ResolvedKeybindingsConfig } from "@t3tools/contracts";
import {
  children as resolveChildren,
  createMemo,
  createSignal,
  For,
  type JSX,
  Match,
  onCleanup,
  Show,
  Switch as SolidSwitch,
} from "solid-js";
import { Dynamic } from "solid-js/web";

import ArchivedThreads, { getDefaultArchivedThreads, useArchivedThreads } from "./ArchivedThreads";
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
  hasIdleCompactionOverride,
  INSTANCE_IDLE_COMPACTION_DESCRIPTION,
  INSTANCE_IDLE_COMPACTION_OPTIONS,
  instanceIdleCompaction,
  instanceIdleCompactionWrite,
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
import { ThreadConfirmDialog } from "./ThreadCard";
import { isNotificationMode } from "./threadNotifications";
import { clockNow, relativeTime } from "./timestamps";
import { Badge } from "./ui/Badge";
import { Button, buttonVariants, InlineButton } from "./ui/Button";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxSearchInput,
  openComboboxFromKeys,
} from "./ui/Combobox";
import { DraftInput } from "./ui/DraftInput";
import { Input } from "./ui/Input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "./ui/InputGroup";
import { Kbd, KbdGroup } from "./ui/Kbd";
import {
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  openMenuFromKeys,
} from "./ui/Menu";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "./ui/Select";
import { Presence } from "./ui/Presence";
import { BREADCRUMB, CRUMB_MUTED, CRUMB_SEPARATOR, CRUMB_TITLE, PageHeader } from "./ui/PageHeader";
import { SidebarInput, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "./ui/Sidebar";
import { Spinner } from "./ui/Spinner";
import { Switch } from "./ui/Switch";
import { Textarea } from "./ui/Textarea";
import { VoiceSetup } from "./VoiceSettings";

const PRIVACY_POLICY_URL = "https://t3.codes/privacy-policy";

const SCOPE_SEARCH_THRESHOLD = 6;

const loading = "m-0 px-4 text-[13px] text-muted-foreground";
const note = "m-0 px-4 text-[13px] text-muted-foreground [&_code]:text-[12px]";
const titleIcon = "inline-flex items-center gap-2 [&>svg]:size-4";
const mutedValue = "text-[13px] text-muted-foreground";
const toolbar = "flex items-center gap-2 px-4 text-[14px]";
const rowSelect = "w-full md:w-auto md:min-w-44";
const monoNote = "font-mono text-[11px] font-normal text-muted-foreground";
const headline =
  "inline-flex items-center gap-1.5 text-[12px] leading-[1.35] text-muted-foreground";

export function SettingsView(props: { page: string }) {
  const environment = Environment.use();
  const page = () => builtSettingsPage(props.page);
  const label = () => settingsPageOf(page())?.Label ?? "";
  return (
    <div class="flex h-full min-h-0 flex-col">
      <PageHeader variant="page">
        <SidebarToggle />
        <div class={BREADCRUMB}>
          <span class={CRUMB_MUTED}>Settings</span>
          <span class={CRUMB_SEPARATOR}>/</span>
          <h1 class={CRUMB_TITLE}>{label()}</h1>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Close settings"
          data-tip="Close"
          onClick={() => environment.openView(null)}
        >
          <Icons.X />
        </Button>
      </PageHeader>
      <div class="flex min-h-0 flex-1">
        <SettingsNav page={page()} />
        <div class="min-w-0 flex-1 overflow-y-auto">
          <div class="mx-auto flex max-w-4xl flex-col gap-8 px-6 pt-6 pb-12">
            <SolidSwitch>
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
              <Match when={page() === "voice"}>
                <VoiceSetup />
                <Sections sections={SETTINGS_SECTIONS.voice} />
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
            </SolidSwitch>
          </div>
        </div>
      </div>
    </div>
  );
}

const SEARCH_ITEMS = settingsSearchItems();

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
        <SidebarInput
          ref={setSearchBox}
          class="min-w-0 flex-1"
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
        <Show when={searching()} fallback={<Kbd>/</Kbd>}>
          <Button
            variant="ghost-muted"
            size="icon-micro"
            aria-label="Clear settings search"
            onClick={() => {
              setQuery("");
              searchBox()?.focus();
            }}
          >
            <Icons.X class="size-3" />
          </Button>
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
          <SidebarMenu role="listbox" aria-label="Settings search results">
            <For each={results()}>
              {(item, index) => (
                <SidebarMenuItem role="presentation">
                  <SidebarMenuButton
                    role="option"
                    aria-selected={index() === active()}
                    tabIndex={-1}
                    size="sm-search-result"
                    isActive={index() === active()}
                    onMouseMove={() => setActive(index())}
                    onClick={() => open(item)}
                  >
                    <Dynamic component={Icons[settingsPageOf(item.Page)?.Icon ?? "Settings2"]} />
                    <span class="min-w-0 flex-1">
                      <span class="block truncate text-sm font-medium text-sidebar-foreground">
                        {item.Title}
                      </span>
                      <span class="block truncate text-2xs text-sidebar-muted-foreground/75">
                        {settingsPageOf(item.Page)?.Label}
                      </span>
                    </span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
            </For>
          </SidebarMenu>
        </Show>
      </Show>
      <Show when={!searching()}>
        <For each={SETTINGS_NAV}>
          {(group) => (
            <div class="flex flex-col gap-0.5">
              <Show when={group.Group}>
                {(title) => (
                  <span class="px-2 py-1 text-[12px] font-medium text-muted-foreground max-md:hidden">
                    {title()}
                  </span>
                )}
              </Show>
              <SidebarMenu>
                <For each={group.Pages}>
                  {(entry) => (
                    <SidebarMenuItem data-tip={entry.Built ? undefined : "Not in this client yet"}>
                      <SidebarMenuButton
                        aria-current={props.page === entry.Id ? "page" : undefined}
                        isActive={props.page === entry.Id}
                        disabled={!entry.Built}
                        onClick={() => environment.openView({ Kind: "settings", Page: entry.Id })}
                      >
                        <Dynamic component={Icons[entry.Icon]} />
                        <span class="truncate max-md:sr-only">{entry.Label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )}
                </For>
              </SidebarMenu>
            </div>
          )}
        </For>
      </Show>
    </nav>
  );
}

const section = "flex flex-col gap-2.5";
const sectionHead = "flex min-h-7 items-center justify-between px-4";
const sectionTitle = "m-0 text-[16px] font-semibold";

export function SettingsSection(props: {
  title: string;
  action?: JSX.Element;
  plain?: boolean;
  children: JSX.Element;
}) {
  return (
    <section class={section}>
      <div class={sectionHead}>
        <h2 class={sectionTitle}>{props.title}</h2>
        {props.action}
      </div>
      <div
        class={
          props.plain === true
            ? undefined
            : "rounded-xl border border-border/60 bg-card/40 [&>*+*]:border-t"
        }
      >
        {props.children}
      </div>
    </section>
  );
}

export function SettingsRowFrame(props: {
  title: JSX.Element;
  description?: JSX.Element;
  control?: JSX.Element;
  settingId?: string;
  children?: JSX.Element;
}) {
  const below = resolveChildren(() => props.children);
  return (
    <div class={below() ? "px-4 pt-3.5" : "px-4 py-3.5"} data-setting-id={props.settingId}>
      <div class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-2 max-md:grid-cols-[minmax(0,1fr)]">
        <div>
          <div class="flex flex-wrap items-center gap-2 text-[14px] font-medium">{props.title}</div>
          <Show when={props.description}>
            <p class="mx-0 mt-0.5 mb-0 max-w-2xl text-[12px] leading-[1.45] text-muted-foreground">
              {props.description}
            </p>
          </Show>
        </div>
        <Show when={props.control}>
          <div class="flex items-center justify-end gap-2 max-md:flex-wrap max-md:justify-start">
            {props.control}
          </div>
        </Show>
      </div>
      {below()}
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
    <Show when={held()} fallback={<p class={loading}>Loading settings…</p>}>
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
  // Follows NotificationSettings.tsx: a mode is saved only once the browser allows it.
  const [notice, setNotice] = createSignal<string | null>(null);
  const [requesting, setRequesting] = createSignal(false);
  const chooseNotificationMode = async (next: ISettingValue) => {
    if (!isNotificationMode(next)) return;
    setNotice(null);
    setRequesting(true);
    const refused = await environment.chooseNotificationMode(next);
    setRequesting(false);
    setNotice(refused ?? null);
  };
  const write = (next: ISettingValue) => {
    if (props.row.Id === "notificationMode") void chooseNotificationMode(next);
    else void environment.writeSetting(props.row.Write(next, props.held));
  };
  // Only availability rebuilds the control, so a change of value keeps its focus.
  const available = createMemo(() => value() !== null);
  const current = () => String(value());
  const control = (): JSX.Element => {
    const control = props.row.Control;
    if (!available()) return <span class={mutedValue}>Unavailable</span>;
    switch (control.Kind) {
      case "switch":
        return (
          <Switch checked={value() === true} aria-label={props.row.Title} onCheckedChange={write} />
        );
      case "select":
        return (
          <Select value={current()} disabled={requesting()} onValueChange={write}>
            <SelectTrigger size="sm" class={rowSelect} aria-label={props.row.Title}>
              <SelectValue>
                {control.Options.find((option) => option.Value === current())?.Label ?? current()}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              <For each={control.Options}>
                {(option) => (
                  <SelectItem
                    value={option.Value}
                    disabled={option.Disabled?.(props.held) === true}
                  >
                    {option.Label}
                  </SelectItem>
                )}
              </For>
            </SelectPopup>
          </Select>
        );
      case "number":
        return (
          <Input
            size="sm"
            class="w-full sm:w-24"
            type="number"
            min={control.Min}
            max={control.Max}
            aria-label={props.row.Title}
            value={current()}
            onChange={(event) => write(Number(event.currentTarget.value))}
          />
        );
      case "text":
        return (
          <DraftInput
            size="sm"
            class="w-full sm:w-72"
            aria-label={props.row.Title}
            placeholder={control.Placeholder}
            spellcheck={false}
            value={current()}
            onCommit={write}
          />
        );
      case "textarea":
        return undefined;
    }
  };
  const below = (): JSX.Element => {
    const control = props.row.Control;
    const current = value();
    if (control.Kind !== "textarea" || current === null) return undefined;
    return (
      <div class="mt-3 max-w-2xl pb-3.5">
        <Textarea
          rows={4}
          aria-label={props.row.Title}
          placeholder={control.Placeholder}
          value={String(current)}
          onBlur={(event) => {
            if (event.currentTarget.value !== current) write(event.currentTarget.value);
          }}
        />
      </div>
    );
  };
  return (
    <SettingsRowFrame
      title={
        <>
          {props.row.Title}
          <Show when={!props.row.Applied}>
            <Badge
              variant="outline"
              size="sm"
              data-tip="Saved in this browser as stock saves it, but this client doesn't use it yet."
            >
              Not used here yet
            </Badge>
          </Show>
          <Show
            when={
              props.row.Default !== undefined && value() !== null && value() !== props.row.Default
            }
          >
            <ResetButton
              label={props.row.Title.toLowerCase()}
              onClick={() => write(props.row.Default!)}
            />
          </Show>
        </>
      }
      description={notice() ?? props.row.Description}
      settingId={props.row.Id}
      control={control()}
    >
      {below()}
    </SettingsRowFrame>
  );
}

function ResetButton(props: { label: string; onClick: () => void }) {
  return (
    <Button
      variant="ghost-muted"
      size="icon-micro"
      aria-label={`Reset ${props.label} to default`}
      data-tip="Reset to default"
      onClick={props.onClick}
    >
      <Icons.Undo2 class="size-3" />
    </Button>
  );
}

const APPEARANCE_MODES: Array<{ Mode: IAppearanceMode; Label: string }> = [
  { Mode: "system", Label: "System" },
  { Mode: "light", Label: "Light" },
  { Mode: "dark", Label: "Dark" },
];

const SCHEME_PREVIEW: Record<IAppearanceMode, string> = {
  system: "bg-[linear-gradient(135deg,#fafafa_50%,#111_50%)]",
  light: "bg-[#fafafa]",
  dark: "bg-[#111]",
};
const schemeLine = "h-1.5 rounded-sm bg-[#8a8a8a] opacity-35";

function ColorSchemeSection() {
  const environment = Environment.use();
  return (
    <section class={section}>
      <div class={sectionHead}>
        <h2 class={sectionTitle}>Color scheme</h2>
      </div>
      <div
        class="grid grid-cols-[repeat(3,minmax(0,10rem))] gap-3 px-4"
        role="radiogroup"
        aria-label="Color scheme"
      >
        <For each={APPEARANCE_MODES}>
          {(entry) => (
            <button
              class="group flex cursor-pointer flex-col items-stretch gap-1.5 border-0 bg-transparent p-0"
              role="radio"
              aria-checked={environment.state.Local.Preferences.AppearanceMode === entry.Mode}
              onClick={() => void environment.setAppearanceMode(entry.Mode)}
            >
              <span
                class={`flex h-[72px] flex-col gap-1.5 overflow-hidden rounded-[10px] border-2 p-2.5 group-aria-checked:border-primary ${SCHEME_PREVIEW[entry.Mode]}`}
              >
                <span class="h-2 w-1/2 rounded-sm bg-[#8a8a8a] opacity-50" />
                <span class={schemeLine} />
                <span class={`${schemeLine} w-[70%]`} />
              </span>
              <span class="text-left text-[13px]">{entry.Label}</span>
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
    <Show when={config()} fallback={<p class={loading}>Loading providers…</p>}>
      {(held) => (
        <>
          <SettingsSection title="Providers" plain>
            <div class="grid grid-cols-[17rem_minmax(0,1fr)] items-start gap-4 max-md:grid-cols-[minmax(0,1fr)]">
              <ul class="m-0 list-none rounded-xl border border-border/60 p-1">
                <For each={rows()}>
                  {(row) => (
                    <li
                      class="flex items-center gap-2 rounded-lg pr-2 data-active:bg-accent"
                      data-active={current()?.InstanceId === row.InstanceId || undefined}
                    >
                      <button
                        class="flex min-w-0 flex-1 cursor-pointer items-start gap-2 border-0 bg-transparent p-2 text-left text-[14px] [&>svg]:mt-0.5"
                        onClick={() => {
                          setSelected(row.InstanceId);
                          setModelFilter("");
                        }}
                      >
                        <ProviderIcon driver={row.Driver} size={16} />
                        <span class="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span class="flex min-w-0 items-baseline gap-1.5">
                            {row.Name}
                            <Show when={row.Version}>
                              {(version) => <code class={monoNote}>v{version()}</code>}
                            </Show>
                          </span>
                          <span class={headline}>
                            <StatusDot row={row} />
                            {row.Headline}
                          </span>
                        </span>
                      </button>
                      <Switch
                        checked={row.Enabled}
                        aria-label={`Enable ${row.Name}`}
                        onCheckedChange={(enabled) => {
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
                  <div class="flex min-w-0 flex-col gap-6">
                    <SettingsSection title={row.Name}>
                      <SettingsRowFrame
                        title="Status"
                        description={
                          <>
                            <span class={headline}>
                              <StatusDot row={row} />
                              {row.Headline}
                            </span>
                            <Show when={row.Message}>{(message) => <> · {message()}</>}</Show>
                          </>
                        }
                      />
                      <SettingsRowFrame
                        title="Display name"
                        control={<span class={mutedValue}>{row.Name}</span>}
                      />
                      <Show when={hasIdleCompactionOverride(row)}>
                        <SettingsRowFrame
                          title="Compact idle threads"
                          description={INSTANCE_IDLE_COMPACTION_DESCRIPTION}
                          settingId="instanceIdleCompaction"
                          control={
                            <Select
                              value={instanceIdleCompaction(held().settings, row)}
                              onValueChange={(value) =>
                                void environment.updateServerSettings(
                                  {},
                                  instanceIdleCompactionWrite(held().settings, row, value),
                                )
                              }
                            >
                              <SelectTrigger
                                size="sm"
                                class={rowSelect}
                                aria-label="Compact idle threads"
                              >
                                <SelectValue>
                                  {INSTANCE_IDLE_COMPACTION_OPTIONS.find(
                                    (option) =>
                                      option.Value === instanceIdleCompaction(held().settings, row),
                                  )?.Label ?? ""}
                                </SelectValue>
                              </SelectTrigger>
                              <SelectPopup align="start" alignItemWithTrigger={false}>
                                <For each={INSTANCE_IDLE_COMPACTION_OPTIONS}>
                                  {(option) => (
                                    <SelectItem value={option.Value}>{option.Label}</SelectItem>
                                  )}
                                </For>
                              </SelectPopup>
                            </Select>
                          }
                        />
                      </Show>
                    </SettingsSection>
                    <SettingsSection title="Models">
                      <p class={`${note} py-3`}>
                        Model preferences and custom models are saved on the selected environment
                        and shared across connected devices.
                      </p>
                      <div class="flex flex-wrap items-center gap-2 px-4 pt-0 pb-2">
                        <Show when={row.Models.length > MODEL_FILTER_THRESHOLD}>
                          <Input
                            size="sm"
                            class="w-56 max-w-full"
                            placeholder="Filter models"
                            aria-label="Filter models"
                            spellcheck={false}
                            value={modelFilter()}
                            onInput={(event) => setModelFilter(event.currentTarget.value)}
                          />
                        </Show>
                        <Show when={row.Models.some((model) => !model.Custom)}>
                          <Button
                            size="xs"
                            variant="ghost-muted"
                            onClick={() => {
                              const patch = bulkHiddenPatch(row);
                              if (patch !== null) void environment.updateServerSettings(patch);
                            }}
                          >
                            {allBuiltInHidden(row) ? "Enable all" : "Disable all"}
                          </Button>
                        </Show>
                        <span class="text-[12px] text-muted-foreground">{modelCount(row)}</span>
                      </div>
                      <For each={filterModels(row.Models, modelFilter())}>
                        {(model) => (
                          <div class="flex items-center gap-1 py-1.5 pr-4 pl-2.5 max-md:flex-wrap">
                            <Button
                              variant="ghost-muted"
                              size="icon-micro"
                              aria-label={model.Favorite ? "Remove favorite" : "Add favorite"}
                              aria-pressed={model.Favorite}
                              data-tip={model.Favorite ? "Remove favorite" : "Add favorite"}
                              onClick={() =>
                                void environment.updateServerSettings(
                                  modelFavoritePatch(row.InstanceId, model.Slug, !model.Favorite),
                                )
                              }
                            >
                              <Icons.Star
                                class={
                                  model.Favorite ? "size-3 fill-current text-warning" : "size-3"
                                }
                              />
                            </Button>
                            <span
                              class={`flex min-w-0 flex-1 items-center gap-2 pl-1 text-[14px] max-md:flex-col max-md:items-start max-md:gap-0 ${model.Hidden ? "text-muted-foreground" : ""}`}
                            >
                              {model.Name}
                              <code class={`${monoNote} max-md:max-w-full max-md:truncate`}>
                                {model.Slug}
                              </code>
                              <Show when={model.Custom}>
                                <span class="shrink-0 text-2xs text-muted-foreground/70">
                                  custom
                                </span>
                              </Show>
                            </span>
                            <span class="contents max-md:order-last max-md:flex max-md:basis-full max-md:pl-8 max-md:empty:hidden">
                              <For each={model.Tags}>
                                {(tag) => (
                                  <span class="mr-3 text-[12px] whitespace-nowrap text-muted-foreground">
                                    {tag}
                                  </span>
                                )}
                              </For>
                            </span>
                            <Button
                              variant="ghost-muted"
                              size="icon-micro"
                              aria-label="Move up"
                              data-tip="Move up"
                              disabled={row.Models.indexOf(model) === 0}
                              onClick={() => {
                                const patch = modelMovePatch(row, model.Slug, -1);
                                if (patch !== null) void environment.updateServerSettings(patch);
                              }}
                            >
                              <Icons.ArrowUp class="size-3" />
                            </Button>
                            <Button
                              variant="ghost-muted"
                              size="icon-micro"
                              aria-label="Move down"
                              data-tip="Move down"
                              disabled={row.Models.indexOf(model) === row.Models.length - 1}
                              onClick={() => {
                                const patch = modelMovePatch(row, model.Slug, 1);
                                if (patch !== null) void environment.updateServerSettings(patch);
                              }}
                            >
                              <Icons.ArrowDown class="size-3" />
                            </Button>
                            <Switch
                              class="ml-2"
                              size="sm"
                              checked={!model.Hidden}
                              aria-label={`Show ${model.Name} in the model picker`}
                              disabled={model.Custom}
                              onCheckedChange={(shown) =>
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
          <Sections sections={SETTINGS_SECTIONS.providers} />
        </>
      )}
    </Show>
  );
}

const STATUS_DOT: Record<string, string> = {
  ready: "bg-success",
  warning: "bg-warning",
  error: "bg-error",
};

function StatusDot(props: { row: IProviderRow }) {
  return (
    <span
      class={`size-1.5 flex-none rounded-full ${
        props.row.Enabled
          ? (STATUS_DOT[props.row.Status] ?? "bg-muted-foreground")
          : "bg-muted-foreground opacity-50"
      }`}
    />
  );
}

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
  const [scopeMenu, setScopeMenu] = createSignal<HTMLElement | null>(null);
  const [scopeQuery, setScopeQuery] = createSignal("");
  const scopeLabel = () => project()?.title ?? "Choose a project";
  const searchable = () => projects().length > SCOPE_SEARCH_THRESHOLD;
  const scopeMatches = createMemo(() => {
    const needle = scopeQuery().trim().toLowerCase();
    return projects().filter((entry) =>
      `${entry.title} ${entry.id}`.toLowerCase().includes(needle),
    );
  });
  const openScope = (trigger: HTMLElement) => {
    setScopeQuery("");
    setScopeMenu(trigger);
  };
  return (
    <>
      <div class={`${toolbar} text-muted-foreground`}>
        <span class="shrink-0">Applying settings for</span>
        <Button
          variant="outline"
          size="sm"
          class="min-w-0 max-w-72"
          aria-label={`Project scope: ${scopeLabel()}`}
          aria-haspopup={searchable() ? "listbox" : "menu"}
          aria-expanded="false"
          data-slot={searchable() ? "combobox-trigger" : undefined}
          onClick={(event) => {
            if (scopeMenu() === null) openScope(event.currentTarget);
            else setScopeMenu(null);
          }}
          onKeyDown={(event) => {
            const trigger = event.currentTarget;
            (searchable() ? openComboboxFromKeys : openMenuFromKeys)(event, () =>
              openScope(trigger),
            );
          }}
        >
          <Show when={project()}>{(held) => <ProjectBadge project={held()} size={14} />}</Show>
          <span class="min-w-0 truncate">{scopeLabel()}</span>
          <Icons.ChevronDown
            aria-hidden="true"
            stroke-width={1.75}
            class="-me-0.5 size-3.5 shrink-0 text-muted-foreground opacity-70"
          />
        </Button>
      </div>
      <Presence when={scopeMenu()}>
        {(anchor) => (
          <Show
            when={!searchable()}
            fallback={
              <Combobox value={project()?.id ?? null}>
                <ComboboxPopup anchor={anchor()} class="w-80" onClose={() => setScopeMenu(null)}>
                  <ComboboxSearchInput
                    aria-label="Search projects"
                    placeholder="Search projects"
                    value={scopeQuery()}
                    onInput={(event) => setScopeQuery(event.currentTarget.value)}
                  />
                  <ComboboxEmpty>
                    <Show when={scopeMatches().length === 0}>No matches found.</Show>
                  </ComboboxEmpty>
                  <ComboboxList>
                    <For each={scopeMatches()}>
                      {(entry) => (
                        <ComboboxItem
                          value={entry.id}
                          onClick={() => {
                            setPicked(entry.id);
                            setScopeMenu(null);
                          }}
                        >
                          <ProjectBadge project={entry} size={14} />
                          <span class="min-w-0 flex-1">
                            <span class="block truncate">{entry.title}</span>
                          </span>
                          <Show when={entry.id === project()?.id}>
                            <Icons.Check aria-hidden="true" class="size-3.5 shrink-0" />
                          </Show>
                        </ComboboxItem>
                      )}
                    </For>
                  </ComboboxList>
                </ComboboxPopup>
              </Combobox>
            }
          >
            <MenuPopup anchor={anchor()} align="start" onClose={() => setScopeMenu(null)}>
              <div class="w-72 max-w-full">
                <MenuRadioGroup value={project()?.id ?? ""} onValueChange={setPicked}>
                  <For each={projects()}>
                    {(entry) => (
                      <MenuRadioItem value={entry.id} closeOnClick label={entry.title}>
                        <span class="flex min-w-0 items-center gap-2">
                          <ProjectBadge project={entry} size={14} />
                          <span class="min-w-0 flex-1">
                            <span class="block truncate">{entry.title}</span>
                          </span>
                          <MenuRadioItemIndicator />
                        </span>
                      </MenuRadioItem>
                    )}
                  </For>
                </MenuRadioGroup>
              </div>
            </MenuPopup>
          </Show>
        )}
      </Presence>
      <Show
        when={project()}
        keyed
        fallback={
          <p class={loading}>Choose a project to manage its name, icon, checkouts and actions.</p>
        }
      >
        {(current) => (
          <>
            <SettingsSection title="Project">
              <SettingsRowFrame
                title="Name"
                description="The shared name for this project group in the sidebar and thread lists."
                control={
                  <DraftInput
                    size="sm"
                    class="w-full sm:w-64"
                    aria-label="Project name"
                    value={current.title}
                    onCommit={(next) => {
                      const title = next.trim();
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
                  <span class={titleIcon}>
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
                  <Switch
                    checked={current.pinnedAt != null}
                    aria-label="Pin project"
                    onCheckedChange={(pinned) =>
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
                    size="sm"
                    variant="outline"
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
                  <Button
                    size="sm"
                    variant="destructive-outline"
                    onClick={() => setRemoving(current)}
                  >
                    Remove
                  </Button>
                }
              />
            </SettingsSection>
          </>
        )}
      </Show>
      <Presence when={removing()} keyed>
        {(target) => <RemoveProjectDialog project={target()} onClose={() => setRemoving(null)} />}
      </Presence>
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
      fallback={<p class={loading}>Loading keybindings…</p>}
    >
      {(config) => (
        <>
          <div class={toolbar}>
            <InputGroup class="min-w-0 basis-full **:[input]:h-9 sm:flex-1 sm:**:[input]:h-8">
              <InputGroupAddon>
                <Icons.Search aria-hidden="true" class="size-3.5" />
              </InputGroupAddon>
              <InputGroupInput
                size="sm"
                type="search"
                placeholder="Search keybindings"
                aria-label="Search keybindings"
                value={query()}
                onInput={(event) => setQuery(event.currentTarget.value)}
              />
            </InputGroup>
          </div>
          <p class={note}>
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
                            <Badge variant="outline" size="sm">
                              {row.Source}
                            </Badge>
                          </Show>
                        </span>
                      }
                      description={
                        row.When === "" || row.Unassigned ? undefined : `When ${row.When}`
                      }
                      control={
                        <Show
                          when={!row.Unassigned}
                          fallback={
                            <span class="text-[12px] text-muted-foreground">Unassigned</span>
                          }
                        >
                          <KbdGroup>
                            <For each={keyCaps(row.Key)}>{(cap) => <Kbd>{cap}</Kbd>}</For>
                          </KbdGroup>
                        </Show>
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

const ArchivedPage = ArchivedThreads.provider(() => {
  const environment = Environment.use();
  const page = useArchivedThreads(environment.state.EnvironmentId, environment.threadCommand);
  const command = page.command;
  const groups = createMemo(() => {
    const archived = page.state.Archived;
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
            title={
              <span class="inline-flex items-center gap-2">
                <Spinner size="sm" tone="muted" />
                Loading archived threads
              </span>
            }
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
                  <span class={titleIcon}>
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
                        <span class="inline-flex gap-1.5">
                          <Button
                            variant="outline"
                            size="icon-sm"
                            aria-label="Unarchive"
                            data-tip="Unarchive"
                            onClick={() => command(thread.id, "unarchive")}
                          >
                            <Icons.ArchiveX class="size-3.5" />
                          </Button>
                          <Button
                            variant="destructive-outline"
                            size="icon-sm"
                            aria-label="Delete"
                            data-tip="Delete"
                            onClick={() =>
                              environment.confirmThreadDelete()
                                ? setDeleting(thread)
                                : command(thread.id, "delete")
                            }
                          >
                            <Icons.Trash2 class="size-3.5" />
                          </Button>
                        </span>
                      }
                    />
                  )}
                </For>
              </SettingsSection>
            )}
          </For>
          <Presence when={deleting()} keyed>
            {(held) => {
              const thread = held();
              return (
                <ThreadConfirmDialog
                  kind="delete"
                  title={thread.title}
                  onConfirm={() => command(thread.id, "delete")}
                  onClose={() => setDeleting(null)}
                />
              );
            }}
          </Presence>
        </Show>
      )}
    </Show>
  );
}, getDefaultArchivedThreads);

function AboutPage() {
  const environment = Environment.use();
  const version = () => environment.state.Replica.Config?.environment.serverVersion ?? null;
  const [copied, setCopied] = createSignal(false);
  return (
    <>
      <SettingsSection title="App">
        <SettingsRowFrame
          title={
            <span class={titleIcon}>
              Version
              <Show when={version()}>
                {(text) => (
                  <code class="text-2xs font-medium">
                    <InlineButton
                      tone="muted"
                      aria-label={`Copy version ${text()}`}
                      data-tip={copied() ? "Copied" : "Copy version"}
                      onClick={() => {
                        void navigator.clipboard.writeText(text()).then(() => setCopied(true));
                      }}
                    >
                      {text()}
                    </InlineButton>
                  </code>
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
              class={buttonVariants({ variant: "outline", size: "sm" })}
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
