import { X } from "./icons";
import { IconButton } from "./ui/IconButton";
import { Modal } from "./ui/Modal";

export function ImageDialog(props: { src: string; alt: string; onClose: () => void }) {
  return (
    <Modal
      class="image-dialog"
      onClose={() => props.onClose()}
      onClick={(event) => event.currentTarget.close()}
    >
      <img src={props.src} alt={props.alt} />
      <IconButton variant="media" class="absolute top-4 right-4" aria-label="Close preview">
        <X />
      </IconButton>
    </Modal>
  );
}
