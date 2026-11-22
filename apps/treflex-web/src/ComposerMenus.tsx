import { selectableProviderOptionChoices } from "@t3tools/client-runtime/model-traits";
import { type Component, createMemo, createSignal, For, onMount, Show } from "solid-js";
import { Dynamic } from "solid-js/web";

import { hasProviderIcon, ProviderIcon } from "./brand";
import { formatContextTokens } from "./compaction";
import Environment from "./Environment";
import {
  Check,
  ChevronRight,
  ChevronUp,
  Lock,
  Minimize2,
  PenLine,
  Search,
  ShieldCheck,
  ShieldOff,
  Star,
  Workflow,
  Zap,
} from "./icons";
import type { IWireRuntimeMode } from "./Infrastructure/commandEffects";
import { arrowStep, focusStep } from "./listNavigation";
import { MenuPopup, MenuRadioGroup, MenuRadioItem, openMenuFromKeys } from "./ui/Menu";
import { PopoverPopup } from "./ui/Popover";
import { Presence } from "./ui/Presence";
import { Segment, Segmented } from "./ui/Segmented";
import { MenuSwitch } from "./ui/Switch";
import {
  FAVORITES_TAB,
  type IBooleanDescriptor,
  type IColumnControl,
  initialPickerTab,
  type IPickerModel,
  type ISelectDescriptor,
  type ITraits,
  legacyStartsExpanded,
  modelChangeBlock,
  modelTraits,
  pickerList,
  providerOf,
  selectValue,
  triggerSuffix,
  withBooleanValue,
  withSelectValue,
} from "./modelOptions";
import ThreadSession from "./ThreadSession";

// Labels, descriptions and icons copy apps/web/src/components/chat/runtimeModeConfig.ts.
export const RUNTIME_MODE_CONFIG: Record<
  IWireRuntimeMode,
  { Label: string; Description: string; Icon: Component<{ class?: string }> }
> = {
  "approval-required": {
    Label: "Supervised",
    Description: "Ask before commands and file changes.",
    Icon: Lock,
  },
  "auto-accept-edits": {
    Label: "Auto-accept edits",
    Description: "Auto-approve edits, ask before other actions.",
    Icon: PenLine,
  },
  auto: {
    Label: "Auto",
    Description: "Supported providers approve routine actions; others still ask.",
    Icon: ShieldCheck,
  },
  "full-access": {
    Label: "Full access",
    Description: "Allow commands and edits without prompts.",
    Icon: ShieldOff,
  },
};

const PERMISSION_ITEM =
  "flex h-6 flex-1 cursor-pointer items-center justify-center text-muted-foreground outline-none first:rounded-l-md last:rounded-r-md data-disabled:cursor-not-allowed data-disabled:opacity-40 data-checked:bg-input/72 data-checked:text-foreground data-highlighted:text-foreground not-data-checked:data-highlighted:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset";

const OPEN_HOVER =
  "hover:bg-foreground/9 hover:text-foreground aria-expanded:bg-foreground/9 aria-expanded:text-foreground";
const COMPOSER_CONTROL = `inline-flex h-7 min-w-0 flex-initial cursor-pointer items-center gap-1.5 rounded-lg border-0 bg-transparent px-2 py-0 text-[14px] leading-5 font-medium whitespace-nowrap text-foreground/80 ${OPEN_HOVER} [&>svg]:size-4 [&>svg]:flex-none`;
const LABEL = "min-w-0 overflow-hidden text-ellipsis";
const SMALL_MUTED = "text-[12px] text-muted-foreground";
const EMPTY = "px-2 py-1.5 text-[14px] text-muted-foreground";
const STACK = "flex flex-col gap-0.5";
const ROW_TEXT = "min-w-0 flex-1 truncate";
const COLUMN_HEAD = "mx-3 mt-2.5 mb-0 border-b border-border/70 pb-1.5 text-muted-foreground";
const MODEL_ROW =
  "group/row flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-[14px] data-highlighted:bg-foreground/9 [&>svg]:size-3.5 [&>svg]:flex-none";
const EFFORT_ROW =
  "flex min-h-8 w-full flex-none cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent px-2 text-left text-[14px] text-foreground hover:bg-foreground/9 focus-visible:bg-foreground/9 [&>svg]:size-3.5 [&>svg]:flex-none";
