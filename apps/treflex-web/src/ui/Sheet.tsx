const BACKDROP =
  "inset-0 z-(--z-sheet) bg-background/60 backdrop-blur-xs transition-all duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0";

/**
 * The sheet backdrop. `contained` keeps it inside the nearest positioned ancestor instead of the
 * viewport, for a sheet that floats over one region of the layout.
 */
export function SheetBackdrop(props: {
  contained?: boolean;
  ref?: (element: HTMLDivElement) => void;
  onClick: () => void;
}) {
  return (
    <div
      ref={(element) => props.ref?.(element)}
      class={`${props.contained === true ? "absolute" : "fixed"} ${BACKDROP} data-ending-style:pointer-events-none`}
      aria-hidden="true"
      data-slot="sheet-backdrop"
      onClick={() => props.onClick()}
    />
  );
}

const POPUP =
  "flex max-h-full min-h-0 flex-col not-dark:bg-clip-padding shadow-lg/5 transition-[opacity,translate] duration-200 ease-in-out will-change-transform before:pointer-events-none before:absolute before:inset-0 before:shadow-[0_1px_--theme(--color-black/4%)] data-ending-style:opacity-0 data-starting-style:opacity-0 max-sm:before:hidden dark:before:shadow-[0_-1px_--theme(--color-white/6%)]";

// Stands in for tailwind-merge: a side or surface replaces these by name, since two utilities for
// one property resolve by Tailwind's order, not the class order.
const PARTS = {
  position: "relative",
  width: "w-full",
  minWidth: "min-w-0",
  maxWidth: "",
  surface: "bg-popover text-popover-foreground",
};

type IParts = Partial<Record<keyof typeof PARTS, string>>;

const SIDE_WIDTH = { width: "w-[calc(100%-(--spacing(12)))]", maxWidth: "max-w-md" };

const SIDES = {
  bottom: [
    "row-start-2 border-t data-ending-style:translate-y-8 data-starting-style:translate-y-8",
  ],
  left: [
    "data-ending-style:-translate-x-8 data-starting-style:-translate-x-8 border-e",
    SIDE_WIDTH,
  ],
  right: [
    "col-start-2 border-s data-ending-style:translate-x-8 data-starting-style:translate-x-8",
    SIDE_WIDTH,
  ],
} satisfies Record<string, readonly [string, IParts?]>;

// A surface's position stands in for SheetViewport: these sheets sit in the layout instead of a
// portal.
const SURFACES = {
  sidebar: [
    "surface-grain",
    {
      position: "absolute top-[env(safe-area-inset-top)] bottom-0 left-0 z-(--z-sheet)",
      width: "w-[calc(100vw-12px)]",
      maxWidth: "max-w-none",
      surface: "bg-sidebar text-sidebar-foreground",
    },
  ],
  "right-panel": [
    "max-[760px]:w-[min(88vw,24rem)] max-[760px]:min-w-0",
    {
      position: "absolute inset-y-0 right-0 z-(--z-sheet)",
      width: "w-[min(42vw,28rem)]",
      minWidth: "min-w-80",
      maxWidth: "max-w-[28rem]",
    },
  ],
  terminal: [
    "h-[min(60%,420px)] overflow-hidden",
    {
      position: "absolute inset-x-0 bottom-0 z-(--z-sheet)",
      surface: "bg-(--terminal-background)",
    },
  ],
} satisfies Record<string, readonly [string, IParts?]>;

/** Stock's `SheetPopup` look for one of the layout's sheets. */
export function sheetPopupVariants(options: {
  side: keyof typeof SIDES;
  surface: keyof typeof SURFACES;
}) {
  const [sideClass, sideParts] = SIDES[options.side] as readonly [string, IParts?];
  const [surfaceClass, surfaceParts] = SURFACES[options.surface] as readonly [string, IParts?];
  return [
    POPUP,
    ...Object.values({ ...PARTS, ...sideParts, ...surfaceParts }),
    sideClass,
    surfaceClass,
  ]
    .filter(Boolean)
    .join(" ");
}
