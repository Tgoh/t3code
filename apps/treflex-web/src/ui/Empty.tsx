import type { JSX } from "@solidjs/web";
import { omit, Show } from "solid-js";

const SIZES = {
  compact:
    "min-h-64 gap-4 p-6 md:p-10 [&_[data-slot=empty-media]]:mb-0 [&_[data-slot=empty-title]]:text-[1.0625rem] [&_[data-slot=empty-title]]:leading-6 [&_[data-slot=empty-description]]:text-[0.8125rem] [&_[data-slot=empty-description]]:leading-[1.125rem]",
  default: "gap-6 p-6 md:p-12",
  hero: "gap-6 p-6 md:p-12 [&_[data-slot=empty-title]]:text-2xl sm:[&_[data-slot=empty-title]]:text-3xl",
};

const MEDIA_BASE =
  "flex shrink-0 items-center justify-center [&_svg]:pointer-events-none [&_svg]:shrink-0";

const MEDIA_VARIANTS = {
  default: "bg-transparent",
  icon: "relative flex size-9 shrink-0 items-center justify-center rounded-md border bg-card not-dark:bg-clip-padding text-foreground shadow-sm/5 before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-md)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] dark:before:shadow-[0_-1px_--theme(--color-white/6%)] [&_svg:not([class*='size-'])]:size-4.5",
};

// The cards fanned behind an icon are `absolute` and `shadow-none`, which replace the icon's
// `relative` and `shadow-sm/5` as tailwind-merge does for stock.
const ICON_DECORATION = MEDIA_VARIANTS.icon
  .split(" ")
  .filter((token) => token !== "relative" && token !== "shadow-sm/5")
  .join(" ");

const join = (...classes: (string | undefined)[]) => classes.filter(Boolean).join(" ");

export function Empty(
  props: JSX.HTMLAttributes<HTMLDivElement> & { class?: string; size?: keyof typeof SIZES },
) {
  const rest = omit(props, "size", "class");
  return (
    <div
      data-slot="empty"
      {...rest}
      class={join(
        "flex min-w-0 flex-1 flex-col items-center justify-center text-balance text-center",
        SIZES[props.size ?? "default"],
        props.class,
      )}
    />
  );
}

export function EmptyHeader(
  props: JSX.HTMLAttributes<HTMLDivElement> & { class?: string; wide?: boolean },
) {
  const rest = omit(props, "wide", "class");
  return (
    <div
      data-slot="empty-header"
      {...rest}
      class={join(
        "flex flex-col items-center text-center",
        props.wide ? "max-w-none" : "max-w-sm",
        props.class,
      )}
    />
  );
}

export function EmptyMedia(
  props: JSX.HTMLAttributes<HTMLDivElement> & {
    class?: string;
    variant?: keyof typeof MEDIA_VARIANTS;
  },
) {
  const rest = omit(props, "variant", "class", "children");
  const variant = () => props.variant ?? "default";
  const media = () => join(MEDIA_BASE, MEDIA_VARIANTS[variant()], props.class);
  const decoration = (extra: string) => join(MEDIA_BASE, ICON_DECORATION, props.class, extra);
  return (
    <div
      data-slot="empty-media"
      data-variant={variant()}
      {...rest}
      class={join("relative mb-6", props.class)}
    >
      <Show when={variant() === "icon"}>
        <div
          aria-hidden="true"
          class={decoration(
            "-translate-x-0.5 -rotate-10 pointer-events-none absolute bottom-px origin-bottom-left scale-84 shadow-none",
          )}
        />
        <div
          aria-hidden="true"
          class={decoration(
            "pointer-events-none absolute bottom-px origin-bottom-right translate-x-0.5 rotate-10 scale-84 shadow-none",
          )}
        />
      </Show>
      <div class={media()}>{props.children}</div>
    </div>
  );
}

export function EmptyTitle(props: JSX.HTMLAttributes<HTMLDivElement> & { class?: string }) {
  const rest = omit(props, "class");
  return (
    <div data-slot="empty-title" {...rest} class={join("font-semibold text-xl", props.class)} />
  );
}

export function EmptyDescription(props: JSX.HTMLAttributes<HTMLDivElement> & { class?: string }) {
  const rest = omit(props, "class");
  return (
    <div
      data-slot="empty-description"
      {...rest}
      class={join(
        "text-muted-foreground text-sm [&>a:hover]:text-primary [&>a]:underline [&>a]:underline-offset-4 [[data-slot=empty-title]+&]:mt-1 [[data-slot=empty-description]+&]:mt-1",
        props.class,
      )}
    />
  );
}

export function EmptyContent(props: JSX.HTMLAttributes<HTMLDivElement> & { class?: string }) {
  const rest = omit(props, "class");
  return (
    <div
      data-slot="empty-content"
      {...rest}
      class={join(
        "flex w-full min-w-0 max-w-sm flex-col items-center gap-4 text-balance text-sm",
        props.class,
      )}
    />
  );
}