const PROVIDER_TAB =
  "relative flex aspect-square w-full flex-none cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-foreground enabled:hover:bg-foreground/10 focus-visible:bg-foreground/10 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40 aria-pressed:after:absolute aria-pressed:after:top-[calc(50%-10px)] aria-pressed:after:right-0 aria-pressed:after:h-5 aria-pressed:after:w-[3px] aria-pressed:after:rounded-full aria-pressed:after:bg-primary [&_svg]:size-5";
const PICKER_GRID =
  "group/picker grid min-h-0 flex-1 grid-cols-[auto_minmax(0,1fr)_11.75rem] grid-rows-[minmax(0,1fr)_auto] [grid-template-areas:'providers_models_effort'_'footer_footer_footer'] data-searching:grid-cols-[minmax(0,1fr)_11.75rem] data-searching:[grid-template-areas:'models_effort'_'footer_footer'] max-sm:grid-cols-[auto_minmax(0,1fr)] max-sm:grid-rows-[minmax(0,1fr)_minmax(0,auto)_auto] max-sm:[grid-template-areas:'providers_models'_'providers_effort'_'footer_footer'] max-sm:data-searching:grid-cols-[minmax(0,1fr)_11.75rem] max-sm:data-searching:[grid-template-areas:'models_effort'_'footer_footer']";

const boltClass = (ultra: boolean) =>
  ultra ? "fill-current text-primary" : "fill-current text-warning";

function PermissionsSection(props: {
  mode: IWireRuntimeMode;
  modes: ReadonlyArray<IWireRuntimeMode>;
  onPick: (mode: IWireRuntimeMode) => void;
}) {
  const [preview, setPreview] = createSignal<IWireRuntimeMode | null>(null);
  const shown = () => RUNTIME_MODE_CONFIG[preview() ?? props.mode];
  const [section, setSection] = createSignal<HTMLDivElement>();
  onMount(() =>
    section()
      ?.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]')
      ?.focus({ preventScroll: true }),
  );
  return (
    <div class="grid w-72 gap-1.5 px-2 py-1.5" ref={setSection}>
      <div class={`${SMALL_MUTED} font-medium`}>Permissions</div>
      <MenuRadioGroup
        aria-label="Permissions"
        value={props.mode}
        onValueChange={(value) => {
          const picked = props.modes.find((mode) => mode === value);
          if (picked !== undefined) props.onPick(picked);
        }}
        class="flex rounded-lg bg-input/40 p-0.5"
        // Menus navigate with Up/Down only; the row reads horizontally, so Left/Right move too.
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          const items = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitemradio"]'),
          );
          const index = items.findIndex((item) => item === document.activeElement);
          const next = items[index + (event.key === "ArrowRight" ? 1 : -1)];
          if (index < 0 || next === undefined) return;
          event.preventDefault();
          event.stopPropagation();
          next.focus();
        }}
      >
        <For each={props.modes}>
          {(mode) => (
            <MenuRadioItem
              value={mode}
              closeOnClick
              label={RUNTIME_MODE_CONFIG[mode].Label}
              aria-label={RUNTIME_MODE_CONFIG[mode].Label}
              class={PERMISSION_ITEM}
              onPointerEnter={() => setPreview(mode)}
              onPointerLeave={() => setPreview(null)}
              onFocus={() => setPreview(mode)}
              onBlur={() => setPreview(null)}
            >
              <Dynamic component={RUNTIME_MODE_CONFIG[mode].Icon} class="size-3.5" />
            </MenuRadioItem>
          )}
        </For>
      </MenuRadioGroup>
      <div class="grid gap-0.5" aria-hidden="true">
        <span
          class="text-[14px] text-muted-foreground data-current:text-foreground"
          data-current={(preview() ?? props.mode) === props.mode ? "" : undefined}
        >
          {shown().Label}
        </span>
        <span class={`min-h-8 leading-4 ${SMALL_MUTED}`}>{shown().Description}</span>
      </div>
    </div>
  );
}

function PermissionsPopup(props: {
  anchor: HTMLElement;
  align: "start" | "end";
  onClose: () => void;
}) {
  const session = ThreadSession.use();
  return (
    <MenuPopup anchor={props.anchor} side="top" align={props.align} onClose={props.onClose}>
      <PermissionsSection
        mode={session.effectiveRuntimeMode()}
        modes={session.runtimeModes()}
        onPick={(picked) => session.setRuntimeMode(picked)}
      />
    </MenuPopup>
  );
}

