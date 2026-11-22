import {
  type Accessor,
  createContext,
  createRenderEffect,
  createSignal,
  createUniqueId,
  type JSX,
  on,
  onCleanup,
  type Setter,
  Show,
  splitProps,
  useContext,
} from "solid-js";

import { X } from "../icons";
import { useOverlays } from "../overlays";
import { Button, type ButtonVariant } from "./Button";
import {
  DIALOG_DESCRIPTION_CLASS,
  DIALOG_HEADER_CLASS,
  DIALOG_PANEL_CLASS,
  DIALOG_TITLE_CLASS,
  dialogBackdropClass,
  dialogFooterClass,
  dialogPopupClass,
  dialogViewportClass,
  type IDialogSize,
  type IDialogVariant,
  SCROLL_AREA_CLASS,
  scrollAreaViewportClass,
} from "./DialogStyles";
import { floatingReturnTarget, tabbables } from "./floating";
import { usePresence } from "./Presence";
import { trackScrollOverflow } from "./scrollOverflow";

interface IDialogRoot {
  close: () => void;
  alert: boolean;
  titleId: Accessor<string | undefined>;
  setTitleId: Setter<string | undefined>;
  descriptionId: Accessor<string | undefined>;
  setDescriptionId: Setter<string | undefined>;
}

const DialogContext = createContext<IDialogRoot>();

function useDialogRoot(): IDialogRoot {
  const root = useContext(DialogContext);
  if (root === undefined) throw new Error("A dialog part must be inside a Dialog or AlertDialog.");
  return root;
}

export function DialogRoot(props: { alert: boolean; onClose: () => void; children: JSX.Element }) {
  const [titleId, setTitleId] = createSignal<string>();
  const [descriptionId, setDescriptionId] = createSignal<string>();
  const presence = usePresence();
  const root: IDialogRoot = {
    close: () => {
      if (!presence.exiting()) props.onClose();
    },
    alert: props.alert,
    titleId,
    setTitleId,
    descriptionId,
    setDescriptionId,
  };
  return <DialogContext.Provider value={root}>{props.children}</DialogContext.Provider>;
}

/**
 * A dialog's open state lives with its caller: render it in a `Presence` so it plays its exit, and
 * close it from `onClose`, which Escape, a press outside the popup and `DialogClose` all call.
 */
export function Dialog(props: { onClose: () => void; children: JSX.Element }) {
  return (
    <DialogRoot alert={false} onClose={props.onClose}>
      {props.children}
    </DialogRoot>
  );
}

const DIALOG_ACTION = '[data-slot="dialog-action"]:not(:disabled):not([aria-disabled="true"])';

let lastPointerType = "";
if (typeof document !== "undefined") {
  document.addEventListener("pointerdown", (event) => (lastPointerType = event.pointerType), true);
  document.addEventListener("keydown", () => (lastPointerType = ""), true);
}

/** What takes focus on open: the first `DialogAction`, else Base UI's default. */
function initialFocusTarget(popup: HTMLElement): HTMLElement | null {
  if (lastPointerType === "touch") return null;
  return popup.querySelector<HTMLElement>(DIALOG_ACTION) ?? tabbables(popup)[0] ?? null;
}

// Preflight leaves the UA's modal box on <dialog>; this one only holds the backdrop and viewport.
// Its z-index counts only while it exits, out of the top layer.
const DIALOG_ROOT =
  "fixed inset-0 z-[120] m-0 size-full max-h-none max-w-none overflow-visible border-0 bg-transparent p-0 text-inherit outline-none backdrop:bg-transparent data-ending-style:pointer-events-none";

export type IPopupProps = Omit<JSX.HTMLAttributes<HTMLDivElement>, "class" | "role" | "style"> & {
  /** What takes focus on open; null leaves it on the popup. */
  initialFocus?: (popup: HTMLElement) => HTMLElement | null;
  /** Layout only. */
  class?: string;
  children: JSX.Element;
};

/**
 * The surface every dialog kind shares: a modal `<dialog>` in the top layer holding stock's
 * backdrop, viewport and popup. Escape closes it; a press outside the popup closes only a plain
 * dialog. When the close starts, focus goes back to what had it on open.
 */
