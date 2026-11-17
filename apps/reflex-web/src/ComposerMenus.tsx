import { selectableProviderOptionChoices } from "@t3tools/client-runtime/model-traits";
import { type Component, createMemo, createSignal, For, type JSX, onMount, Show } from "solid-js";
import { Dynamic } from "solid-js/web";

import { ProviderIcon } from "./brand";
import Environment from "./Environment";
import {
  Check,
  ChevronRight,
  ChevronUp,
  Lock,
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
import { Popup } from "./ui/Menu";
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
const RUNTIME_MODE_CONFIG: Record<
  IWireRuntimeMode,
  { Label: string; Description: string; Icon: Component }
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

const MARGIN = 8;
const GAP = 4;

/** A popup that opens above its anchor, portalled so the composer's glass can't clip it. */
function Anchored(props: {
  anchor: HTMLElement;
  align: "start" | "end";
  label: string;
  class: string;
  onClose: () => void;
  children: JSX.Element;
}) {
  const place = (popup: HTMLElement) => {
    const rect = props.anchor.getBoundingClientRect();
    const width = popup.offsetWidth;
    const left = props.align === "start" ? rect.left : rect.right - width;
    popup.style.left = `${Math.max(MARGIN, Math.min(left, window.innerWidth - width - MARGIN))}px`;
    popup.style.bottom = `${window.innerHeight - rect.top + GAP}px`;
    popup.style.maxHeight = `${rect.top - GAP - MARGIN}px`;
  };
  return (
    <Popup
      portal
      role="dialog"
      class={`composer-popup ${props.class}`}
      label={props.label}
      anchor={props.anchor}
      place={place}
      onClose={(reason) => {
        // Closing unmounts the <Show> the anchor comes from, so it's read first.
        const anchor = props.anchor;
        props.onClose();
        if (reason === "escape") anchor.focus();
      }}
    >
      {props.children}
    </Popup>
  );
}

function PermissionsSection(props: {
  mode: IWireRuntimeMode;
  modes: ReadonlyArray<IWireRuntimeMode>;
  onPick: (mode: IWireRuntimeMode) => void;
}) {
  const [preview, setPreview] = createSignal<IWireRuntimeMode | null>(null);
  const shown = () => RUNTIME_MODE_CONFIG[preview() ?? props.mode];
  const [group, setGroup] = createSignal<HTMLDivElement>();
  onMount(() =>
    group()?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus({ preventScroll: true }),
  );
  return (
    <div class="permissions-section">
      <div class="section-label">Permissions</div>
      <Segmented
        role="radiogroup"
        aria-label="Permissions"
        ref={setGroup}
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          const items = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]'),
          );
          const index = items.findIndex((item) => item === document.activeElement);
          const next = items[index + (event.key === "ArrowRight" ? 1 : -1)];
          if (index < 0 || next === undefined) return;
          event.preventDefault();
          next.focus();
        }}
      >
        <For each={props.modes}>
          {(mode) => (
            <Segment
              role="radio"
              aria-checked={mode === props.mode}
              aria-label={RUNTIME_MODE_CONFIG[mode].Label}
              tabIndex={mode === props.mode ? 0 : -1}
              onPointerEnter={() => setPreview(mode)}
              onPointerLeave={() => setPreview(null)}
              onFocus={() => setPreview(mode)}
              onBlur={() => setPreview(null)}
              onClick={() => props.onPick(mode)}
            >
              <Dynamic component={RUNTIME_MODE_CONFIG[mode].Icon} />
            </Segment>
          )}
        </For>
      </Segmented>
      <div class="permissions-preview" aria-hidden="true">
        <span classList={{ current: (preview() ?? props.mode) === props.mode }}>
          {shown().Label}
        </span>
        <span class="description">{shown().Description}</span>
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
    <Anchored
      anchor={props.anchor}
      align={props.align}
      label="Permissions"
      class="permissions-popup"
      onClose={props.onClose}
    >
      <PermissionsSection
        mode={session.effectiveRuntimeMode()}
        modes={session.runtimeModes()}
        onPick={(picked) => {
          session.setRuntimeMode(picked);
          const anchor = props.anchor;
          props.onClose();
          anchor.focus();
        }}
      />
    </Anchored>
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
        class={props.context ? "context-control" : "composer-control"}
        classList={{ open: open() }}
        ref={setTrigger}
        aria-label={`Permissions: ${mode().Label}`}
        aria-expanded={open()}
        data-tip={`Permissions: ${mode().Label}. ${mode().Description}`}
        onClick={() => setOpen(!open())}
      >
        <Dynamic component={mode().Icon} />
        <span class="control-label">{mode().Label}</span>
      </button>
      <Show when={open() && trigger()}>
        {(anchor) => (
          <PermissionsPopup
            anchor={anchor()}
            align={props.context ? "end" : "start"}
            onClose={() => setOpen(false)}
          />
        )}
      </Show>
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
      <button
        type="button"
        class="composer-control model-trigger"
        classList={{ open: open() }}
        ref={setTrigger}
        aria-label={`Model: ${name()}${suffix()?.Detail ? `, ${suffix()!.Detail}` : ""}`}
        aria-expanded={open()}
        data-tip={suffix()?.Detail ?? undefined}
        onClick={() => setOpen(!open())}
      >
        <ProviderIcon driver={session.effectiveModelDriver()} />
        <span class="control-label">{name()}</span>
        <Show when={suffix()}>
          {(shown) => (
            <span class="model-suffix">
              <Show when={shown().Word}>
                {(word) => <span class="control-label">{word()}</span>}
              </Show>
              <Show when={shown().Speed}>
                <Zap class="fast-bolt" classList={{ ultra: shown().Speed === "Ultrafast" }} />
              </Show>
              <Show when={shown().Ultracode}>
                <Workflow />
              </Show>
              <Show when={shown().ContextWindow}>
                {(window) => <span class="control-label secondary">{window()}</span>}
              </Show>
            </span>
          )}
        </Show>
      </button>
      <Show when={open() && trigger()}>
        {(anchor) => (
          <Anchored
            anchor={anchor()}
            align="end"
            label="Model"
            class="model-popup"
            onClose={() => setOpen(false)}
          >
            <PickerContent traits={traits()} />
          </Anchored>
        )}
      </Show>
    </>
  );
}