// Follows the compact-before-send toggle in apps/web/src/components/chat/ComposerPrimaryActions.tsx.
export function CompactToggle(props: { tokens: number }) {
  const session = ThreadSession.use();
  const keep = () => session.state.KeepFullHistory;
  const tokens = () => formatContextTokens(props.tokens);
  return (
    <button
      type="button"
      class={`${COMPOSER_CONTROL} tabular-nums aria-pressed:bg-foreground/9 aria-pressed:text-foreground [&>svg]:text-muted-foreground`}
      aria-pressed={!keep()}
      aria-label={`Compact ${tokens()} tokens of history before sending`}
      data-tip={
        keep()
          ? `Next send keeps all ${tokens()} tokens. Click to compact first`
          : `Next send compacts ${tokens()} tokens first. Click to keep full history`
      }
      onClick={() => session.toggleKeepFullHistory()}
    >
      <Minimize2 />
      <span class="max-sm:hidden">{keep() ? "Keep" : "Compact"}</span>
      <span class="text-muted-foreground">{tokens()}</span>
    </button>
  );
}

export function PermissionsChip(props: { context?: boolean }) {
  const session = ThreadSession.use();
  const [open, setOpen] = createSignal(false);
  const [trigger, setTrigger] = createSignal<HTMLButtonElement>();
  const mode = () => RUNTIME_MODE_CONFIG[session.effectiveRuntimeMode()];
  return (
    <>
      <button
        type="button"
        class={
          props.context
            ? `inline-flex h-6 cursor-pointer items-center gap-1.5 rounded-md border-0 bg-transparent px-2 py-0 text-[12px] text-muted-foreground ${OPEN_HOVER} [&_svg]:size-3.5`
            : `${COMPOSER_CONTROL} in-data-collapsed:hidden`
        }
        ref={setTrigger}
        aria-label={`Permissions: ${mode().Label}`}
        aria-haspopup="menu"
        aria-expanded={open()}
        data-tip={`Permissions: ${mode().Label}. ${mode().Description}`}
        onClick={() => setOpen(!open())}
        onKeyDown={(event) => openMenuFromKeys(event, () => setOpen(true))}
      >
        <Dynamic component={mode().Icon} />
        <span class={LABEL}>{mode().Label}</span>
      </button>
      <Presence when={open() && trigger()}>
        {(anchor) => (
          <PermissionsPopup
            anchor={anchor()}
            align={props.context ? "end" : "start"}
            onClose={() => setOpen(false)}
          />
        )}
      </Presence>
    </>
  );
}

export function ModelPicker() {
  const environment = Environment.use();
  const session = ThreadSession.use();
  const [open, setOpen] = createSignal(false);
  const providers = () => environment.state.Replica.Providers;
  const selection = () => session.effectiveModel();
  const traits = createMemo(() => {
    const held = selection();
    return held === null ? null : modelTraits(providerOf(providers(), held), held);
  });
  const suffix = createMemo(() => {
    const held = selection();
    const shown = traits();
    return held === null || shown === null ? null : triggerSuffix(shown, held);
  });
  const [trigger, setTrigger] = createSignal<HTMLButtonElement>();
  const name = () => session.effectiveModelName() ?? "No model";
  return (
    <>
      {/* model-trigger has no rule: Composer.tsx keeps it visible in the collapsed phone composer. */}
      <button
        type="button"
        class={`model-trigger group/trigger ${COMPOSER_CONTROL}`}
        ref={setTrigger}
        aria-label={`Model: ${name()}${suffix()?.Detail ? `, ${suffix()!.Detail}` : ""}`}
        aria-haspopup="dialog"
        aria-expanded={open()}
        data-tip={suffix()?.Detail ?? undefined}
        onClick={() => setOpen(!open())}
      >
        <ProviderIcon driver={session.effectiveModelDriver()} />
        <span class={LABEL}>{name()}</span>
        <Show when={suffix()}>
          {(shown) => (
            <span class="-ml-0.5 inline-flex max-w-40 min-w-0 flex-none items-center gap-1.5 text-muted-foreground group-hover/trigger:text-foreground group-aria-expanded/trigger:text-foreground [&_svg]:size-3">
              <Show when={shown().Word}>{(word) => <span class={LABEL}>{word()}</span>}</Show>
              <Show when={shown().Speed}>
                <Zap class={boltClass(shown().Speed === "Ultrafast")} />
              </Show>
              <Show when={shown().Ultracode}>
                <Workflow />
              </Show>
              <Show when={shown().ContextWindow}>
                {(window) => <span class={`${LABEL} text-[12px]`}>{window()}</span>}
              </Show>
            </span>
          )}
        </Show>
      </button>
      <Presence when={open() && trigger()}>
        {(anchor) => (
          <PopoverPopup
            anchor={anchor()}
            side="top"
            align="end"
            collisionAvoidance={{ side: "shift", align: "shift" }}
            padding="none"
            touchBackdrop
            initialFocus={(popup) =>
              window.matchMedia("(pointer: coarse)").matches
                ? null
                : popup.querySelector<HTMLElement>("input")
            }
            label="Model"
            class="before:hidden"
            onClose={() => setOpen(false)}
          >
            <div class="flex h-96 max-h-(--available-height) w-[min(34rem,calc(100vw-16px))] flex-col max-sm:h-128">
              <PickerContent traits={traits()} />
            </div>
          </PopoverPopup>
        )}
      </Presence>
    </>
  );
}

