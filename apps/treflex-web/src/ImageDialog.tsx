import type { JSX } from "@solidjs/web";
import { createSignal } from "solid-js";

import { ArrowLeft } from "./icons";
import { Button } from "./ui/Button";
import { Dialog, DialogPopup, DialogTitle } from "./ui/Dialog";

/** A full-screen viewer that a click outside an interactive child closes. */
export function MediaDialog(props: { onClose: () => void; children: JSX.Element }) {
  const [back, setBack] = createSignal<HTMLButtonElement>();
  return (
    <Dialog onClose={props.onClose}>
      <DialogPopup
        variant="media"
        size="expanded"
        mediaControlsPlacement="inside"
        showCloseButton={false}
        bottomStickOnMobile={false}
        class="cursor-zoom-out"
        initialFocus={() => back() ?? null}
        onClick={() => props.onClose()}
      >
        <DialogTitle class="sr-only">Expanded media preview</DialogTitle>
        <Button
          ref={setBack}
          size="sm"
          variant="media-close"
          class="absolute top-0 left-0 z-20 max-[8rem]:left-1/2 max-[8rem]:-translate-x-1/2"
          aria-label="Back, close preview"
        >
          <ArrowLeft aria-hidden="true" />
          Back
        </Button>
        <div class="relative isolate z-10 flex max-h-full max-w-[var(--media-width)] flex-col items-center">
          {props.children}
        </div>
      </DialogPopup>
    </Dialog>
  );
}

export const MEDIA_DIALOG_FIT =
  "block max-h-[var(--media-height)] max-w-[var(--media-width)] rounded-lg object-contain";

export function ImageDialog(props: { src: string; alt: string; onClose: () => void }) {
  return (
    <MediaDialog onClose={props.onClose}>
      <img class={MEDIA_DIALOG_FIT} src={props.src} alt={props.alt} />
    </MediaDialog>
  );
}
