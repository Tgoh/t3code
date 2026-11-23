import { selectableProviderOptionChoices } from "@t3tools/client-runtime/model-traits";
import { Dynamic } from "@solidjs/web";
import { type Component, createMemo, createSignal, For, onSettled, Show, untrack } from "solid-js";

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
  ShieldCheck,
  ShieldOff,
  Star,
  Workflow,
  Zap,
} from "./icons";
import type { IWireRuntimeMode } from "./Infrastructure/commandEffects";
import { arrowStep, focusStep } from "./listNavigation";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxListVirtualized,
  ComboboxSearchInput,
} from "./ui/Combobox";
import { MenuPopup, MenuRadioGroup, MenuRadioItem, openMenuFromKeys } from "./ui/Menu";
import { PopoverPopup } from "./ui/Popover";
import { Presence } from "./ui/Presence";
import { createScrollEnds, getVirtualizedScrollFadeClassName } from "./ui/ScrollArea";
import { Switch } from "./ui/Switch";
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

const SEGMENTS = "flex rounded-lg bg-input/40 p-0.5";
const FOOTER_SEGMENT =
  "flex h-6 cursor-pointer items-center justify-center gap-1 px-2 text-muted-foreground text-xs outline-none first:rounded-l-md last:rounded-r-md hover:text-foreground data-checked:bg-input/72 data-checked:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset";

const OPEN_HOVER =
  "hover:bg-foreground/9 hover:text-foreground aria-expanded:bg-foreground/9 aria-expanded:text-foreground";
const COMPOSER_CONTROL = `inline-flex h-7 min-w-0 flex-initial cursor-pointer items-center gap-1.5 rounded-lg border-0 bg-transparent px-2 py-0 text-[14px] leading-5 font-medium whitespace-nowrap text-foreground/80 ${OPEN_HOVER} [&>svg]:size-4 [&>svg]:flex-none`;
const LABEL = "min-w-0 overflow-hidden text-ellipsis";
const SMALL_MUTED = "text-[12px] text-muted-foreground";
const EMPTY = "px-2 py-1.5 text-[14px] text-muted-foreground";
const STACK = "flex flex-col gap-0.5";
const ROW_TEXT = "min-w-0 flex-1 truncate";
const COLUMN_HEAD = "mx-3 mt-2.5 mb-0 border-b border-border/70 pb-1.5 text-muted-foreground";
const MODEL_LIST = "relative min-h-0 overflow-hidden pr-px";
const MODEL_SCROLLER =
  "scrollbar-gutter-stable h-full overflow-x-hidden overscroll-y-contain py-1.5 [&::-webkit-scrollbar-track]:my-2";
const STAR_ON_HOVER =
  "opacity-0 group-hover:opacity-100 group-data-highlighted:opacity-100 in-focus-visible:opacity-100 pointer-coarse:opacity-100";
const EFFORT_ROW =
  "flex min-h-8 w-full flex-none cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent px-2 text-left text-[14px] text-foreground hover:bg-foreground/9 focus-visible:bg-foreground/9 [&>svg]:size-3.5 [&>svg]:flex-none";
const PROVIDER_TAB =
  "relative flex aspect-square w-full flex-none cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-foreground enabled:hover:bg-foreground/10 focus-visible:bg-foreground/10 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40 aria-pressed:after:absolute aria-pressed:after:top-[calc(50%-10px)] aria-pressed:after:right-0 aria-pressed:after:h-5 aria-pressed:after:w-[3px] aria-pressed:after:rounded-full aria-pressed:after:bg-primary [&_svg]:size-5";
const PICKER_GRID =
  "group/picker grid min-h-0 flex-1 grid-cols-[auto_minmax(0,1fr)_11.75rem] grid-rows-[minmax(0,1fr)_auto] [grid-template-areas:'providers_models_effort'_'footer_footer_footer'] data-searching:grid-cols-[minmax(0,1fr)_11.75rem] data-searching:[grid-template-areas:'models_effort'_'footer_footer'] max-sm:grid-cols-[auto_minmax(0,1fr)] max-sm:grid-rows-[minmax(0,1fr)_minmax(0,auto)_auto] max-sm:[grid-template-areas:'providers_models'_'providers_effort'_'footer_footer'] max-sm:data-searching:grid-cols-[minmax(0,1fr)_11.75rem] max-sm:data-searching:[grid-template-areas:'models_effort'_'footer_footer']";