function ProviderGlyph(props: { driver: string | undefined; name: string; size?: number }) {
  return (
    <Show
      when={hasProviderIcon(props.driver)}
      fallback={<span class="text-[13px] font-semibold">{props.name.slice(0, 1)}</span>}
    >
      <ProviderIcon driver={props.driver} size={props.size} />
    </Show>
  );
}

function PickerContent(props: { traits: ITraits | null }) {
  const environment = Environment.use();
  const session = ThreadSession.use();
  const providers = () => environment.state.Replica.Providers;
  const favorites = () => environment.state.Replica.ModelFavorites;
  const selection = () => session.effectiveModel();
  const [tab, setTab] = createSignal(
    initialPickerTab({
      Providers: providers(),
      Favorites: favorites(),
      ActiveInstanceId: selection()?.instanceId ?? null,
      Started: session.modelSwitch().Started,
    }),
  );
  const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(
    new Set(
      legacyStartsExpanded(providers(), favorites(), selection()) ? [selection()!.instanceId] : [],
    ),
  );
  const [query, setQuery] = createSignal("");
  const [highlight, setHighlight] = createSignal(-1);
  const list = createMemo(() =>
    pickerList({
      Providers: providers(),
      Favorites: favorites(),
      Tab: tab(),
      Query: query(),
      LegacyExpanded: expanded().has(tab() ?? ""),
      Active: selection(),
    }),
  );
  const models = () => list().Models;
  const rowCount = () => models().length + (list().Legacy === null ? 0 : 1);
  const toggleLegacy = () => {
    const held = tab();
    if (held === null) return;
    const next = new Set(expanded());
    if (next.has(held)) next.delete(held);
    else next.add(held);
    setExpanded(next);
  };
  const blockOf = (instanceId: string) =>
    modelChangeBlock({ ...session.modelSwitch(), NextInstanceId: instanceId });
  const isSelected = (model: IPickerModel) =>
    selection()?.instanceId === model.InstanceId && selection()?.model === model.Slug;
  const [search, setSearch] = createSignal<HTMLInputElement>();
  const [column, setColumn] = createSignal<HTMLDivElement>();
  const [listElement, setListElement] = createSignal<HTMLUListElement>();
  const [rail, setRail] = createSignal<HTMLDivElement>();
  const searching = () => query().trim() !== "";

  const focusEffort = () => {
    const held = column();
    const row =
      held?.querySelector<HTMLElement>('[data-effort-level][aria-checked="true"]:not(:disabled)') ??
      held?.querySelector<HTMLElement>("[data-effort-level]:not(:disabled)") ??
      held?.querySelector<HTMLElement>("[data-effort-row]:not(:disabled)");
    row?.focus({ preventScroll: true });
    return row != null;
  };
  const showRow = (index: number) =>
    listElement()?.children[index]?.scrollIntoView({ block: "nearest" });
  const choose = (model: IPickerModel) => {
    if (blockOf(model.InstanceId) !== null) return;
    void session.chooseModel(model.InstanceId, model.Slug);
    requestAnimationFrame(() => {
      if (!focusEffort()) search()?.focus();
    });
  };
  const chooseRow = (index: number) => {
    const model = models()[index];
    if (model !== undefined) choose(model);
    else if (index === models().length && list().Legacy !== null) toggleLegacy();
  };
  const moveHighlight = (step: number) => {
    const count = rowCount();
    if (count === 0) return;
    const selected = models().findIndex(isSelected);
    const next =
      highlight() < 0
        ? selected >= 0
          ? selected
          : step > 0
            ? 0
            : count - 1
        : Math.max(0, Math.min(count - 1, highlight() + step));
    setHighlight(next);
    showRow(next);
  };
  const pickTab = (next: string) => {
    setTab(next);
    setQuery("");
    setHighlight(-1);
    search()?.focus();
  };
  const railButtons = () =>
    Array.from(rail()?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
  const focusRail = () => {
    const buttons = railButtons();
    (
      buttons.find((button) => button.getAttribute("aria-pressed") === "true") ?? buttons[0]
    )?.focus();
  };

  onMount(() => {
    search()?.focus();
    showRow(Math.max(0, models().findIndex(isSelected)));
  });

  return (
    <div
      class={PICKER_GRID}
      data-searching={searching() ? "" : undefined}
      data-model-picker
      data-tip-group
      data-tip-delay="0"
    >
      <div
        class="flex w-11 flex-col gap-1 overflow-y-auto bg-muted/30 p-1 [grid-area:providers] [scrollbar-width:none] group-data-searching/picker:hidden"
        role="toolbar"
        aria-label="Providers"
        aria-orientation="vertical"
        ref={setRail}
        onKeyDown={(event) => {
          if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
          if (event.key === "ArrowRight") {
            event.preventDefault();
            search()?.focus();
            return;
          }
          const step = arrowStep(event.key);
          if (step === null) return;
          if (focusStep(railButtons(), step, "wrap") !== undefined) event.preventDefault();
        }}
      >
        <button
          type="button"
          class={`${PROVIDER_TAB} [&_svg]:fill-current`}
          aria-pressed={tab() === FAVORITES_TAB && query() === ""}
          aria-label="Favorites"
          data-tip="Favorites"
          data-tip-side="right"
          onClick={() => pickTab(FAVORITES_TAB)}
        >
          <Star />
        </button>
        <span class="flex-none border-t border-border/70" />
        <For each={providers()}>
          {(provider) => (
            <button
              type="button"
              class={PROVIDER_TAB}
              aria-pressed={tab() === provider.InstanceId && query() === ""}
              aria-label={provider.Name}
              data-tip={
                blockOf(provider.InstanceId) === null
                  ? provider.Name
                  : `${provider.Name} is unavailable in this thread. Start a new thread to switch providers.`
              }
              data-tip-side="right"
              disabled={blockOf(provider.InstanceId) !== null}
              onClick={() => pickTab(provider.InstanceId)}
            >
              <ProviderGlyph driver={provider.Driver} name={provider.Name} />
            </button>
          )}
        </For>
      </div>
      <div class="flex min-h-0 flex-col border-r border-l border-border/70 bg-muted/40 [grid-area:models] group-data-searching/picker:border-l-0 max-sm:border-r-0">
        <label
          class={`${COLUMN_HEAD} flex items-center gap-2 transition-[border-color] focus-within:border-ring [&_svg]:size-3.5 [&_svg]:flex-none`}
        >
          <Search />
          <input
            class="h-[26px] min-w-0 flex-1 border-0 bg-transparent px-0.5 text-[14px] text-foreground outline-none"
            data-model-search
            ref={setSearch}
            type="text"
            placeholder="Search models..."
            aria-label="Search models"
            value={query()}
            onInput={(event) => {
              setQuery(event.currentTarget.value);
              setHighlight(searching() && rowCount() > 0 ? 0 : -1);
            }}
            onKeyDown={(event) => {
              if (event.isComposing) return;
              if (
                !event.altKey &&
                !event.ctrlKey &&
                !event.metaKey &&
                !searching() &&
                ((event.key === "ArrowLeft" && !event.shiftKey && query() === "") ||
                  (event.key === "Tab" && event.shiftKey))
              ) {
                event.preventDefault();
                focusRail();
              } else if (arrowStep(event.key) !== null) {
                event.preventDefault();
                moveHighlight(arrowStep(event.key)!);
              } else if (event.key === "Enter") {
                event.preventDefault();
                chooseRow(highlight());
              } else if (
                event.key === "ArrowRight" &&
                event.currentTarget.selectionStart === query().length
              ) {
                const model = models()[highlight()];
                if (model !== undefined && !isSelected(model)) choose(model);
                else if (focusEffort()) event.preventDefault();
              }
            }}
          />
        </label>
        <ul
          class="m-0 min-h-0 flex-1 list-none overflow-y-auto overscroll-contain p-2"
          role="listbox"
          aria-label="Models"
          ref={setListElement}
        >
          <For
            each={models()}
            fallback={
              <li class={EMPTY}>
                {tab() === FAVORITES_TAB && query() === "" ? "No favorites yet" : "No models found"}
              </li>
            }
          >
            {(model, index) => (
              <li
                role="option"
                aria-selected={isSelected(model)}
                aria-disabled={blockOf(model.InstanceId) !== null}
                class={`${MODEL_ROW} aria-disabled:cursor-not-allowed aria-disabled:opacity-50`}
                data-highlighted={index() === highlight() ? "" : undefined}
                data-tip={blockOf(model.InstanceId) ?? undefined}
                data-tip-side="left"
                onPointerMove={() => setHighlight(index())}
                onClick={() => choose(model)}
              >
                <span class="inline-flex flex-none">
                  <ProviderGlyph driver={model.Driver} name={model.ProviderName} size={14} />
                </span>
                <span class="min-w-0 flex-initial truncate">
                  {model.Name}
                  <span class="sr-only">, {model.ProviderName}</span>
                </span>
                <Show when={model.IsUnavailable}>
                  <span class="flex-none rounded border border-border px-1 text-[10px] leading-4 font-medium text-muted-foreground">
                    Unavailable
                  </span>
                </Show>
                <Show when={isSelected(model)}>
                  <Check />
                </Show>
                <span class="flex-1" />
                <button
                  type="button"
                  class={`inline-flex size-6 flex-none cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-muted-foreground enabled:hover:bg-foreground/9 enabled:hover:text-foreground [&_svg]:size-3 ${model.IsFavorite ? "[&_svg]:fill-current [&_svg]:text-warning" : ""} ${!model.IsFavorite || tab() === FAVORITES_TAB ? "opacity-0 group-hover/row:opacity-100 group-data-highlighted/row:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100" : ""}`}
                  aria-label={model.IsFavorite ? "Remove from favorites" : "Add to favorites"}
                  data-tip={model.IsFavorite ? "Remove from favorites" : "Add to favorites"}
                  disabled={blockOf(model.InstanceId) !== null}
                  onClick={(event) => {
                    event.stopPropagation();
                    void environment.toggleModelFavorite(model.InstanceId, model.Slug);
                  }}
                >
                  <Star />
                </button>
              </li>
            )}
          </For>
          <Show when={list().Legacy}>
            {(legacy) => (
              <li
                role="option"
                aria-expanded={legacy().Expanded}
                class={`${MODEL_ROW} text-muted-foreground data-highlighted:text-foreground`}
                data-highlighted={highlight() === models().length ? "" : undefined}
                onPointerMove={() => setHighlight(models().length)}
                onClick={toggleLegacy}
              >
                {legacy().Expanded ? "Show less" : "Show more"}
              </li>
            )}
          </Show>
        </ul>
      </div>
      <div
        class="flex min-h-0 flex-col [grid-area:effort] max-sm:max-h-44 max-sm:border-t max-sm:border-l max-sm:border-border/70"
        ref={setColumn}
        onKeyDown={moveBetweenRows}
      >
        <div class={`${COLUMN_HEAD} flex h-8 items-center gap-2 text-[14px]`}>
          <span>
            {props.traits?.Effort?.Descriptor.label ??
              (props.traits?.Others.length ? "Options" : "Effort")}
          </span>
          <span class="ml-auto min-w-0 truncate text-[12px]">{session.effectiveModelName()}</span>
        </div>
        <div class="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overscroll-contain px-2 pt-2 pb-1.5">
          <Show
            when={
              props.traits !== null &&
              (props.traits.Effort !== null || props.traits.Others.length > 0)
            }
            fallback={<div class={EMPTY}>No effort levels</div>}
          >
            <Show when={props.traits!.Effort}>
              {(effort) => <EffortRows control={effort()} traits={props.traits!} />}
            </Show>
            <Show when={props.traits!.Others.length > 0}>
              <div
                class={`${STACK} ${props.traits!.Effort !== null ? "mt-1 border-t border-border/70 pt-1" : ""}`}
              >
                <For each={props.traits!.Others}>
                  {(control) =>
                    control.Kind === "boolean" ? (
                      <OptionSwitchRow descriptor={control.Descriptor} traits={props.traits!} />
                    ) : (
                      <OptionMenuRow descriptor={control.Descriptor} traits={props.traits!} />
                    )
                  }
                </For>
              </div>
            </Show>
          </Show>
        </div>
      </div>
      <PickerFooter traits={props.traits} />
    </div>
  );
}

function moveBetweenRows(event: KeyboardEvent & { currentTarget: HTMLElement }) {
  if (event.key === "ArrowLeft") {
    event.currentTarget
      .closest("[data-model-picker]")
      ?.querySelector<HTMLInputElement>("[data-model-search]")
      ?.focus();
    event.preventDefault();
    return;
  }
  const step = arrowStep(event.key);
  if (step === null) return;
  const rows = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>("[data-effort-row]:not(:disabled)"),
  );
  const next = focusStep(rows, step, "clamp");
  if (next === undefined) return;
  event.preventDefault();
  next.scrollIntoView({ block: "nearest" });
}

