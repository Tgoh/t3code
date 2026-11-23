import type { JSX } from "@solidjs/web";
import { children, createUniqueId, omit, Show } from "solid-js";

import { Search } from "../icons";
import { DialogRoot, DialogSurface, type IPopupProps } from "./Dialog";
import { DIALOG_POPUP_CLASS, dialogBackdropClass } from "./DialogStyles";
import { ScrollArea } from "./ScrollArea";

const COMMAND_BACKDROP = `${dialogBackdropClass("default")} data-ending-style:pointer-events-none`;

const COMMAND_VIEWPORT =
  "pointer-events-none fixed inset-0 z-50 flex flex-col items-center px-4 [-webkit-app-region:no-drag] pt-[max(--spacing(4),4vh,calc(var(--command-titlebar-height)+--spacing(2)))] pb-[max(--spacing(4),4vh)] sm:pt-[max(10vh,calc(var(--command-titlebar-height)+--spacing(2)))] sm:pb-[10vh]";

const COMMAND_POPUP = `${DIALOG_POPUP_CLASS} pointer-events-auto max-h-105 max-w-xl text-foreground data-ending-style:pointer-events-none`;

const INPUT_WRAP =
  "px-[var(--command-shell-inset)] py-1.5 [&_[data-slot=autocomplete-start-addon]]:ps-[calc(var(--command-shell-inset)+0.0625rem)]";

const INPUT_ROOT =
  "relative not-has-[>*.w-full]:w-fit w-full text-foreground has-disabled:opacity-64";

const INPUT_ADDON =
  "[&_svg]:-mx-0.5 pointer-events-none has-[button]:pointer-events-auto absolute inset-y-0 start-px z-10 flex items-center ps-[calc(--spacing(3)-1px)] opacity-80 has-[+[data-size=sm]]:ps-[calc(--spacing(2.5)-1px)] [&_svg:not([class*='size-'])]:size-4.5 sm:[&_svg:not([class*='size-'])]:size-4";

const INPUT_ICON = "translate-x-0.5 text-icon-muted";

// Stock's Input control merged with Autocomplete's and Command's classes, as tailwind-merge leaves
// them: Command's shadow-none and ring-0 replace the control's shadow and focus ring.
const INPUT_CONTROL =
  "relative inline-flex w-full rounded-lg border border-input bg-background not-dark:bg-clip-padding text-base text-foreground ring-ring/24 transition-shadow before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-lg)-1px)] not-has-disabled:not-has-focus-visible:not-has-aria-invalid:before:shadow-[0_1px_--theme(--color-black/4%)] has-focus-visible:has-aria-invalid:border-destructive/64 has-focus-visible:has-aria-invalid:ring-destructive/16 has-aria-invalid:border-destructive/36 has-focus-visible:border-ring has-autofill:bg-foreground/4 has-disabled:opacity-64 has-[:disabled,:focus-visible,[aria-invalid]]:shadow-none has-focus-visible:ring-inset sm:text-sm dark:bg-input/32 dark:has-autofill:bg-foreground/8 dark:has-aria-invalid:ring-destructive/24 dark:not-has-disabled:not-has-focus-visible:not-has-aria-invalid:before:shadow-[0_-1px_--theme(--color-white/6%)] data-[size=sm]:*:data-[slot=autocomplete-input]:ps-[calc(--spacing(7.5)-1px)] *:data-[slot=autocomplete-input]:ps-[calc(--spacing(8.5)-1px)] sm:data-[size=sm]:*:data-[slot=autocomplete-input]:ps-[calc(--spacing(7)-1px)] sm:*:data-[slot=autocomplete-input]:ps-[calc(--spacing(8)-1px)] has-[+[data-slot=autocomplete-trigger],+[data-slot=autocomplete-clear]]:*:data-[slot=autocomplete-input]:pe-7 border-transparent! bg-transparent! shadow-none before:hidden has-focus-visible:ring-0 placeholder:text-placeholder *:data-[slot=autocomplete-input]:ps-9! sm:*:data-[slot=autocomplete-input]:ps-[calc(var(--command-shell-inset)+1.5rem)]!";

const INPUT_FIELD =
  "w-full min-w-0 rounded-[inherit] px-[calc(--spacing(3)-1px)] outline-none placeholder:text-placeholder [transition:background-color_5000000s_ease-in-out_0s] h-9.5 leading-9.5 sm:h-8.5 sm:leading-8.5";

/** Room at the input's end for a button over it, as stock's palette call sites pass. */
const END_INSET = {
  none: "",
  sm: "*:data-[slot=autocomplete-input]:pe-24!",
  md: "*:data-[slot=autocomplete-input]:pe-30!",
  lg: "*:data-[slot=autocomplete-input]:pe-32!",
  xl: "*:data-[slot=autocomplete-input]:pe-38!",
};

export type ICommandInputEndInset = keyof typeof END_INSET;

const LIST = "not-empty:scroll-py-2 not-empty:p-2";

const GROUP = "[[role=group]+&]:mt-1.5";

const GROUP_LABEL = "px-2 py-1.5 font-medium text-muted-foreground text-xs";

// Stock's `active` form: the caller tracks the highlighted row, so hover and Base UI's highlight
// paint nothing and only the active row fills.
const ITEM =
  "flex min-h-8 select-none items-center gap-2 rounded-sm px-2 text-base outline-none data-disabled:pointer-events-none data-disabled:opacity-64 sm:min-h-7 sm:text-sm [&_svg:not([class*='text-'])]:text-muted-foreground py-1.5 cursor-pointer hover:bg-transparent hover:text-inherit data-highlighted:bg-transparent data-highlighted:text-inherit data-selected:bg-transparent data-selected:text-inherit [&[data-highlighted][data-selected]]:bg-transparent [&[data-highlighted][data-selected]]:text-inherit";

