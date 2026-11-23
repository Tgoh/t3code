import type { JSX } from "@solidjs/web";
import { omit } from "solid-js";

import { overrides } from "./merge";

const BASE =
  "[&_svg]:-mx-0.5 inline-flex cursor-pointer items-center justify-center border font-medium outline-none transition-[box-shadow,scale] [&:not([aria-haspopup]):not(:disabled):not([aria-disabled=true])]:will-change-[scale] [&:active:not([aria-haspopup])]:scale-[0.97] before:pointer-events-none before:absolute before:inset-0 pointer-coarse:after:absolute pointer-coarse:after:size-full pointer-coarse:after:min-h-11 pointer-coarse:after:min-w-11 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-64 aria-disabled:cursor-not-allowed aria-disabled:opacity-64 [&_svg:not([class*='text-'])]:text-[var(--control-icon-color)] [&_svg]:pointer-events-none [&_svg]:shrink-0";

// Stands in for tailwind-merge: a size or variant replaces these base classes by name, since two
// utilities for one property resolve by Tailwind's order, not the class order.
const PARTS = {
  iconColor: "[--control-icon-color:currentColor]",
  position: "relative",
  shrink: "shrink-0",
  gap: "gap-2",
  whitespace: "whitespace-nowrap",
  radius: "rounded-[var(--control-radius)]",
  beforeRadius: "before:rounded-[calc(var(--control-radius)-1px)]",
  text: "text-base",
  smText: "sm:text-sm",
  svg: "[&_svg:not([class*='size-'])]:size-4.5",
  smSvg: "sm:[&_svg:not([class*='size-'])]:size-4",
  ring: "focus-visible:ring-ring",
  ringOffset: "focus-visible:ring-offset-background",
};

type IParts = Partial<Record<keyof typeof PARTS, string>>;

const CONTRAST_ICON = "[--control-icon-color:var(--contrast-muted-foreground)]";
const CURRENT_ICON = "[--control-icon-color:currentColor]";
const MEDIA_NAVIGATION =
  "border-transparent text-white/90 [:hover,[data-pressed]]:bg-white/10 [:hover,[data-pressed]]:text-white";

const SIZES = {
  compact: [
    "h-7 px-[calc(--spacing(2)-1px)]",
    {
      gap: "gap-1",
      radius: "rounded-md",
      beforeRadius: "before:rounded-[calc(var(--radius-md)-1px)]",
      text: "text-xs",
      svg: "[&_svg:not([class*='size-'])]:size-3.5",
    },
  ],
  default: ["h-9 px-[calc(--spacing(3)-1px)] sm:h-8"],
  icon: ["size-9 sm:size-8"],
  "icon-lg": ["size-10 sm:size-9"],
  "icon-micro": [
    "size-5 p-0",
    {
      radius: "rounded-sm",
      beforeRadius: "before:rounded-[calc(var(--radius-sm)-1px)]",
      svg: "[&_svg:not([class*='size-'])]:size-3",
    },
  ],
  "icon-tiny": ["size-4 p-0", { svg: "[&_svg:not([class*='size-'])]:size-3" }],
  "icon-sm": ["size-8 sm:size-7"],
  "icon-sm-pill": [
    "size-8 sm:size-7",
    { radius: "rounded-full", beforeRadius: "before:rounded-full" },
  ],
  "icon-titlebar": ["size-[var(--workspace-titlebar-control-size)]"],
  "icon-xl": [
    "size-11 sm:size-10",
    {
      svg: "[&_svg:not([class*='size-'])]:size-5",
      smSvg: "sm:[&_svg:not([class*='size-'])]:size-4.5",
    },
  ],
  "icon-xs": [
    "size-7 sm:size-6 not-in-data-[slot=input-group]:[&_svg:not([class*='size-'])]:size-4 sm:not-in-data-[slot=input-group]:[&_svg:not([class*='size-'])]:size-3.5",
  ],
  lg: ["h-10 px-[calc(--spacing(3.5)-1px)] sm:h-9"],
  micro: [
    "h-5 px-[calc(--spacing(1.5)-1px)]",
    {
      gap: "gap-1",
      radius: "rounded-sm",
      beforeRadius: "before:rounded-[calc(var(--radius-sm)-1px)]",
      text: "text-[11px]",
      smText: "sm:text-[11px]",
      svg: "[&_svg:not([class*='size-'])]:size-3",
      smSvg: "sm:[&_svg:not([class*='size-'])]:size-3",
    },
  ],
  multiline: [
    "min-h-9 px-[calc(--spacing(3)-1px)] py-[calc(--spacing(1.5)-1px)] sm:min-h-8",
    { whitespace: "whitespace-normal" },
  ],
  sm: ["h-8 px-[calc(--spacing(2.5)-1px)] sm:h-7", { gap: "gap-1.5" }],
  "sm-pill": ["h-8 px-2.5 sm:h-7", { gap: "gap-1.5", radius: "rounded-full" }],
  "sm-multiline": [
    "min-h-8 px-[calc(--spacing(2.5)-1px)] py-[calc(--spacing(1)-1px)] sm:min-h-7",
    { gap: "gap-1.5", whitespace: "whitespace-normal" },
  ],
  xl: [
    "h-11 px-[calc(--spacing(4)-1px)] sm:h-10",
    {
      text: "text-lg",
      smText: "sm:text-base",
      svg: "[&_svg:not([class*='size-'])]:size-5",
      smSvg: "sm:[&_svg:not([class*='size-'])]:size-4.5",
    },
  ],
  xs: [
    "h-7 px-[calc(--spacing(2)-1px)] sm:h-6",
    {
      gap: "gap-1",
      text: "text-sm",
      smText: "sm:text-xs",
      svg: "[&_svg:not([class*='size-'])]:size-4",
      smSvg: "sm:[&_svg:not([class*='size-'])]:size-3.5",
    },
  ],
} satisfies Record<string, readonly [string, IParts?]>;