function usePick() {
  const session = ThreadSession.use();
  return {
    select: (traits: ITraits, descriptor: ISelectDescriptor, value: string) => {
      const current = session.effectiveModel();
      if (current === null) return;
      const next = withSelectValue(traits, current, descriptor, value);
      if (next !== null) void session.setModelSelection(next);
    },
    toggle: (traits: ITraits, descriptorId: string, value: boolean) => {
      const current = session.effectiveModel();
      if (current === null) return;
      void session.setModelSelection(withBooleanValue(traits, current, descriptorId, value));
    },
    value: (descriptor: ISelectDescriptor) => {
      const current = session.effectiveModel();
      return current === null ? "" : selectValue(descriptor, current);
    },
  };
}

function EffortRows(props: { control: IColumnControl; traits: ITraits }) {
  const pick = usePick();
  return (
    <div role="radiogroup" aria-label={props.control.Descriptor.label} class={STACK}>
      <Show
        when={
          props.control.Kind === "select" ? (props.control.Descriptor as ISelectDescriptor) : null
        }
        fallback={
          <For each={[true, false]}>
            {(value) => {
              const checked = () =>
                ((props.control.Descriptor as IBooleanDescriptor).currentValue === true) === value;
              return (
                <EffortRow
                  label={value ? "On" : "Off"}
                  selected={checked()}
                  onPick={() => pick.toggle(props.traits, props.control.Descriptor.id, value)}
                />
              );
            }}
          </For>
        }
      >
        {(descriptor) => (
          <For each={selectableProviderOptionChoices(descriptor())}>
            {(option) => (
              <EffortRow
                label={option.label}
                description={option.description}
                isDefault={option.isDefault === true}
                selected={pick.value(descriptor()) === option.id}
                onPick={() => pick.select(props.traits, descriptor(), option.id)}
              />
            )}
          </For>
        )}
      </Show>
    </div>
  );
}

