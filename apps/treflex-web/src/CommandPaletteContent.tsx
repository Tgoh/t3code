import type { JSX } from "@solidjs/web";
import { children, Show } from "solid-js";

import { ArrowDown, ArrowLeft, ArrowUp, ChevronRight } from "./icons";
import { Button } from "./ui/Button";
import {
  CommandFooter,
  CommandInput,
  CommandItem,
  CommandPanel,
  CommandShortcut,
  type ICommandInputEndInset,
} from "./ui/Command";
import { Kbd, KbdGroup } from "./ui/Kbd";

export const ITEM_ICON_CLASS = "size-4 text-icon-muted";

/** The input, panel and key-hint footer every palette view shares. */
export function CommandPaletteContent(props: {
  inputProps: Omit<Parameters<typeof CommandInput>[0], "startAddon" | "endInset">;
  startAddon?: JSX.Element;
  endInset?: ICommandInputEndInset;
  inputAccessory?: JSX.Element;
  footerActionLabel?: string | null;
  footerTrailing?: JSX.Element;
  showBackHint: boolean;
  children: JSX.Element;
}) {
  return (
    <>
      <div class="relative">
        <CommandInput
          {...props.inputProps}
          startAddon={props.startAddon}
          endInset={props.endInset}
        />
        {props.inputAccessory}
      </div>
      <CommandPanel class="flex max-h-[min(28rem,70vh)] min-h-0 flex-col">
        {props.children}
      </CommandPanel>
      <CommandFooter class="max-sm:flex-col max-sm:items-start">
        <div class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
          <KbdGroup>
            <Kbd>
              <ArrowUp />
            </Kbd>
            <Kbd>
              <ArrowDown />
            </Kbd>
            <span>Navigate</span>
          </KbdGroup>
          <Show when={props.footerActionLabel}>
            {(label) => (
              <KbdGroup>
                <Kbd>Enter</Kbd>
                <span>{label()}</span>
              </KbdGroup>
            )}
          </Show>
          <Show when={props.showBackHint}>
            <KbdGroup>
              <Kbd>Backspace</Kbd>
              <span>Back</span>
            </KbdGroup>
          </Show>
          <KbdGroup>
            <Kbd>Esc</Kbd>
            <span>Close</span>
          </KbdGroup>
        </div>
        {props.footerTrailing}
      </CommandFooter>
    </>
  );
}

export function PaletteBackButton(props: { onClick: () => void }) {
  return (
    <button
      type="button"
      class="flex cursor-pointer items-center"
      aria-label="Back"
      onClick={() => props.onClick()}
    >
      <ArrowLeft />
    </button>
  );
}

/** The input's trailing submit button for the add-project, clone and new-project views. */
export function PaletteSubmitButton(props: {
  id: string;
  label: string;
  shortcutLabel: string;
  ariaLabel: string;
  disabled: boolean;
  onSubmit: () => void;
}) {
  return (
    <Button
      id={props.id}
      variant="outline"
      size="xs"
      class="absolute inset-e-2.5 top-1/2 -translate-y-1/2"
      aria-label={props.ariaLabel}
      data-tip={props.ariaLabel}
      data-tip-side="top"
      disabled={props.disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => props.onSubmit()}
    >
      <span>{props.label}</span>
      <KbdGroup class="pointer-events-none -me-0.5">
        <Kbd>{props.shortcutLabel}</Kbd>
      </KbdGroup>
    </Button>
  );
}

export function PaletteTitleIcon(props: { children: JSX.Element }) {
  return <span class="flex h-5 shrink-0 items-center self-start pt-0.5">{props.children}</span>;
}

export function PaletteEmptyState(props: { message: string }) {
  return <div class="py-10 text-center text-sm text-muted-foreground">{props.message}</div>;
}

/** A result row: an icon, a title over an optional detail line, then its trailing parts. */
export function PaletteResultRow(props: {
  id: string;
  index: number;
  active: boolean;
  icon: JSX.Element;
  title: JSX.Element;
  titleLeading?: JSX.Element;
  detail?: JSX.Element;
  timestamp?: string | undefined;
  shortcut?: string | null;
  submenu?: boolean;
  tip?: string | undefined;
  onHover: () => void;
  onChoose: () => void;
}) {
  const detail = children(() => props.detail);
  const title = () => (
    <>
      {props.titleLeading}
      <span class="truncate">{props.title}</span>
    </>
  );
  return (
    <CommandItem
      id={props.id}
      active={props.active}
      data-row={props.index}
      data-tip={props.tip}
      onMouseDown={(event) => event.preventDefault()}
      onPointerMove={() => {
        if (!props.active) props.onHover();
      }}
      onClick={() => props.onChoose()}
    >
      <PaletteTitleIcon>{props.icon}</PaletteTitleIcon>
      <Show
        when={detail()}
        fallback={
          <span class="flex min-w-0 flex-1 items-center gap-1.5 text-sm text-foreground">
            {title()}
          </span>
        }
      >
        <span class="flex min-w-0 flex-1 flex-col">
          <span class="flex min-w-0 items-center gap-1.5 text-sm text-foreground">{title()}</span>
          {detail()}
        </span>
      </Show>
      <Show when={props.timestamp}>
        <span class="min-w-12 shrink-0 text-right text-xs tabular-nums text-muted-foreground/70">
          {props.timestamp}
        </span>
      </Show>
      <Show when={props.shortcut}>{(label) => <CommandShortcut>{label()}</CommandShortcut>}</Show>
      <Show when={props.submenu}>
        <ChevronRight class="-me-0.5 ms-auto size-4 shrink-0 text-muted-foreground/70" />
      </Show>
    </CommandItem>
  );
}