export function DialogSurface(
  props: IPopupProps & {
    slot: "dialog" | "alert-dialog" | "command-dialog";
    backdropClass: string;
    viewportClass: string;
    viewportStyle?: JSX.CSSProperties;
    popupClass: string;
    closeButton: boolean;
    /** Closes on a press of the backdrop, for a viewport that lets presses through to it. */
    closeOnBackdropPress?: boolean;
  },
) {
  const [local, rest] = splitProps(props, [
    "slot",
    "backdropClass",
    "viewportClass",
    "viewportStyle",
    "popupClass",
    "closeButton",
    "closeOnBackdropPress",
    "initialFocus",
    "class",
    "children",
  ]);
  const root = useDialogRoot();
  const presence = usePresence();
  const returnTarget = () => {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || active === document.body) return undefined;
    return floatingReturnTarget(active) ?? active;
  };
  const [opener, setOpener] = createSignal(returnTarget());
  const [dialog, setDialog] = createSignal<HTMLDialogElement>();
  const [popup, setPopup] = createSignal<HTMLDivElement>();
  const [pressedOutside, setPressedOutside] = createSignal(false);
  const overlays = useOverlays();
  const overlay = {
    modal: true,
    close: () => root.close(),
    contains: (node: Node) => dialog()?.contains(node) === true,
  };
  let leaveStack: (() => void) | null = overlays.push(overlay);
  const returnFocus = () => {
    const element = dialog();
    const active = document.activeElement;
    const target = opener();
    const lost = active === null || active === document.body || element?.contains(active);
    if (lost !== true) return;
    if (target?.isConnected === true) target.focus({ preventScroll: true });
    else if (active instanceof HTMLElement && element?.contains(active)) active.blur();
  };
  // The page is interactive again as soon as the close starts: the exiting dialog turns
  // non-modal and inert, so whatever the close leads to can take focus at once.
  const leave = (element: HTMLDialogElement) => {
    leaveStack?.();
    leaveStack = null;
    // Leaving the top layer cancels the transitions in flight, so each node is held where it was
    // and its exit starts again from there.
    const ending = [element, ...element.querySelectorAll<HTMLElement>("[data-ending-style]")]
      .filter((node) => node.hasAttribute("data-ending-style"))
      .map((node) => {
        const style = getComputedStyle(node);
        return { node, held: [style.opacity, style.scale, style.translate] as const };
      });
    for (const { node, held } of ending) {
      node.style.opacity = held[0];
      node.style.scale = held[1];
      node.style.translate = held[2];
      node.removeAttribute("data-ending-style");
    }
    element.inert = true;
    element.close();
    element.show();
    element.getBoundingClientRect();
    for (const { node } of ending) {
      node.style.removeProperty("opacity");
      node.style.removeProperty("scale");
      node.style.removeProperty("translate");
      node.setAttribute("data-ending-style", "");
    }
    returnFocus();
  };
  createRenderEffect(
    on(
      presence.exiting,
      (exiting, was) => {
        const element = dialog();
        if (element === undefined || !element.open) return;
        if (exiting) return leave(element);
        if (was !== true) return;
        element.inert = false;
        element.close();
        leaveStack = overlays.push(overlay);
        open(element);
      },
      { defer: true },
    ),
  );
  onCleanup(() => {
    leaveStack?.();
    dialog()?.close();
    returnFocus();
  });
  const outside = (target: EventTarget | null) => {
    const element = popup();
    return target instanceof Node && element !== undefined && !element.contains(target);
  };
  const open = (element: HTMLDialogElement) => {
    const surface = popup();
    if (!element.isConnected || element.open || surface === undefined || presence.exiting()) return;
    const opened = returnTarget();
    if (opened !== undefined) setOpener(opened);
    element.showModal();
    const target =
      local.initialFocus === undefined ? initialFocusTarget(surface) : local.initialFocus(surface);
    (target ?? surface).focus({ preventScroll: true });
  };
  return (
    <dialog
      ref={(element) => {
        setDialog(element);
        presence.track(element);
        queueMicrotask(() => open(element));
      }}
      class={DIALOG_ROOT}
      role={root.alert ? "alertdialog" : undefined}
      aria-labelledby={root.titleId()}
      aria-describedby={root.descriptionId()}
      onCancel={(event) => {
        event.preventDefault();
        root.close();
      }}
    >
      <div
        ref={(element) => presence.track(element)}
        class={local.backdropClass}
        data-slot={`${local.slot}-backdrop`}
        onPointerDown={() => {
          if (local.closeOnBackdropPress === true) root.close();
        }}
      />
      <div
        class={local.viewportClass}
        style={local.viewportStyle}
        data-slot={`${local.slot}-viewport`}
        onPointerDown={(event) => {
          setPressedOutside(!root.alert && event.button === 0 && outside(event.target));
        }}
        onPointerUp={(event) => {
          if (pressedOutside() && outside(event.target)) root.close();
          setPressedOutside(false);
        }}
      >
        <div
          {...rest}
          ref={(element) => {
            setPopup(element);
            presence.track(element);
          }}
          class={
            local.class === undefined ? local.popupClass : `${local.popupClass} ${local.class}`
          }
          style={{ "--nested-dialogs": "0" }}
          tabIndex={-1}
          data-slot={`${local.slot}-popup`}
        >
          {local.children}
          <Show when={local.closeButton}>
            <DialogClose
              aria-label="Close"
              class="absolute end-2 top-2"
              size="icon"
              variant="ghost"
            >
              <X />
            </DialogClose>
          </Show>
        </div>
      </div>
    </dialog>
  );
}