function EffortRow(props: {
  label: string;
  description?: string | undefined;
  isDefault?: boolean;
  selected: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      class={`${EFFORT_ROW} py-0`}
      aria-checked={props.selected}
      tabIndex={props.selected ? 0 : -1}
      data-effort-row
      data-effort-level
      data-tip={props.description}
      data-tip-side="right"
      onClick={props.onPick}
    >
      <span class={ROW_TEXT}>{props.label}</span>
      <Show
        when={props.selected}
        fallback={
          <Show when={props.isDefault}>
            <span class="text-[12px] text-muted-foreground/70">Default</span>
          </Show>
        }
      >
        <Check />
      </Show>
    </button>
  );
}

function OptionMenuRow(props: { descriptor: ISelectDescriptor; traits: ITraits }) {
  const pick = usePick();
  const [open, setOpen] = createSignal(false);
  const choices = () => selectableProviderOptionChoices(props.descriptor);
  const current = () =>
    choices().find((choice) => choice.id === pick.value(props.descriptor))?.label ?? "";
  return (
    <>
      <button
        type="button"
        class={`${EFFORT_ROW} py-1`}
        data-effort-row
        tabIndex={-1}
        aria-expanded={open()}
        aria-label={`${props.descriptor.label}: ${current()}`}
        onClick={() => setOpen(!open())}
      >
        <span class={`${ROW_TEXT} flex flex-col`}>
          <span class={SMALL_MUTED}>{props.descriptor.label}</span>
          <span>{current()}</span>
        </span>
        <ChevronRight class={open() ? "rotate-90" : ""} />
      </button>
      <Show when={open()}>
        <div role="radiogroup" aria-label={props.descriptor.label} class={`${STACK} pl-2`}>
          <For each={choices()}>
            {(choice) => (
              <EffortRow
                label={choice.label}
                description={choice.description}
                isDefault={choice.isDefault === true}
                selected={pick.value(props.descriptor) === choice.id}
                onPick={() => {
                  pick.select(props.traits, props.descriptor, choice.id);
                  setOpen(false);
                }}
              />
            )}
          </For>
        </div>
      </Show>
    </>
  );
}