const VARIANTS = {
  default: [
    "not-disabled:inset-shadow-[0_1px_--theme(--color-white/16%)] border-primary bg-primary text-primary-foreground shadow-primary/24 shadow-xs [:active,[data-pressed]]:inset-shadow-[0_1px_--theme(--color-black/8%)] [:disabled,:active,[data-pressed]]:shadow-none [:hover,[data-pressed]]:bg-primary/90",
  ],
  destructive: [
    "not-disabled:inset-shadow-[0_1px_--theme(--color-white/16%)] border-destructive bg-destructive text-white shadow-destructive/24 shadow-xs [:active,[data-pressed]]:inset-shadow-[0_1px_--theme(--color-black/8%)] [:disabled,:active,[data-pressed]]:shadow-none [:hover,[data-pressed]]:bg-destructive/90",
  ],
  "destructive-outline": [
    "border-input bg-popover not-dark:bg-clip-padding text-destructive-foreground shadow-xs/5 not-disabled:not-active:not-data-pressed:before:shadow-[0_1px_--theme(--color-black/4%)] dark:bg-input/32 dark:not-disabled:before:shadow-[0_-1px_--theme(--color-white/2%)] dark:not-disabled:not-active:not-data-pressed:before:shadow-[0_-1px_--theme(--color-white/6%)] [:disabled,:active,[data-pressed]]:shadow-none [:hover,[data-pressed]]:border-destructive/32 [:hover,[data-pressed]]:bg-destructive/4",
  ],
  ghost: [
    "border-transparent text-foreground data-pressed:bg-accent [:hover,[data-pressed]]:bg-accent",
    { iconColor: CONTRAST_ICON },
  ],
  "ghost-muted": [
    "border-transparent text-muted-foreground data-pressed:bg-accent [:hover,[data-pressed]]:bg-accent [:hover,[data-pressed]]:text-foreground",
    { iconColor: CURRENT_ICON },
  ],
  "ghost-destructive": [
    "border-transparent text-muted-foreground data-pressed:bg-accent [:hover,[data-pressed]]:bg-accent [:hover,[data-pressed]]:text-destructive",
    { iconColor: CURRENT_ICON },
  ],
  glass: [
    "surface-glass border-border/60 text-foreground shadow-sm [:hover,[data-pressed]]:border-border",
    { iconColor: CONTRAST_ICON, radius: "rounded-full", beforeRadius: "before:rounded-full" },
  ],
  link: ["border-transparent underline-offset-4 [:hover,[data-pressed]]:underline"],
  "media-close": [
    "border-transparent bg-black/65 text-white shadow-sm ring-1 ring-white/20 [:hover,[data-pressed]]:bg-black/80",
    { iconColor: CURRENT_ICON, ring: "focus-visible:ring-white" },
  ],
  "media-navigation": [
    MEDIA_NAVIGATION,
    {
      iconColor: CURRENT_ICON,
      position: "absolute top-1/2 z-20 -translate-y-1/2",
      ring: "focus-visible:ring-white",
      ringOffset: "focus-visible:ring-offset-transparent",
    },
  ],
  "media-navigation-inline": [
    MEDIA_NAVIGATION,
    {
      iconColor: CURRENT_ICON,
      position: "relative z-20",
      ring: "focus-visible:ring-white",
      ringOffset: "focus-visible:ring-offset-transparent",
    },
  ],
  outline: [
    "border-input bg-popover not-dark:bg-clip-padding text-foreground shadow-xs/5 not-disabled:not-active:not-data-pressed:before:shadow-[0_1px_--theme(--color-black/4%)] dark:bg-input/32 dark:not-disabled:before:shadow-[0_-1px_--theme(--color-white/2%)] dark:not-disabled:not-active:not-data-pressed:before:shadow-[0_-1px_--theme(--color-white/6%)] [:disabled,:active,[data-pressed]]:shadow-none [:hover,[data-pressed]]:bg-accent/50 dark:[:hover,[data-pressed]]:bg-input/64",
    { iconColor: CONTRAST_ICON },
  ],
  overlay: ["border-transparent bg-black/70 text-white/65 [:hover,[data-pressed]]:bg-black/90"],
  secondary: [
    "border-transparent bg-secondary text-secondary-foreground [:active,[data-pressed]]:bg-secondary/80 [:hover,[data-pressed]]:bg-secondary/90",
  ],
  "warning-outline": [
    "border-warning/32 bg-warning-surface text-warning-foreground shadow-xs/5 [:disabled,:active,[data-pressed]]:shadow-none [:hover,[data-pressed]]:border-warning/40 [:hover,[data-pressed]]:bg-warning/16 dark:[:hover,[data-pressed]]:bg-warning/24",
  ],
} satisfies Record<string, readonly [string, IParts?]>;