const boltClass = (ultra: boolean) => (ultra ? "fill-current text-primary" : "fill-current");

function PermissionsSection(props: {
  mode: IWireRuntimeMode;
  modes: ReadonlyArray<IWireRuntimeMode>;
  onPick: (mode: IWireRuntimeMode) => void;
}) {
  const [preview, setPreview] = createSignal<IWireRuntimeMode | null>(null);
  const shown = () => RUNTIME_MODE_CONFIG[preview() ?? props.mode];
  const [section, setSection] = createSignal<HTMLDivElement>();
  onSettled(() => {
    section()
      ?.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]')
      ?.focus({ preventScroll: true });
  });
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
      aria-pressed={!keep() ? "true" : "false"}
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
        aria-expanded={open() ? "true" : "false"}
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
        aria-expanded={open() ? "true" : "false"}
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

const LEGACY_KEY = "legacy";

const modelKey = (instanceId: string, slug: string) => `${instanceId}\u0000${slug}`;

function ModelListRow(props: {
  model: IPickerModel;
  selected: boolean;
  /** In Favorites every row is starred, so the star shows only on hover. */
  favoriteStarOnHover: boolean;
  disabledReason: string | null;
  onChoose: () => void;
  onToggleFavorite: () => void;
}) {
  const favoriteLabel = () =>
    props.model.IsFavorite ? "Remove from favorites" : "Add to favorites";
  const starClass = () =>
    [
      "size-3.5 sm:size-3",
      props.model.IsFavorite && "fill-current text-warning",
      (!props.model.IsFavorite || props.favoriteStarOnHover) && STAR_ON_HOVER,
    ]
      .filter(Boolean)
      .join(" ");
  return (
    <ComboboxItem
      value={modelKey(props.model.InstanceId, props.model.Slug)}
      disabled={props.disabledReason !== null}
      pointerWhenDisabled={props.disabledReason !== null}
      selectedFill={false}
      class="group relative w-full !min-w-0 max-w-full cursor-pointer"
      data-tip={props.disabledReason ?? undefined}
      data-tip-side="left"
      onClick={props.onChoose}
    >
      <span class="inline-flex size-4 flex-none items-center justify-center">
        <ProviderGlyph driver={props.model.Driver} name={props.model.ProviderName} size={16} />
      </span>
      <div class="flex min-w-0 flex-1 items-center gap-2 text-left">
        <div class="min-w-0 truncate text-sm font-normal leading-snug">
          {props.model.Name}
          <span class="sr-only">, {props.model.ProviderName}</span>
        </div>
        <Show when={props.selected}>
          <Check class="size-3.5 shrink-0" aria-hidden="true" />
        </Show>
        <Show when={props.model.IsUnavailable}>
          <Badge variant="outline" size="sm">
            Unavailable
          </Badge>
        </Show>
      </div>
      <div class="flex shrink-0 items-center gap-1.5">
        <Button
          size="icon-xs"
          variant="ghost-muted"
          aria-label={favoriteLabel()}
          data-tip={favoriteLabel()}
          data-tip-side="top"
          disabled={props.disabledReason !== null}
          onClick={(event) => {
            event.stopPropagation();
            props.onToggleFavorite();
          }}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <Star class={starClass()} />
        </Button>
      </div>
    </ComboboxItem>
  );
}

