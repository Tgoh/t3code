import { createSignal, type JSX } from "solid-js";

import { useOverlay } from "../overlays";

/** A `<dialog>` shown modally on mount, on the overlay stack so Escape closes it only when on top. */
export function Modal(
  props: JSX.DialogHtmlAttributes<HTMLDialogElement> & { onClose: () => void },
) {
  const [dialog, setDialog] = createSignal<HTMLDialogElement>();
  useOverlay({
    modal: true,
    close: () => dialog()?.close(),
    contains: (node) => dialog()?.contains(node) === true,
  });
  return (
    <dialog
      {...props}
      ref={(element) => {
        setDialog(element);
        queueMicrotask(() => element.showModal());
      }}
    />
  );
}

// Follows AlertDialog in apps/web/src/components/ui/alert-dialog.tsx and the dialog-glass and
// dialog-backdrop utilities in apps/web/src/index.css.
const DIALOG =
  "w-full max-w-[min(32rem,calc(100vw-32px))] rounded-2xl border border-[color-mix(in_srgb,var(--foreground)_10%,transparent)] bg-[color-mix(in_srgb,var(--background)_var(--glass-opacity),transparent)] p-0 text-foreground shadow-[0_24px_64px_-24px_rgb(0_0_0/65%)] backdrop-blur-(--glass-blur) backdrop-saturate-(--glass-saturation) backdrop:bg-(--dialog-backdrop) backdrop:backdrop-blur-[4px]";

/** A modal with the confirm dialog's chrome, laid out with the parts below. */
export function Dialog(
  props: Omit<JSX.DialogHtmlAttributes<HTMLDialogElement>, "class"> & { onClose: () => void },
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
