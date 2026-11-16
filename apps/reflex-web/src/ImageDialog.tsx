import { X } from "./icons";

export function ImageDialog(props: { src: string; alt: string; onClose: () => void }) {
  return (
    <dialog
      class="image-dialog"
      ref={(dialog) => queueMicrotask(() => dialog.showModal())}
      onClose={() => props.onClose()}
      onClick={(event) => event.currentTarget.close()}
    >
      <img src={props.src} alt={props.alt} />
      <button class="icon-button image-dialog-close" aria-label="Close preview">
        <X />
      </button>
    </dialog>
  );
}