function PickerContent(props: { traits: ITraits | null }) {
  const environment = Environment.use();
  const session = ThreadSession.use();
  const providers = () => environment.state.Replica.Providers;
  const favorites = () => environment.state.Replica.ModelFavorites;
  const selection = () => session.effectiveModel();
  const [tab, setTab] = createSignal(
    untrack(() =>
      initialPickerTab({
        Providers: providers(),
        Favorites: favorites(),
        ActiveInstanceId: selection()?.instanceId ?? null,
        Started: session.modelSwitch().Started,
      }),
    ),
  );
  const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(
    untrack(
      () =>
        new Set(
          legacyStartsExpanded(providers(), favorites(), selection())
            ? [selection()!.instanceId]
            : [],
        ),
    ),
  );
  const [query, setQuery] = createSignal("");
  const [highlighted, setHighlighted] = createSignal<string | null>(null);
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
  const [rail, setRail] = createSignal<HTMLDivElement>();
  const searching = () => query().trim() !== "";
  const { ends: scrollEnds, track: trackScroll } = createScrollEnds();
  const activeKey = () => {
    const held = selection();
    return held === null ? null : modelKey(held.instanceId, held.model);
  };

  const focusEffort = () => {
    const held = column();
    const row =
      held?.querySelector<HTMLElement>('[data-effort-level][aria-checked="true"]:not(:disabled)') ??
      held?.querySelector<HTMLElement>("[data-effort-level]:not(:disabled)") ??
      held?.querySelector<HTMLElement>("[data-effort-row]:not(:disabled)");
    row?.focus({ preventScroll: true });
    return row != null;
  };
  const choose = (model: IPickerModel) => {
    if (blockOf(model.InstanceId) !== null) return;
    void session.chooseModel(model.InstanceId, model.Slug);
    requestAnimationFrame(() => {
      if (!focusEffort()) search()?.focus();
    });
  };
  const highlightedModel = () =>
    models().find((model) => modelKey(model.InstanceId, model.Slug) === highlighted());
  const pickTab = (next: string) => {
    setTab(next);
    setQuery("");
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

  onSettled(() => {
    search()?.focus();
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
          aria-pressed={tab() === FAVORITES_TAB && query() === "" ? "true" : "false"}
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
              aria-pressed={tab() === provider.InstanceId && query() === "" ? "true" : "false"}
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
      <Combobox value={activeKey()} onItemHighlighted={setHighlighted}>
        <div class="flex min-h-0 flex-col border-r border-l border-border/70 bg-muted/40 [grid-area:models] group-data-searching/picker:border-l-0 max-sm:border-r-0">
          <ComboboxSearchInput
            data-model-search
            ref={setSearch}
            type="text"
            placeholder="Search models..."
            aria-label="Search models"
            value={query()}
            onInput={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
              if (
                !searching() &&
                ((event.key === "ArrowLeft" && !event.shiftKey && query() === "") ||
                  (event.key === "Tab" && event.shiftKey))
              ) {
                event.preventDefault();
                focusRail();
              } else if (
                event.key === "ArrowRight" &&
                !event.shiftKey &&
                event.currentTarget.selectionStart === query().length
              ) {
                const model = highlightedModel();
                if (model !== undefined && !isSelected(model)) choose(model);
                else if (focusEffort()) event.preventDefault();
              }
            }}
          />
          <div class={`${MODEL_LIST} ${rowCount() > 0 ? "flex-1" : "h-0"}`}>
            <ComboboxListVirtualized inline aria-label="Models">
              <div
                ref={trackScroll}
                class={`${MODEL_SCROLLER} ${getVirtualizedScrollFadeClassName(scrollEnds())}`}
                style={{ "overflow-y": "auto" }}
              >
                <div class="pl-2 pr-px">
                  <For each={models()}>
                    {(model, index) => (
                      <>
                        <Show when={index() > 0}>
                          <div class="h-0.5" />
                        </Show>
                        <ModelListRow
                          model={model}
                          selected={isSelected(model)}
                          favoriteStarOnHover={tab() === FAVORITES_TAB && !searching()}
                          disabledReason={blockOf(model.InstanceId)}
                          onChoose={() => choose(model)}
                          onToggleFavorite={() =>
                            void environment.toggleModelFavorite(model.InstanceId, model.Slug)
                          }
                        />
                      </>
                    )}
                  </For>
                  <Show when={list().Legacy}>
                    {(legacy) => (
                      <>
                        <Show when={models().length > 0}>
                          <div class="h-0.5" />
                        </Show>
                        <ComboboxItem
                          value={LEGACY_KEY}
                          aria-expanded={legacy().Expanded ? "true" : "false"}
                          class="group w-full cursor-pointer"
                          onClick={toggleLegacy}
                        >
                          <span class="text-sm leading-snug text-muted-foreground group-hover:text-foreground group-data-highlighted:text-foreground">
                            {legacy().Expanded ? "Show less" : "Show more"}
                          </span>
                        </ComboboxItem>
                      </>
                    )}
                  </Show>
                </div>
              </div>
            </ComboboxListVirtualized>
          </div>
          <ComboboxEmpty class="empty:h-0">
            <Show when={rowCount() === 0}>
              {tab() === FAVORITES_TAB && query() === "" ? "No favorites yet" : "No models found"}
            </Show>
          </ComboboxEmpty>
        </div>
      </Combobox>
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
      aria-checked={props.selected ? "true" : "false"}
      tabindex={props.selected ? 0 : -1}
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
        tabindex={-1}
        aria-expanded={open() ? "true" : "false"}
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
    <label class={`${EFFORT_ROW} py-1 has-focus-visible:bg-foreground/9`}>
      <span class={`${ROW_TEXT} flex flex-col`}>
        <span class={SMALL_MUTED}>{props.descriptor.label}</span>
        <span>{checked() ? "On" : "Off"}</span>
      </span>
      <Switch
        size="sm"
        checked={checked()}
        aria-label={props.descriptor.label}
        data-effort-row
        tabindex={-1}
        onCheckedChange={(next) => pick.toggle(props.traits, props.descriptor.id, next)}
      />
    </label>
  );
}

function SpeedSegment(props: {
  checked: boolean;
  label: string;
  tip?: string | undefined;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={props.checked ? "true" : "false"}
      data-checked={props.checked ? "true" : undefined}
      class={FOOTER_SEGMENT}
      data-tip={props.tip}
      onClick={props.onPick}
    >
      <Show when={props.label === "Fast" || props.label === "Ultrafast"}>
        <Zap class={`size-3 ${boltClass(props.label === "Ultrafast")}`} />
      </Show>
      {props.label}
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
          <div role="radiogroup" aria-label={speed().label} class={SEGMENTS}>
            <For each={selectableProviderOptionChoices(speed())}>
              {(option) => (
                <SpeedSegment
                  checked={pick.value(speed()) === option.id}
                  label={option.label}
                  tip={option.description}
                  onPick={() => pick.select(props.traits!, speed(), option.id)}
                />
              )}
            </For>
          </div>
        )}
      </Show>
      <Show when={props.traits?.Speed === null ? props.traits.Fast : null}>
        {(fast) => (
          <div role="radiogroup" aria-label={fast().label} class={SEGMENTS}>
            <For each={[false, true]}>
              {(value) => (
                <SpeedSegment
                  checked={(fast().currentValue === true) === value}
                  label={value ? "Fast" : "Standard"}
                  onPick={() => pick.toggle(props.traits!, fast().id, value)}
                />
              )}
            </For>
          </div>
        )}
      </Show>
      <Show when={props.traits?.Ultracode ?? null}>
        {(ultracode) => (
          <div class={SEGMENTS}>
            <button
              type="button"
              class={FOOTER_SEGMENT}
              aria-pressed={ultracode().currentValue === true ? "true" : "false"}
              data-checked={ultracode().currentValue === true ? "true" : undefined}
              onClick={() =>
                pick.toggle(props.traits!, ultracode().id, ultracode().currentValue !== true)
              }
            >
              <Workflow class="size-3" />
              {ultracode().label}
            </button>
          </div>
        )}
      </Show>
      <button
        type="button"
        class={`ml-auto flex h-7 cursor-pointer items-center gap-1.5 rounded-md border-0 bg-transparent px-2 py-0 text-[12px] text-muted-foreground ${OPEN_HOVER} [&_svg]:size-3.5 [&_svg:last-child]:size-3`}
        ref={setPermissions}
        aria-label={`Permissions: ${mode().Label}`}
        aria-haspopup="menu"
        aria-expanded={permissionsOpen() ? "true" : "false"}
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
