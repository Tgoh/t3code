import type { JSX } from "@solidjs/web";
import { omit } from "solid-js";

import {
  DialogAction,
  DialogClose,
  DialogRoot,
  DialogSurface,
  type IPopupProps,
  useDescriptionId,
  useTitleId,
} from "./Dialog";
import {
  ALERT_DIALOG_DESCRIPTION_CLASS,
  ALERT_DIALOG_HEADER_CLASS,
  ALERT_DIALOG_TITLE_CLASS,
  alertDialogFooterClass,
  alertDialogPopupClass,
  alertDialogViewportClass,
  dialogBackdropClass,
} from "./DialogStyles";

/** A dialog that a press outside doesn't close; Escape and `AlertDialogClose` still do. */
export function AlertDialog(props: { onClose: () => void; children: JSX.Element }) {
  return (
    <DialogRoot alert onClose={props.onClose}>
      {props.children}
    </DialogRoot>
  );
}

export function AlertDialogPopup(props: IPopupProps & { bottomStickOnMobile?: boolean }) {
  const rest = omit(props, "bottomStickOnMobile");
  const bottomStick = () => props.bottomStickOnMobile ?? true;
  return (
    <DialogSurface
      {...rest}
      slot="alert-dialog"
      backdropClass={dialogBackdropClass("default")}
      viewportClass={alertDialogViewportClass(bottomStick())}
      popupClass={alertDialogPopupClass(bottomStick())}
      closeButton={false}
    />
  );
}

export function AlertDialogHeader(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const rest = omit(props, "class");
  return (
    <div
      {...rest}
      class={`${ALERT_DIALOG_HEADER_CLASS} ${props.class ?? ""}`}
      data-slot="alert-dialog-header"
    />
  );
}

export function AlertDialogFooter(
  props: JSX.HTMLAttributes<HTMLDivElement> & { variant?: "default" | "bare" },
) {
  const rest = omit(props, "class", "variant");
  return (
    <div
      {...rest}
      class={`${alertDialogFooterClass(props.variant ?? "default")} ${props.class ?? ""}`}
      data-slot="alert-dialog-footer"
    />
  );
}

export function AlertDialogTitle(props: Omit<JSX.HTMLAttributes<HTMLHeadingElement>, "id">) {
  const rest = omit(props, "class");
  return (
    <h2
      {...rest}
      id={useTitleId()}
      class={`${ALERT_DIALOG_TITLE_CLASS} ${props.class ?? ""}`}
      data-slot="alert-dialog-title"
    />
  );
}

export function AlertDialogDescription(
  props: Omit<JSX.HTMLAttributes<HTMLParagraphElement>, "id">,
) {
  const rest = omit(props, "class");
  return (
    <p
      {...rest}
      id={useDescriptionId()}
      class={`${ALERT_DIALOG_DESCRIPTION_CLASS} ${props.class ?? ""}`}
      data-slot="alert-dialog-description"
    />
  );
}

export { DialogAction as AlertDialogAction, DialogClose as AlertDialogClose };
