import { createSignal, type JSX } from "solid-js";

import { useOverlay } from "./overlays";

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