export type ButtonVariant = keyof typeof VARIANTS;
export type ButtonSize = keyof typeof SIZES;

/** The button look, for an element that can't be a `<button>`, such as a link or a label. */
export function buttonVariants(
  options: {
    variant?: ButtonVariant | undefined;
    size?: ButtonSize | undefined;
    class?: string | undefined;
  } = {},
) {
  const [sizeClass, sizeParts] = SIZES[options.size ?? "default"] as readonly [string, IParts?];
  const [variantClass, variantParts] = VARIANTS[options.variant ?? "default"] as readonly [
    string,
    IParts?,
  ];
  const parts: IParts = { ...PARTS, ...sizeParts, ...variantParts };
  if (overrides(options.class, "position")) delete parts.position;
  if (overrides(options.class, "shrink")) delete parts.shrink;
  return [BASE, ...Object.values(parts), sizeClass, variantClass, options.class]
    .filter(Boolean)
    .join(" ");
}

export function Button(
  props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & {
    class?: string | undefined;
    variant?: ButtonVariant;
    size?: ButtonSize;
  },
) {
  const rest = omit(props, "variant", "size", "class");
  return (
    <button
      type="button"
      data-slot="button"
      {...rest}
      class={buttonVariants({ variant: props.variant, size: props.size, class: props.class })}
    />
  );
}

const INLINE_TONES = {
  default: "text-foreground",
  muted: "text-muted-foreground hover:text-foreground",
  destructive: "text-destructive/80 hover:text-destructive",
  picker: "gap-1 text-foreground decoration-from-font underline-offset-4 data-popup-open:underline",
};

function inlineButtonVariants(
  options: {
    tone?: keyof typeof INLINE_TONES | undefined;
    touchTarget?: "padded" | undefined;
    class?: string | undefined;
  } = {},
) {
  const tone = options.tone ?? "default";
  return [
    "inline-flex shrink-0 cursor-pointer items-center font-medium [text-align:var(--inline-button-text-align,center)] [white-space:var(--inline-button-white-space,nowrap)] hover:underline focus-visible:outline-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-64",
    // The picker tone's own gap and offset replace these, as tailwind-merge would.
    tone === "picker" ? "" : "gap-0.5 underline-offset-2",
    options.touchTarget === "padded" ? "pointer-coarse:min-h-11 pointer-coarse:px-1.5" : "",
    INLINE_TONES[tone],
    options.class,
  ]
    .filter(Boolean)
    .join(" ");
}

export function InlineButton(
  props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & {
    class?: string | undefined;
    tone?: keyof typeof INLINE_TONES;
    touchTarget?: "padded";
  },
) {
  const rest = omit(props, "tone", "touchTarget", "class");
  return (
    <button
      type="button"
      data-slot="inline-button"
      {...rest}
      class={inlineButtonVariants({
        tone: props.tone,
        touchTarget: props.touchTarget,
        class: props.class,
      })}
    />
  );
}
