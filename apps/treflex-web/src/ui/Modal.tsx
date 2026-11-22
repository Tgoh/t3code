import { createSignal, type JSX, splitProps } from "solid-js";

import { useOverlay } from "../overlays";
import { usePresence } from "./Presence";

// Follows DIALOG_BACKDROP_CLASS and DIALOG_POPUP_CLASS in apps/web/src/components/ui/dialog-styles.ts.
const DIALOG_MOTION =
  "transition-[scale,opacity,translate] duration-200 ease-in-out starting:scale-98 starting:opacity-0 data-closing:pointer-events-none data-closing:scale-98 data-closing:opacity-0 backdrop:transition-opacity backdrop:duration-200 starting:backdrop:opacity-0 data-closing:backdrop:opacity-0";

/**
 * A `<dialog>` shown modally on mount, on the overlay stack so Escape closes it only when on top.
 * Inside a `Presence` it fades out before it unmounts; it never calls `close()` itself, which
 * would drop it from the top layer at once.
 */
export function Modal(
  props: Omit<JSX.DialogHtmlAttributes<HTMLDialogElement>, "onClose" | "onCancel"> & {
    class: string;
    onClose: () => void;
  },
) {
  const [local, rest] = splitProps(props, ["class", "onClose"]);
  const [dialog, setDialog] = createSignal<HTMLDialogElement>();
  const presence = usePresence();
  useOverlay({
    modal: true,
    close: () => local.onClose(),
    contains: (node) => dialog()?.contains(node) === true,
  });
  return (
    <dialog
      {...rest}
      class={`${local.class} ${DIALOG_MOTION}`}
      data-closing={presence.closing() ? "" : undefined}
      onCancel={(event) => {
        event.preventDefault();
        local.onClose();
      }}
      onClose={() => local.onClose()}
      ref={(element) => {
        setDialog(element);
        presence.track(element);
        queueMicrotask(() => element.showModal());
      }}
    />
  );
}

// Follows AlertDialog in apps/web/src/components/ui/alert-dialog.tsx and the dialog-glass and
// dialog-backdrop utilities in apps/web/src/index.css. Preflight zeroes a dialog's margin, so
// m-auto restores the centring; below sm it docks to the bottom as stock's mobile sheet does.
const DIALOG =
  "m-auto max-h-[calc(100%-2rem)] w-full max-w-[min(32rem,calc(100vw-32px))] max-sm:mb-0 max-sm:max-h-[calc(100%-3rem)] max-sm:max-w-none max-sm:rounded-none max-sm:border-x-0 max-sm:border-b-0 max-sm:starting:translate-y-4 max-sm:data-closing:translate-y-4 rounded-2xl border border-[color-mix(in_srgb,var(--foreground)_10%,transparent)] bg-[color-mix(in_srgb,var(--background)_var(--glass-opacity),transparent)] p-0 text-foreground shadow-[0_24px_64px_-24px_rgb(0_0_0/65%)] backdrop-blur-(--glass-blur) backdrop-saturate-(--glass-saturation) backdrop:bg-(--dialog-backdrop) backdrop:backdrop-blur-[4px]";

/** A modal with the confirm dialog's chrome, laid out with the parts below. */
export function Dialog(
  props: Omit<JSX.DialogHtmlAttributes<HTMLDialogElement>, "class" | "onClose" | "onCancel"> & {
    onClose: () => void;
  },
) {
  return <Modal {...props} class={DIALOG} />;
}

export function DialogHeader(props: { children: JSX.Element }) {
  return <div class="flex flex-col gap-2 p-6">{props.children}</div>;
}

export function DialogTitle(props: JSX.HTMLAttributes<HTMLHeadingElement>) {
  return <h2 {...props} class="m-0 text-[20px] leading-snug font-semibold wrap-anywhere" />;
}

export function DialogDescription(props: { children: JSX.Element }) {
  return (
    <p class="m-0 text-[14px] whitespace-pre-line text-muted-foreground wrap-anywhere">
      {props.children}
    </p>
  );
}

export function DialogError(props: { children: JSX.Element }) {
  return <p class="m-0 text-[13px] text-error-foreground">{props.children}</p>;
}

const FOOTER =
  "flex justify-end gap-2 border-t border-border bg-[color-mix(in_srgb,var(--muted)_72%,transparent)] px-6 py-4";

export function DialogFooter(props: { class?: string; children: JSX.Element }) {
  return <div class={`${FOOTER} ${props.class ?? ""}`}>{props.children}</div>;
}