export function DialogPopup(
  props: IPopupProps & {
    showCloseButton?: boolean;
    bottomStickOnMobile?: boolean;
    variant?: IDialogVariant;
    size?: IDialogSize;
    mediaControlsPlacement?: "inside" | "outside";
  },
) {
  const [local, rest] = splitProps(props, [
    "showCloseButton",
    "bottomStickOnMobile",
    "variant",
    "size",
    "mediaControlsPlacement",
  ]);
  const layout = () => ({
    variant: local.variant ?? "default",
    size: local.size ?? "default",
    bottomStickOnMobile: local.bottomStickOnMobile ?? true,
    mediaControlsPlacement: local.mediaControlsPlacement ?? "outside",
  });
  return (
    <DialogSurface
      {...rest}
      slot="dialog"
      backdropClass={dialogBackdropClass(layout().variant)}
      viewportClass={dialogViewportClass(layout())}
      popupClass={dialogPopupClass(layout())}
      closeButton={local.showCloseButton ?? true}
    />
  );
}

type IButtonProps = Parameters<typeof Button>[0];

export function DialogClose(props: IButtonProps) {
  const root = useDialogRoot();
  const [local, rest] = splitProps(props, ["onClick"]);
  return (
    <Button
      {...rest}
      data-slot={root.alert ? "alert-dialog-close" : "dialog-close"}
      onClick={(event) => {
        if (typeof local.onClick === "function") local.onClick(event);
        root.close();
      }}
    />
  );
}

/** A button that takes focus when the dialog opens. A destructive action never does. */
export function DialogAction(
  props: Omit<IButtonProps, "variant"> & {
    variant?: Exclude<ButtonVariant, `${string}destructive${string}`>;
  },
) {
  return <Button {...props} data-slot="dialog-action" />;
}

export function DialogHeader(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <div
      {...rest}
      class={`${DIALOG_HEADER_CLASS} ${local.class ?? ""}`}
      data-slot="dialog-header"
    />
  );
}

export function DialogFooter(
  props: JSX.HTMLAttributes<HTMLDivElement> & { variant?: "default" | "bare" },
) {
  const [local, rest] = splitProps(props, ["class", "variant"]);
  return (
    <div
      {...rest}
      class={`${dialogFooterClass(local.variant ?? "default")} ${local.class ?? ""}`}
      data-slot="dialog-footer"
    />
  );
}

export function useTitleId(): string {
  const root = useDialogRoot();
  const id = createUniqueId();
  root.setTitleId(id);
  onCleanup(() => root.setTitleId(undefined));
  return id;
}

export function useDescriptionId(): string {
  const root = useDialogRoot();
  const id = createUniqueId();
  root.setDescriptionId(id);
  onCleanup(() => root.setDescriptionId(undefined));
  return id;
}

export function DialogTitle(props: Omit<JSX.HTMLAttributes<HTMLHeadingElement>, "id">) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <h2
      {...rest}
      id={useTitleId()}
      class={`${DIALOG_TITLE_CLASS} ${local.class ?? ""}`}
      data-slot="dialog-title"
    />
  );
}

export function DialogDescription(props: Omit<JSX.HTMLAttributes<HTMLParagraphElement>, "id">) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <p
      {...rest}
      id={useDescriptionId()}
      class={`${DIALOG_DESCRIPTION_CLASS} ${local.class ?? ""}`}
      data-slot="dialog-description"
    />
  );
}

/** Scrolls when the popup runs out of height. */
export function DialogPanel(props: JSX.HTMLAttributes<HTMLDivElement> & { scrollFade?: boolean }) {
  const [local, rest] = splitProps(props, ["class", "scrollFade"]);
  return (
    <div class={SCROLL_AREA_CLASS}>
      <div
        ref={(element) => onCleanup(trackScrollOverflow(element))}
        class={scrollAreaViewportClass(local.scrollFade ?? true)}
        data-slot="scroll-area-viewport"
      >
        <div
          {...rest}
          class={`${DIALOG_PANEL_CLASS} ${local.class ?? ""}`}
          data-slot="dialog-panel"
        />
      </div>
    </div>
  );
}
