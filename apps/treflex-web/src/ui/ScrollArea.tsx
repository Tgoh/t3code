import { type JSX, onCleanup, splitProps } from "solid-js";

import { overrides } from "./merge";
import { trackScrollOverflow } from "./scrollOverflow";

const ROOT = "size-full min-h-0 overflow-hidden";

const RADIUS = { inherit: "rounded-[inherit]", none: "rounded-none" };

const VIEWPORT =
  "h-full max-h-[inherit] overflow-auto overscroll-contain rounded-[inherit] outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background data-has-overflow-x:overscroll-x-contain";

const FADE =
  "mask-t-from-[calc(100%-min(var(--fade-size),var(--scroll-area-overflow-y-start)))] mask-b-from-[calc(100%-min(var(--fade-size),var(--scroll-area-overflow-y-end)))] mask-l-from-[calc(100%-min(var(--fade-size),var(--scroll-area-overflow-x-start)))] mask-r-from-[calc(100%-min(var(--fade-size),var(--scroll-area-overflow-x-end)))] focus-visible:mask-none [--fade-size:1.5rem]";

const HIDDEN_SCROLLBARS =
  "[-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden";

interface IScrollAreaOptions {
  scrollFade?: boolean | undefined;
  scrollFadePadding?: boolean | undefined;
  scrollbarGutter?: boolean | undefined;
  hideScrollbars?: boolean | undefined;
  chainVerticalScroll?: boolean | undefined;
}

function scrollAreaClass(
  options: { radius?: keyof typeof RADIUS | undefined; class?: string | undefined } = {},
) {
  return [
    overrides(options.class, "position") ? "" : "relative",
    ROOT,
    RADIUS[options.radius ?? "inherit"],
    options.class,
  ]
    .filter(Boolean)
    .join(" ");
}

function scrollAreaViewportClass(options: IScrollAreaOptions = {}) {
  const fade = options.scrollFade === true;
  const fadePadding = options.scrollFadePadding !== false;
  return [
    VIEWPORT,
    options.chainVerticalScroll === true && "overscroll-y-auto",
    fade && FADE,
    fade && fadePadding && "scroll-p-[var(--fade-size)]",
    fade && !fadePadding && "has-focus-visible:mask-none",
    options.scrollbarGutter === true && "scrollbar-gutter-stable",
    options.hideScrollbars === true && HIDDEN_SCROLLBARS,
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * A native scroller with Base UI's ScrollArea viewport attributes and fade variables. The
 * scrollbars stay the page's native ones rather than Base UI's overlay thumbs.
 */
export function ScrollArea(
  props: JSX.HTMLAttributes<HTMLDivElement> &
    IScrollAreaOptions & {
      radius?: keyof typeof RADIUS;
      viewportTabIndex?: number;
    },
) {
  const [local, options, rest] = splitProps(
    props,
    ["class", "radius", "viewportTabIndex", "children"],
    ["scrollFade", "scrollFadePadding", "scrollbarGutter", "hideScrollbars", "chainVerticalScroll"],
  );
  return (
    <div {...rest} class={scrollAreaClass({ radius: local.radius, class: local.class })}>
      <div
        ref={(element) =>
          onCleanup(trackScrollOverflow(element, { tabIndex: local.viewportTabIndex }))
        }
        class={scrollAreaViewportClass(options)}
        data-slot="scroll-area-viewport"
      >
        {local.children}
      </div>
    </div>
  );
}