function ProviderGlyph(props: { driver: string | undefined; name: string; size?: number }) {
  return (
    <Show
      when={props.driver === "claudeAgent" || props.driver === "codex"}
      fallback={<span class="provider-letter">{props.name.slice(0, 1)}</span>}
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
    <div class="model-picker" classList={{ searching: searching() }}>
      <div
        class="picker-providers"
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
          class="provider-tab favorites-tab"
          aria-pressed={tab() === FAVORITES_TAB && query() === ""}
          aria-label="Favorites"
          data-tip="Favorites"
          data-tip-side="right"
          onClick={() => pickTab(FAVORITES_TAB)}
        >
          <Star />
        </button>
        <span class="provider-divider" />
        <For each={providers()}>
          {(provider) => (
            <button
              type="button"
              class="provider-tab"
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
      <div class="picker-models">
        <label class="picker-search">
          <Search />
          <input
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
        <ul class="picker-list" role="listbox" aria-label="Models" ref={setListElement}>
          <For
            each={models()}
            fallback={
              <li class="picker-empty">
                {tab() === FAVORITES_TAB && query() === "" ? "No favorites yet" : "No models found"}
              </li>
            }
          >
            {(model, index) => (
              <li
                role="option"
                aria-selected={isSelected(model)}
                aria-disabled={blockOf(model.InstanceId) !== null}
                class="picker-model"
                classList={{ highlighted: index() === highlight() }}
                data-tip={blockOf(model.InstanceId) ?? undefined}
                onPointerMove={() => setHighlight(index())}
                onClick={() => choose(model)}
              >
                <span class="picker-model-icon">
                  <ProviderGlyph driver={model.Driver} name={model.ProviderName} size={14} />
                </span>
                <span class="picker-model-name">
                  {model.Name}
                  <span class="sr-only">, {model.ProviderName}</span>
                </span>
                <Show when={isSelected(model)}>
                  <Check />
                </Show>
                <span class="picker-model-spacer" />
                <button
                  type="button"
                  class="favorite-star"
                  classList={{
                    on: model.IsFavorite,
                    "hover-only": !model.IsFavorite || tab() === FAVORITES_TAB,
                  }}
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
                class="picker-model picker-more"
                classList={{ highlighted: highlight() === models().length }}
                onPointerMove={() => setHighlight(models().length)}
                onClick={toggleLegacy}
              >
                {legacy().Expanded ? "Show less" : "Show more"}
              </li>
            )}
          </Show>
        </ul>
      </div>
      <div class="picker-effort" ref={setColumn} onKeyDown={moveBetweenRows}>
        <div class="effort-header">
          <span>
            {props.traits?.Effort?.Descriptor.label ??
              (props.traits?.Others.length ? "Options" : "Effort")}
          </span>
          <span class="effort-model">{session.effectiveModelName()}</span>
        </div>
        <div class="effort-rows">
          <Show
            when={
              props.traits !== null &&
              (props.traits.Effort !== null || props.traits.Others.length > 0)
            }
            fallback={<div class="effort-none">No effort levels</div>}
          >
            <Show when={props.traits!.Effort}>
              {(effort) => <EffortRows control={effort()} traits={props.traits!} />}
            </Show>
            <Show when={props.traits!.Others.length > 0}>
              <div class="effort-others" classList={{ divided: props.traits!.Effort !== null }}>
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
      .closest(".model-picker")
      ?.querySelector<HTMLInputElement>(".picker-search input")
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
    <div role="radiogroup" aria-label={props.control.Descriptor.label} class="effort-group">
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
      class="effort-row"
      aria-checked={props.selected}
      tabIndex={props.selected ? 0 : -1}
      data-effort-row
      data-effort-level
      data-tip={props.description}
      data-tip-side="right"
      onClick={props.onPick}
    >
      <span class="effort-label">{props.label}</span>
      <Show
        when={props.selected}
        fallback={
          <Show when={props.isDefault}>
            <span class="effort-default">Default</span>
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
        class="effort-row option-row"
        data-effort-row
        tabIndex={-1}
        aria-expanded={open()}
        aria-label={`${props.descriptor.label}: ${current()}`}
        onClick={() => setOpen(!open())}
      >
        <span class="option-text">
          <span class="option-name">{props.descriptor.label}</span>
          <span>{current()}</span>
        </span>
        <ChevronRight classList={{ turned: open() }} />
      </button>
      <Show when={open()}>
        <div role="radiogroup" aria-label={props.descriptor.label} class="option-choices">
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
      class="effort-row option-row"
      aria-checked={checked()}
      aria-label={props.descriptor.label}
      data-effort-row
      tabIndex={-1}
      onClick={() => pick.toggle(props.traits, props.descriptor.id, !checked())}
    >
      <span class="option-text">
        <span class="option-name">{props.descriptor.label}</span>
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
    <div class="picker-footer">
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
                    <Zap class="fast-bolt" classList={{ ultra: option.label === "Ultrafast" }} />
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
                    <Zap class="fast-bolt" />
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
        class="footer-permissions"
        classList={{ open: permissionsOpen() }}
        ref={setPermissions}
        aria-label={`Permissions: ${mode().Label}`}
        aria-expanded={permissionsOpen()}
        onClick={() => setPermissionsOpen(!permissionsOpen())}
      >
        <Dynamic component={mode().Icon} />
        {mode().Label}
        <ChevronUp />
      </button>
      <Show when={permissionsOpen() && permissions()}>
        {(anchor) => (
          <PermissionsPopup
            anchor={anchor()}
            align="end"
            onClose={() => setPermissionsOpen(false)}
          />
        )}
      </Show>
    </div>
  );
}
