import type { JSX } from "@solidjs/web";
import { omit } from "solid-js";

import { overrides } from "./merge";

const CONTROL =
  "inline-flex border border-input bg-background not-dark:bg-clip-padding text-base text-foreground shadow-xs/5 ring-ring/24 transition-shadow before:pointer-events-none before:absolute before:inset-0 not-has-disabled:not-has-focus-visible:not-has-aria-invalid:before:shadow-[0_1px_--theme(--color-black/4%)] has-focus-visible:has-aria-invalid:border-destructive/64 has-focus-visible:has-aria-invalid:ring-destructive/16 has-aria-invalid:border-destructive/36 has-focus-visible:border-ring has-autofill:bg-foreground/4 has-disabled:opacity-64 has-[:disabled,:focus-visible,[aria-invalid]]:shadow-none has-focus-visible:ring-[3px] has-focus-visible:ring-inset sm:text-sm dark:bg-input/32 dark:has-autofill:bg-foreground/8 dark:has-aria-invalid:ring-destructive/24 dark:not-has-disabled:not-has-focus-visible:not-has-aria-invalid:before:shadow-[0_-1px_--theme(--color-white/6%)]";

const CONTROL_RADIUS = {
  default: "rounded-lg before:rounded-[calc(var(--radius-lg)-1px)]",
  compact: "rounded-md before:rounded-[calc(var(--radius-md)-1px)]",
};

const INPUT =
  "w-full min-w-0 rounded-[inherit] outline-none placeholder:text-placeholder [transition:background-color_5000000s_ease-in-out_0s]";

// Each size carries the whole height, padding and leading set rather than overriding the default's,
// since two utilities for one property resolve by Tailwind's order, not the class order.
const INPUT_SIZES = {
  default: "h-8.5 px-[calc(--spacing(3)-1px)] leading-8.5 sm:h-7.5 sm:leading-7.5",
  compact: "h-7 px-[calc(--spacing(2.5)-1px)] text-xs leading-7 sm:h-7 sm:leading-7",
  sm: "h-7.5 px-[calc(--spacing(2.5)-1px)] leading-7.5 sm:h-6.5 sm:leading-6.5",
  lg: "h-9.5 px-[calc(--spacing(3)-1px)] leading-9.5 sm:h-8.5 sm:leading-8.5",
};

const TYPES: Partial<Record<string, string>> = {
  search:
    "[&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none [&::-webkit-search-results-button]:appearance-none [&::-webkit-search-results-decoration]:appearance-none",
  number:
    "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
  file: "text-muted-foreground file:me-3 file:bg-transparent file:font-medium file:text-foreground file:text-sm",
};

type InputSize = keyof typeof INPUT_SIZES;

export type InputProps = Omit<JSX.InputHTMLAttributes<HTMLInputElement>, "size"> & {
  class?: string;
  size?: InputSize | number;
  font?: "default" | "mono";
  unstyled?: boolean;
};

function inputControlClass(
  options: {
    size?: InputSize | number | undefined;
    font?: "default" | "mono" | undefined;
    unstyled?: boolean | undefined;
    class?: string | undefined;
  } = {},
): string | undefined {
  const styled = options.unstyled !== true;
  return (
    [
      styled ? CONTROL : "",
      styled && !overrides(options.class, "position") ? "relative" : "",
      styled && !overrides(options.class, "width") ? "w-full" : "",
      styled ? CONTROL_RADIUS[options.size === "compact" ? "compact" : "default"] : "",
      options.font === "mono" ? "font-mono tabular-nums" : "",
      options.class,
    ]
      .filter(Boolean)
      .join(" ") || undefined
  );
}

function inputClass(size: InputSize | number | undefined, type: string | undefined) {
  const named = typeof size === "string" ? size : "default";
  return [INPUT, INPUT_SIZES[named], type === undefined ? undefined : TYPES[type]]
    .filter(Boolean)
    .join(" ");
}

export function Input(props: InputProps) {
  const rest = omit(props, "class", "size", "font", "unstyled");
  return (
    <span
      class={inputControlClass({
        size: props.size,
        font: props.font,
        unstyled: props.unstyled,
        class: props.class,
      })}
      data-size={props.size ?? "default"}
      data-slot="input-control"
    >
      <input
        data-slot="input"
        size={typeof props.size === "number" ? props.size : undefined}
        {...rest}
        class={inputClass(props.size, typeof rest.type === "string" ? rest.type : undefined)}
      />
    </span>
  );
}
