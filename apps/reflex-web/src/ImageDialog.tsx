import type { JSX } from "solid-js";

import { X } from "./icons";
import { IconButton } from "./ui/IconButton";
import { Modal } from "./ui/Modal";

/** A full-screen viewer that a click outside an interactive child closes. */
export function MediaDialog(props: { onClose: () => void; children: JSX.Element }) {
  return (
    <Modal
      class="flex h-screen max-h-none w-screen max-w-none cursor-zoom-out items-center justify-center border-0 bg-transparent p-4 backdrop:bg-[rgb(0_0_0/80%)]"
      onClose={() => props.onClose()}
      onClick={(event) => event.currentTarget.close()}
    >
      {props.children}
      <IconButton variant="media" class="absolute top-4 right-4" aria-label="Close preview">
        <X />
      </IconButton>
    </Modal>
  );
}

export const MEDIA_DIALOG_FIT =
  "block max-h-[calc(100vh-32px)] max-w-[calc(100vw-32px)] rounded-lg object-contain";

export function ImageDialog(props: { src: string; alt: string; onClose: () => void }) {
  return (
    <MediaDialog onClose={props.onClose}>
      <img class={MEDIA_DIALOG_FIT} src={props.src} alt={props.alt} />
    </MediaDialog>
  );
}
