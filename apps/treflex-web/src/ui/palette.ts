// The command palette and add-project palette chrome. Follows CommandDialog in
// apps/web/src/components/ui/command.tsx: centred near the top, one input row, grouped rows and a
// footer of key hints.

// The backdrop fades on ::before, so its fade doesn't multiply into the palette's own.
export const PALETTE_BACKDROP =
  "fixed inset-0 z-130 flex justify-center px-4 pt-[10vh] pb-4 before:absolute before:inset-0 before:-z-1 before:bg-(--dialog-backdrop) before:backdrop-blur-[4px] before:transition-opacity before:duration-200 data-starting-style:before:opacity-0 data-ending-style:pointer-events-none data-ending-style:before:opacity-0";

export const PALETTE =
  "flex max-h-[80vh] w-[min(36rem,100%)] flex-col self-start overflow-hidden rounded-xl border border-border bg-popover text-foreground shadow-[0_16px_40px_-8px_rgb(0_0_0/25%)] transition-[scale,opacity] duration-200 ease-in-out data-starting-style:scale-98 data-starting-style:opacity-0 data-ending-style:scale-98 data-ending-style:opacity-0";

export const PALETTE_INPUT_ROW = "flex items-center gap-2 border-b border-border px-2.5 py-2";

export const PALETTE_ADDON =
  "inline-flex flex-none items-center border-0 bg-transparent p-0 text-muted-foreground [&>svg]:size-4";

export const PALETTE_BACK = `${PALETTE_ADDON} cursor-pointer rounded-sm hover:text-foreground`;

export const PALETTE_INPUT =
  "h-7 min-w-0 flex-1 border-0 bg-transparent px-0.5 text-[14px] text-inherit outline-none placeholder:text-muted-foreground";

export const PALETTE_SUBMIT =
  "inline-flex h-[26px] flex-none cursor-pointer items-center gap-1.5 rounded-md border border-input bg-popover py-0 pr-1 pl-2 text-[12px] font-medium hover:bg-accent disabled:cursor-default disabled:opacity-64";

export const PALETTE_KBD =
  "rounded-sm border border-border bg-muted px-1 py-0 [font-family:inherit] text-[11px] leading-4 text-muted-foreground";

export const PALETTE_LIST =
  "flex min-h-0 flex-col overflow-y-auto px-1.5 pt-1 pb-1.5 [scrollbar-width:thin]";

export const PALETTE_GROUP = "mx-1.5 mt-1.5 mb-0.5 text-[12px] font-medium text-muted-foreground";

const ROW =
  "flex w-full flex-none cursor-pointer items-center gap-2.5 rounded-md border-0 bg-transparent px-2 py-1 text-left text-inherit aria-selected:bg-accent [&_svg]:flex-none [&_svg]:text-muted-foreground [&>svg]:size-4";

/** A row with a title and a detail line. Highlight it with `aria-selected`. */
export const PALETTE_ROW = `${ROW} min-h-11`;

export const PALETTE_ROW_COMPACT = `${ROW} min-h-[30px]`;

export const PALETTE_ROW_TEXT = "flex min-w-0 flex-1 flex-col";

export const PALETTE_ROW_TITLE = "truncate text-[14px]";

export const PALETTE_ROW_DETAIL = "truncate text-[12px] text-muted-foreground";

export const PALETTE_NOTE = "mx-2 my-1.5 text-[13px] wrap-anywhere text-muted-foreground";

export const PALETTE_ERROR = "mx-2 my-1.5 text-[13px] wrap-anywhere text-error-foreground";

export const PALETTE_WARNING = "mx-2 my-1.5 text-[13px] wrap-anywhere text-warning-foreground";

export const PALETTE_FOOTER =
  "flex flex-wrap gap-x-3.5 gap-y-1 border-t border-border px-3 py-[7px] text-[12px] text-muted-foreground";