function OptionSwitchRow(props: { descriptor: IBooleanDescriptor; traits: ITraits }) {
  const pick = usePick();
  const checked = () => props.descriptor.currentValue === true;
  return (
    <button
      type="button"
      role="switch"
      class={`${EFFORT_ROW} py-1`}
      aria-checked={checked()}
      aria-label={props.descriptor.label}
      data-effort-row
      tabIndex={-1}
      onClick={() => pick.toggle(props.traits, props.descriptor.id, !checked())}
    >
      <span class={`${ROW_TEXT} flex flex-col`}>
        <span class={SMALL_MUTED}>{props.descriptor.label}</span>
        <span>{checked() ? "On" : "Off"}</span>
      </span>
      <MenuSwitch on={checked()} />
    </button>
  );
}

function PickerFooter(props: { traits: ITraits | null }) {
  const session = ThreadSession.use();
  const pick = usePick();
  const [permissionsOpen, setPermissionsOpen] = createSignal(false);
  const mode = () => RUNTIME_MODE_CONFIG[session.effectiveRuntimeMode()];
  const [permissions, setPermissions] = createSignal<HTMLButtonElement>();
  return (
    <div class="flex flex-wrap items-center gap-2 border-t border-border/70 bg-muted/40 px-3 py-2 [grid-area:footer]">
      <Show when={props.traits?.Speed ?? null}>
        {(speed) => (
          <Segmented role="radiogroup" aria-label={speed().label}>
            <For each={selectableProviderOptionChoices(speed())}>
              {(option) => (
                <Segment
                  labelled
                  role="radio"
                  aria-checked={pick.value(speed()) === option.id}
                  data-tip={option.description}
                  onClick={() => pick.select(props.traits!, speed(), option.id)}
                >
                  <Show when={option.label === "Fast" || option.label === "Ultrafast"}>
                    <Zap class={boltClass(option.label === "Ultrafast")} />
                  </Show>
                  {option.label}
                </Segment>
              )}
            </For>
          </Segmented>
        )}
      </Show>
      <Show when={props.traits?.Speed === null ? props.traits.Fast : null}>
        {(fast) => (
          <Segmented role="radiogroup" aria-label={fast().label}>
            <For each={[false, true]}>
              {(value) => (
                <Segment
                  labelled
                  role="radio"
                  aria-checked={(fast().currentValue === true) === value}
                  onClick={() => pick.toggle(props.traits!, fast().id, value)}
                >
                  <Show when={value}>
                    <Zap class={boltClass(false)} />
                  </Show>
                  {value ? "Fast" : "Standard"}
                </Segment>
              )}
            </For>
          </Segmented>
        )}
      </Show>
      <Show when={props.traits?.Ultracode ?? null}>
        {(ultracode) => (
          <Segmented>
            <Segment
              labelled
              aria-pressed={ultracode().currentValue === true}
              onClick={() =>
                pick.toggle(props.traits!, ultracode().id, ultracode().currentValue !== true)
              }
            >
              <Workflow />
              {ultracode().label}
            </Segment>
          </Segmented>
        )}
      </Show>
      <button
        type="button"
        class={`ml-auto flex h-7 cursor-pointer items-center gap-1.5 rounded-md border-0 bg-transparent px-2 py-0 text-[12px] text-muted-foreground ${OPEN_HOVER} [&_svg]:size-3.5 [&_svg:last-child]:size-3`}
        ref={setPermissions}
        aria-label={`Permissions: ${mode().Label}`}
        aria-haspopup="menu"
        aria-expanded={permissionsOpen()}
        onClick={() => setPermissionsOpen(!permissionsOpen())}
        onKeyDown={(event) => openMenuFromKeys(event, () => setPermissionsOpen(true))}
      >
        <Dynamic component={mode().Icon} />
        {mode().Label}
        <ChevronUp />
      </button>
      <Presence when={permissionsOpen() && permissions()}>
        {(anchor) => (
          <PermissionsPopup
            anchor={anchor()}
            align="end"
            onClose={() => setPermissionsOpen(false)}
          />
        )}
      </Presence>
    </div>
  );
}
