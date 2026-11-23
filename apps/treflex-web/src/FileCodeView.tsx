import { CodeView, type CodeViewFileItem, type CodeViewOptions } from "@pierre/diffs";
import { createEffect, createSignal, onCleanup, untrack } from "solid-js";

import { THEME_NAMES } from "./codeHighlighter";
import { DIFF_SURFACE_THEME_UNSAFE_CSS, fnv1a32 } from "./diffRendering";
import { acquireDiffWorkers, followScheme } from "./diffWorkers";
import { clampFileLine } from "./filePreview";

// Follows apps/web/src/components/files/ReadOnlySourcePreview.tsx, updateFileLinkReveal and
// useFileLineReveal in FilePreviewPanel.tsx, and FILE_LINK_REVEAL_UNSAFE_CSS in
// fileSurfaceChrome.tsx.

type IScheme = keyof typeof THEME_NAMES;

const REVEAL_ATTRIBUTE = "data-file-link-reveal";

const FILE_VIEW_UNSAFE_CSS = `
  ${DIFF_SURFACE_THEME_UNSAFE_CSS}

  diffs-container {
    --diffs-bg: var(--code-background, var(--background)) !important;
    --diffs-light-bg: var(--code-background, var(--background)) !important;
    --diffs-dark-bg: var(--code-background, var(--background)) !important;
    background-color: var(--code-background, var(--background)) !important;
    color: var(--code-foreground, var(--foreground)) !important;
  }

  [${REVEAL_ATTRIBUTE}][data-line] {
    --diffs-line-bg: light-dark(
      color-mix(
        in lab,
        var(--diffs-computed-diff-line-bg) 82%,
        var(--diffs-bg-selection-override, var(--diffs-selection-base))
      ),
      color-mix(
        in lab,
        var(--diffs-computed-diff-line-bg) 75%,
        var(--diffs-bg-selection-override, var(--diffs-selection-base))
      )
    ) !important;
  }

  [${REVEAL_ATTRIBUTE}][data-column-number] {
    background-color: light-dark(
      color-mix(
        in lab,
        var(--diffs-computed-diff-line-bg) 75%,
        var(--diffs-bg-selection-number-override, var(--diffs-selection-base))
      ),
      color-mix(
        in lab,
        var(--diffs-computed-diff-line-bg) 60%,
        var(--diffs-bg-selection-number-override, var(--diffs-selection-base))
      )
    ) !important;
    color: var(--diffs-selection-number-fg) !important;
  }
`;

const ITEM_ID = "file";

function markRevealedLine(node: HTMLElement, line: number | null): void {
  const root = node.shadowRoot ?? node;
  for (const element of root.querySelectorAll(`[${REVEAL_ATTRIBUTE}]`)) {
    element.removeAttribute(REVEAL_ATTRIBUTE);
  }
  if (line === null) return;
  root.querySelector(`[data-line="${line}"]`)?.setAttribute(REVEAL_ATTRIBUTE, "");
  root.querySelector(`[data-column-number="${line}"]`)?.setAttribute(REVEAL_ATTRIBUTE, "");
}

export default function FileCodeView(props: {
  name: string;
  text: string;
  wrap: boolean;
  scheme: IScheme;
  revealLine: number | null;
  /** A new id scrolls to `revealLine` again. */
  revealId: number;
}) {
  const workers = acquireDiffWorkers(untrack(() => props.scheme));
  const line = () =>
    props.revealLine === null ? null : clampFileLine(props.text, props.revealLine);
  const item = (): CodeViewFileItem<undefined> => ({
    id: ITEM_ID,
    type: "file",
    file: {
      name: props.name,
      contents: props.text,
      cacheKey: `${props.name}:${fnv1a32(props.text)}`,
    },
    version: fnv1a32(props.text),
  });
  const options = (): CodeViewOptions<undefined, undefined> => ({
    disableFileHeader: true,
    overflow: props.wrap ? "wrap" : "scroll",
    theme: THEME_NAMES[props.scheme],
    themeType: props.scheme,
    preferredHighlighter: "highlights",
    unsafeCSS: FILE_VIEW_UNSAFE_CSS,
    layout: { paddingTop: 0, paddingBottom: 0, gap: 0 },
    onPostRender: (node, _instance, phase) => {
      if (phase !== "unmount") markRevealedLine(node, untrack(line));
    },
  });
  const view = new CodeView<undefined, undefined>(untrack(options), workers.pool);
  const reveal = () => {
    const target = untrack(line);
    if (target !== null) {
      view.scrollTo({ type: "line", id: ITEM_ID, lineNumber: target, align: "center" });
    }
  };
  const [host, setHost] = createSignal<HTMLDivElement>();
  createEffect(host, (element) => {
    if (element === undefined) return;
    view.setup(element);
    view.setItems([untrack(item)]);
    view.render(true);
    reveal();
  });
  createEffect(
    () => [props.wrap, props.scheme],
    () => {
      view.setOptions(untrack(options));
      view.render(true);
    },
    { defer: true },
  );
  createEffect(
    () => props.text,
    () => {
      view.setItems([untrack(item)]);
      view.render(true);
    },
    { defer: true },
  );
  createEffect(
    () => [props.revealLine, props.revealId],
    () => {
      view.render(true);
      reveal();
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
    <div ref={setHost} class="file-preview-virtualizer min-h-0 flex-1 overflow-auto outline-none" />
  );
}
