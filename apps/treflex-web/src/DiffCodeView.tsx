import { CodeView, type CodeViewDiffItem, type CodeViewOptions } from "@pierre/diffs";
import { createEffect, createSignal, onCleanup, untrack } from "solid-js";

import { THEME_NAMES } from "./codeHighlighter";
import { DIFF_VIEW_UNSAFE_CSS, fileDiffPath, fnv1a32, type IFileDiffEntry } from "./diffRendering";
import { acquireDiffWorkers, followScheme } from "./diffWorkers";
import { buttonVariants } from "./ui/Button";

// Follows StyledDiffCodeView and AnnotatableCodeView in apps/web/src/components/diffs, and the
// diff options and header handling of apps/web/src/components/DiffPanel.tsx.

type IScheme = keyof typeof THEME_NAMES;

export interface IShownFile {
  Entry: IFileDiffEntry;
  Collapsed: boolean;
}

const COLLAPSE_BUTTON = buttonVariants({ variant: "ghost", size: "icon-micro", class: "-ms-0.5" });
const CHEVRON = { right: "m9 18 6-6-6-6", down: "m6 9 6 6 6-6" };
const SVG = "http://www.w3.org/2000/svg";

function chevron(collapsed: boolean): SVGSVGElement {
  const svg = document.createElementNS(SVG, "svg");
  for (const [name, value] of Object.entries({
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "2",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    class: "size-4 text-muted-foreground/80",
    "aria-hidden": "true",
  })) {
    svg.setAttribute(name, value);
  }
  const path = document.createElementNS(SVG, "path");
  path.setAttribute("d", collapsed ? CHEVRON.right : CHEVRON.down);
  svg.append(path);
  return svg;
}

// Pierre renders the prefix into a slot on the file's shadow host, so it lives in the page's DOM
// and takes the page's classes.
function collapseButton(key: string, path: string, collapsed: boolean): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = COLLAPSE_BUTTON;
  button.dataset.diffFileKey = key;
  button.dataset.tip = collapsed ? "Expand diff" : "Collapse diff";
  button.setAttribute("aria-label", `${collapsed ? "Expand" : "Collapse"} ${path}`);
  button.setAttribute("aria-expanded", String(!collapsed));
  button.append(chevron(collapsed));
  return button;
}

/** What a click in a file header asks for: the title opens the file, the rest of it toggles. */
function headerClick(event: MouseEvent): { Open: string } | { Toggle: string } | null {
  const path = event.composedPath();
  const button = path.find((node): node is HTMLButtonElement => node instanceof HTMLButtonElement);
  if (button !== undefined) {
    const key = button.dataset.diffFileKey;
    return key === undefined ? null : { Toggle: key };
  }
  if (path.some((node) => node instanceof HTMLAnchorElement)) return null;
  const title = path.find(
    (node): node is HTMLElement => node instanceof HTMLElement && node.hasAttribute("data-title"),
  );
  if (title?.textContent) return { Open: title.textContent };
  const header = path.find(
    (node): node is HTMLElement =>
      node instanceof HTMLElement && node.hasAttribute("data-diffs-header"),
  );
  const root = header?.getRootNode();
  const key =
    root instanceof ShadowRoot
      ? root.host.querySelector("[data-diff-file-key]")?.getAttribute("data-diff-file-key")
      : null;
  return key ? { Toggle: key } : null;
}

const toItem = (file: IShownFile): CodeViewDiffItem<undefined> => ({
  id: file.Entry.Key,
  type: "diff",
  fileDiff: file.Entry.FileDiff,
  collapsed: file.Collapsed,
  version: fnv1a32(`${file.Entry.Version}:${file.Collapsed ? "1" : "0"}`),
});

export default function DiffCodeView(props: {
  files: IShownFile[];
  split: boolean;
  wrap: boolean;
  scheme: IScheme;
  /** A file to scroll to once it's in the list, by key. */
  reveal: string | null;
  onToggle: (key: string) => void;
  onOpen: (path: string) => void;
}) {
  const workers = acquireDiffWorkers(untrack(() => props.scheme));
  const options = (): CodeViewOptions<undefined, undefined> => ({
    diffStyle: props.split ? "split" : "unified",
    lineDiffType: "none",
    overflow: props.wrap ? "wrap" : "scroll",
    theme: THEME_NAMES[props.scheme],
    themeType: props.scheme,
    preferredHighlighter: "highlights",
    stickyHeaders: true,
    unsafeCSS: DIFF_VIEW_UNSAFE_CSS,
    itemMetrics: {
      diffHeaderHeight: 32,
      hunkSeparatorHeight: 24,
      spacing: 0,
      paddingTop: 0,
      // Pierre's 8px --diffs-gap-fallback, or each expanded file loses a scrollable row.
      paddingBottom: 8,
    },
    layout: { paddingTop: 0, paddingBottom: 0, gap: 0 },
    renderHeaderPrefix: (_fileDiff, context) =>
      context.item.type === "diff"
        ? collapseButton(
            context.item.id,
            fileDiffPath(context.item.fileDiff),
            context.item.collapsed === true,
          )
        : undefined,
    onItemCollapsedChange: (_item, next) => {
      if ((next.collapsed === true) !== (_item.collapsed === true)) props.onToggle(next.id);
    },
  });
  const view = new CodeView<undefined, undefined>(untrack(options), workers.pool);
  // Captured, so a header's click is handled before Pierre's own handlers inside its shadow root.
  const onClick = (event: MouseEvent) => {
    const action = headerClick(event);
    if (action === null) return;
    event.stopPropagation();
    if ("Open" in action) props.onOpen(action.Open);
    else props.onToggle(action.Toggle);
  };
  // Scrolls once per file asked for, so a later render doesn't pull the reader back to it.
  let revealed: string | null = null;
  const reveal = (key: string | null) => {
    if (key === null || key === revealed || view.getItem(key) === undefined) return;
    revealed = key;
    view.scrollTo({ type: "item", id: key, align: "start" });
  };
  const [host, setHost] = createSignal<HTMLDivElement>();
  createEffect(host, (element) => {
    if (element === undefined) return;
    view.setup(element);
    view.setItems(untrack(() => props.files.map(toItem)));
    view.render(true);
    reveal(untrack(() => props.reveal));
    element.addEventListener("click", onClick, true);
    return () => element.removeEventListener("click", onClick, true);
  });
  createEffect(
    () => props.reveal,
    (key) => reveal(key),
    { defer: true },
  );
  createEffect(
    () => [props.split, props.wrap, props.scheme],
    () => {
      view.setOptions(untrack(options));
      view.render(true);
    },
    { defer: true },
  );
  createEffect(
    () => props.files.map(toItem),
    (items) => {
      view.setItems(items);
      view.render(true);
      reveal(untrack(() => props.reveal));
    },
    { defer: true },
  );
  createEffect(
    () => props.scheme,
    (scheme) => {
      void followScheme(workers.pool, scheme).catch(() => undefined);
    },
  );
  onCleanup(() => {
    view.cleanUp();
    workers.release();
  });
  return (
    <div
      ref={setHost}
      class="diff-render-surface h-full min-h-0 overflow-auto outline-none [--code-background:var(--background)]"
    />
  );
}