const ITEM_ACTIVE = `${ITEM} bg-accent! text-accent-foreground!`;

const PANEL =
  "relative min-h-0 overflow-hidden rounded-t-xl not-has-[+[data-slot=command-footer]]:rounded-b-2xl bg-transparent **:data-[slot=scroll-area-scrollbar]:mt-2 [touch-action:pan-y]";

const SHORTCUT = "ms-auto font-medium font-sans text-secondary-label text-xs tracking-widest";

const FOOTER =
  "relative flex items-center justify-between gap-2 rounded-b-[calc(var(--radius-2xl)-1px)] border-t border-foreground/[0.07] bg-foreground/[0.025] px-[var(--command-content-inset)] py-2.5 font-medium text-sm text-muted-foreground [&_[data-slot=kbd-group]]:font-sans [&_[data-slot=kbd]]:bg-foreground/[0.08] [&_[data-slot=kbd]]:text-foreground [&_[data-slot=kbd]]:ring-0";

const withClass = (base: string, extra: string | undefined) =>
  extra === undefined || extra === "" ? base : `${base} ${extra}`;

/**
 * A command palette's open state lives with its caller: render it in a `Presence` and close it from
 * `onClose`, which Escape and a press on the backdrop call.
 */
export function CommandDialog(props: { onClose: () => void; children: JSX.Element }) {
  return (
    <DialogRoot alert={false} onClose={props.onClose}>
      {props.children}
    </DialogRoot>
  );
}

/** A modal `<dialog>` near the top of the window, with focus on its input when it opens. */
export function CommandDialogPopup(props: Omit<IPopupProps, "initialFocus">) {
  return (
    <DialogSurface
      {...props}
      slot="command-dialog"
      backdropClass={COMMAND_BACKDROP}
      viewportClass={COMMAND_VIEWPORT}
      viewportStyle={{ "--command-titlebar-height": "0px" }}
      popupClass={COMMAND_POPUP}
      closeButton={false}
      closeOnBackdropPress
      initialFocus={(popup) => popup.querySelector("input")}
    />
  );
}

/**
 * The search field. The list keeps its highlight while focus stays here, so pass the highlighted
 * row's id as `aria-activedescendant`.
 */
export function CommandInput(
  props: Omit<JSX.InputHTMLAttributes<HTMLInputElement>, "class" | "size"> & {
    /** Defaults to a search icon. */
    startAddon?: JSX.Element;
    endInset?: ICommandInputEndInset | undefined;
  },
) {
  const rest = omit(props, "startAddon", "endInset");
  const addon = children(() => props.startAddon);
  return (
    <div class={INPUT_WRAP}>
      <div class={INPUT_ROOT}>
        <div aria-hidden="true" class={INPUT_ADDON} data-slot="autocomplete-start-addon">
          <Show when={addon()} fallback={<Search class={INPUT_ICON} />}>
            {addon()}
          </Show>
        </div>
        <span
          class={withClass(INPUT_CONTROL, END_INSET[props.endInset ?? "none"])}
          data-size="lg"
          data-slot="input-control"
        >
          <input
            role="combobox"
            aria-autocomplete="list"
            aria-expanded="true"
            autocomplete="off"
            spellcheck={false}
            {...rest}
            class={INPUT_FIELD}
            data-slot="autocomplete-input"
          />
        </span>
      </div>
    </div>
  );
}

export function CommandPanel(props: JSX.HTMLAttributes<HTMLDivElement> & { class?: string }) {
  const rest = omit(props, "class");
  return <div {...rest} class={withClass(PANEL, props.class)} />;
}

export function CommandList(
  props: Omit<JSX.HTMLAttributes<HTMLDivElement>, "class" | "ref" | "role"> & {
    ref?: (element: HTMLDivElement) => void;
    /** Layout only. */
    class?: string;
  },
) {
  const rest = omit(props, "ref", "class");
  return (
    <ScrollArea class="flex flex-col" scrollbarGutter scrollFade>
      <div
        {...rest}
        ref={(element) => props.ref?.(element)}
        class={withClass(LIST, props.class)}
        role="listbox"
        data-slot="command-list"
      />
    </ScrollArea>
  );
}

export function CommandGroup(props: { label?: JSX.Element; children: JSX.Element }) {
  const id = createUniqueId();
  return (
    <div
      class={GROUP}
      role="group"
      aria-labelledby={props.label === undefined ? undefined : id}
      data-slot="command-group"
    >
      <Show when={props.label !== undefined}>
        <div id={id} class={GROUP_LABEL} data-slot="command-group-label">
          {props.label}
        </div>
      </Show>
      {props.children}
    </div>
  );
}

/** A row. `active` marks the row the caller highlights; it carries `data-highlighted` too. */
export function CommandItem(
  props: Omit<JSX.HTMLAttributes<HTMLDivElement>, "class" | "role"> & { active: boolean },
) {
  const rest = omit(props, "active");
  return (
    <div
      {...rest}
      class={props.active ? ITEM_ACTIVE : ITEM}
      role="option"
      data-active={props.active ? "" : undefined}
      data-highlighted={props.active ? "" : undefined}
      data-slot="command-item"
    />
  );
}

export function CommandShortcut(props: JSX.HTMLAttributes<HTMLElement> & { class?: string }) {
  const rest = omit(props, "class");
  return <kbd {...rest} class={withClass(SHORTCUT, props.class)} data-slot="command-shortcut" />;
}

export function CommandFooter(props: JSX.HTMLAttributes<HTMLDivElement> & { class?: string }) {
  const rest = omit(props, "class");
  return <div {...rest} class={withClass(FOOTER, props.class)} data-slot="command-footer" />;
}
