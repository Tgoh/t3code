import {
  type Accessor,
  createComputed,
  createContext,
  createSignal,
  on,
  onCleanup,
  useContext,
} from "solid-js";

/**
 * Stock's breakpoints: `SIDEBAR_MOBILE_QUERY` in `apps/web/src/components/ui/sidebar.tsx`,
 * `RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY` in `rightPanelLayout.ts`, and `max-sm` for the composer.
 * The `@media` rules in `styles.css` use the same widths.
 */
export const SIDEBAR_SHEET_QUERY = "(max-width: 767px)";
export const PANEL_SHEET_QUERY = "(max-width: 980px)";
export const PHONE_QUERY = "(max-width: 639px)";

type IMediaList = Pick<MediaQueryList, "matches" | "addEventListener" | "removeEventListener">;

export function createMediaQuery(
  query: string,
  matchMedia: (query: string) => IMediaList = (held) => window.matchMedia(held),
): Accessor<boolean> {
  const list = matchMedia(query);
  const [matches, setMatches] = createSignal(list.matches);
  const update = () => setMatches(list.matches);
  list.addEventListener("change", update);
  onCleanup(() => list.removeEventListener("change", update));
  return matches;
}

/**
 * Sizes the app to the visual viewport, which iOS Safari shrinks for the on-screen keyboard while
 * the layout viewport stays full height. Pinch zoom also shrinks it, so a zoomed page is left alone.
 */
export function trackVisualViewport(target: HTMLElement) {
  const viewport = window.visualViewport;
  if (viewport == null) return;
  const update = () => {
    if (Math.abs(viewport.scale - 1) > 0.01) {
      target.style.removeProperty("--viewport-height");
      target.style.removeProperty("--viewport-top");
      return;
    }
    target.style.setProperty("--viewport-height", `${viewport.height}px`);
    target.style.setProperty("--viewport-top", `${viewport.offsetTop}px`);
  };
  update();
  viewport.addEventListener("resize", update);
  viewport.addEventListener("scroll", update);
  onCleanup(() => {
    viewport.removeEventListener("resize", update);
    viewport.removeEventListener("scroll", update);
  });
}

export function composerCollapses(input: {
  Phone: boolean;
  Focused: boolean;
  Draft: string;
  HasAttachments: boolean;
}): boolean {
  return input.Phone && !input.Focused && !input.Draft.includes("\n") && !input.HasAttachments;
}

export interface ISidebarSheet {
  /** The sidebar is an off-canvas sheet rather than a column. */
  sheet: Accessor<boolean>;
  open: Accessor<boolean>;
  setOpen: (open: boolean) => void;
}

/** Selecting a thread closes the sheet, and leaving the sheet layout forgets that it was open. */
export function createSidebarSheet(sheet: Accessor<boolean>, selection: Accessor<unknown>) {
  const [open, setOpen] = createSignal(false);
  createComputed(on(selection, () => setOpen(false), { defer: true }));
  createComputed(() => {
    if (!sheet()) setOpen(false);
  });
  return { sheet, open: () => sheet() && open(), setOpen } satisfies ISidebarSheet;
}

export const SidebarSheetContext = createContext<ISidebarSheet>({
  sheet: () => false,
  open: () => false,
  setOpen: () => {},
});

export const useSidebarSheet = () => useContext(SidebarSheetContext);
