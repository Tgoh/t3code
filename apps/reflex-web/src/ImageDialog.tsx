import { X } from "./icons";
import { Modal } from "./Modal";

export function ImageDialog(props: { src: string; alt: string; onClose: () => void }) {
  return (
    <Modal
      class="image-dialog"
      onClose={() => props.onClose()}
      onClick={(event) => event.currentTarget.close()}
    >
      <img src={props.src} alt={props.alt} />
      <button class="icon-button image-dialog-close" aria-label="Close preview">
        <X />
      </button>
    </Modal>
  );
}
