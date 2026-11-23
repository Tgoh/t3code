const DIALOG_BACKDROP_BASE_CLASS =
  "fixed inset-0 transition-all duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0";

const DIALOG_POPUP_BASE_CLASS =
  "-translate-y-[calc(1.25rem*var(--nested-dialogs))] relative flex min-h-0 min-w-0 scale-[calc(1-0.1*var(--nested-dialogs))] flex-col opacity-[calc(1-0.1*var(--nested-dialogs))] outline-none transition-[scale,opacity,translate] duration-200 ease-in-out will-change-transform data-nested:data-ending-style:translate-y-8 data-nested:data-starting-style:translate-y-8 data-nested-dialog-open:origin-top data-ending-style:scale-98 data-starting-style:scale-98 data-ending-style:opacity-0 data-starting-style:opacity-0 [-webkit-app-region:no-drag]";

export const DIALOG_POPUP_CLASS = `dialog-glass ${DIALOG_POPUP_BASE_CLASS} w-full rounded-2xl border`;

const DIALOG_MEDIA_POPUP_CLASS = `${DIALOG_POPUP_BASE_CLASS} max-h-[92vh] max-w-[92vw] overflow-visible rounded-none border border-transparent bg-transparent p-0 shadow-none`;

const DIALOG_MOBILE_SHEET_CLASS =
  "max-sm:max-w-none max-sm:rounded-none max-sm:border-x-0 max-sm:border-t max-sm:border-b-0 max-sm:opacity-[calc(1-min(var(--nested-dialogs),1))] max-sm:data-ending-style:translate-y-4 max-sm:data-starting-style:translate-y-4";

const VIEWPORT_BASE_CLASS = "fixed inset-0 justify-items-center p-4";

const MOBILE_VIEWPORT_CLASS = "max-sm:grid-rows-[1fr_auto] max-sm:p-0 max-sm:pt-12";

const EXPANDED_MEDIA_CLASS =
  "row-start-1 h-full w-[92vw] items-center justify-center [--media-width:92vw] [--media-height:min(calc((100vh-var(--native-titlebar-height,0px))*0.86),calc(100vh-var(--native-titlebar-height,0px)-160px))] sm:[--media-width:calc(92vw-96px)]";

export type IDialogVariant = "default" | "media";
const POPUP_WIDTH = { md: "max-w-md", default: "max-w-lg", xl: "max-w-xl", "3xl": "max-w-3xl" };

export type IDialogSize = keyof typeof POPUP_WIDTH | "expanded";

export interface IDialogLayout {
  variant: IDialogVariant;
  size: IDialogSize;
  bottomStickOnMobile: boolean;
  mediaControlsPlacement: "inside" | "outside";
}

const join = (parts: (string | false)[]) => parts.filter(Boolean).join(" ");

export const dialogBackdropClass = (variant: IDialogVariant) =>
  variant === "media"
    ? `${DIALOG_BACKDROP_BASE_CLASS} bg-black/75 backdrop-blur-none z-[60]`
    : `dialog-backdrop ${DIALOG_BACKDROP_BASE_CLASS} z-50`;

export const dialogViewportClass = (layout: IDialogLayout) => {
  const media = layout.variant === "media";
  return join([
    VIEWPORT_BASE_CLASS,
    "grid [-webkit-app-region:no-drag]",
    media ? "z-[60] grid-rows-1 place-items-center" : "z-50 grid-rows-[1fr_auto_1fr]",
    layout.bottomStickOnMobile && MOBILE_VIEWPORT_CLASS,
    media && "px-4 max-[8rem]:px-0 pb-6",
    media &&
      (layout.mediaControlsPlacement === "inside"
        ? "pt-[min(calc(var(--media-dialog-titlebar-height,0px)+1.5rem),50dvh)]"
        : "pt-[calc(var(--media-dialog-titlebar-height,0px)+1.5rem)]"),
  ]);
};

export const dialogPopupClass = (layout: IDialogLayout) => {
  const media = layout.variant === "media";
  const expanded = media && layout.size === "expanded";
  return join([
    media ? DIALOG_MEDIA_POPUP_CLASS : DIALOG_POPUP_CLASS,
    media && (expanded ? EXPANDED_MEDIA_CLASS : "w-auto"),
    expanded ? "" : "row-start-2",
    "text-popover-foreground",
    !media && "max-h-full",
    !media && POPUP_WIDTH[layout.size === "expanded" ? "default" : layout.size],
    layout.bottomStickOnMobile && DIALOG_MOBILE_SHEET_CLASS,
  ]);
};

export const alertDialogViewportClass = (bottomStickOnMobile: boolean) =>
  join([
    VIEWPORT_BASE_CLASS,
    "z-50 grid grid-rows-[1fr_auto_1fr]",
    bottomStickOnMobile && MOBILE_VIEWPORT_CLASS,
  ]);

export const alertDialogPopupClass = (bottomStickOnMobile: boolean) =>
  join([
    DIALOG_POPUP_CLASS,
    "row-start-2 max-h-full max-w-lg text-popover-foreground",
    bottomStickOnMobile && DIALOG_MOBILE_SHEET_CLASS,
  ]);

export const DIALOG_HEADER_CLASS =
  "flex flex-col gap-2 p-6 in-[[data-slot=dialog-popup]:has([data-slot=dialog-panel])]:pb-3 max-sm:pb-4";

export const ALERT_DIALOG_HEADER_CLASS =
  "flex min-h-0 flex-col gap-2 p-6 text-center max-sm:pb-4 sm:text-left";

const FOOTER_BASE_CLASS =
  "flex flex-col-reverse gap-2 px-6 sm:flex-row sm:justify-end sm:rounded-b-[calc(var(--radius-2xl)-1px)]";

export const dialogFooterClass = (variant: "default" | "bare") =>
  `${FOOTER_BASE_CLASS} ${variant === "default" ? "border-t bg-muted/72 py-4" : "py-4"}`;

export const alertDialogFooterClass = (variant: "default" | "bare") =>
  `${FOOTER_BASE_CLASS} ${variant === "default" ? "border-t bg-muted/72 py-4" : "pb-6"}`;

export const DIALOG_TITLE_CLASS = "wrap-anywhere font-semibold text-xl leading-snug";

export const ALERT_DIALOG_TITLE_CLASS = "wrap-anywhere shrink-0 font-semibold text-xl leading-snug";

export const DIALOG_DESCRIPTION_CLASS = "text-muted-foreground text-sm";

export const ALERT_DIALOG_DESCRIPTION_CLASS =
  "wrap-anywhere max-h-[min(24rem,60dvh)] min-h-0 overflow-y-auto overscroll-contain text-muted-foreground text-sm select-text";

export const DIALOG_PANEL_CLASS =
  "space-y-4 p-6 in-[[data-slot=dialog-popup]:has([data-slot=dialog-header])]:pt-1 in-[[data-slot=dialog-popup]:has([data-slot=dialog-footer]:not(.border-t))]:pb-1";
