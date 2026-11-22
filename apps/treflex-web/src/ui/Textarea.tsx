import { type JSX, splitProps } from "solid-js";

import { overrides } from "./merge";

const CONTROL =
  "inline-flex rounded-lg border border-input bg-background not-dark:bg-clip-padding text-base text-foreground shadow-xs/5 ring-ring/24 transition-shadow before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-lg)-1px)] has-focus-visible:has-aria-invalid:border-destructive/64 has-focus-visible:has-aria-invalid:ring-destructive/16 has-aria-invalid:border-destructive/36 has-focus-visible:border-ring has-disabled:opacity-64 has-[:disabled,:focus-visible,[aria-invalid]]:shadow-none has-focus-visible:ring-[3px] has-focus-visible:ring-inset not-has-disabled:has-not-focus-visible:not-has-aria-invalid:before:shadow-[0_1px_--theme(--color-black/4%)] sm:text-sm dark:bg-input/32 dark:has-aria-invalid:ring-destructive/24 dark:not-has-disabled:has-not-focus-visible:not-has-aria-invalid:before:shadow-[0_-1px_--theme(--color-white/6%)]";

const TEXTAREA =
  "field-sizing-content max-h-64 w-full rounded-[inherit] outline-none wrap-anywhere";

// Each size carries its whole padding and minimum height rather than overriding the default's,
// since two utilities for one property resolve by Tailwind's order, not the class order.
const SIZES = {
  default: [
    "px-[calc(--spacing(3)-1px)] py-[calc(--spacing(1.5)-1px)]",
    "min-h-17.5 max-sm:min-h-20.5",
    1.5,
  ],
  sm: [
    "px-[calc(--spacing(2.5)-1px)] py-[calc(--spacing(1)-1px)]",
    "min-h-16.5 max-sm:min-h-19.5",
    1,
  ],
  lg: [
    "px-[calc(--spacing(3)-1px)] py-[calc(--spacing(2)-1px)]",
    "min-h-18.5 max-sm:min-h-21.5",
    2,
  ],
} satisfies Record<string, readonly [string, string, number]>;

type TextareaSize = keyof typeof SIZES;

function textareaControlClass(
  options: { unstyled?: boolean | undefined; class?: string | undefined } = {},
): string | undefined {
  const styled = options.unstyled !== true;
  return (
    [
      styled ? CONTROL : "",
      styled && !overrides(options.class, "position") ? "relative" : "",
      styled && !overrides(options.class, "width") ? "w-full" : "",
      options.class,
    ]
      .filter(Boolean)
      .join(" ") || undefined
  );
}

function textareaClass(size: TextareaSize | number | undefined, hasRows: boolean) {
  const [padding, minHeight] = SIZES[typeof size === "string" ? size : "default"];
  return [TEXTAREA, padding, hasRows ? "" : minHeight].filter(Boolean).join(" ");
}

export function Textarea(
  props: JSX.TextareaHTMLAttributes<HTMLTextAreaElement> & {
    size?: TextareaSize | number;
    unstyled?: boolean;
  },
) {
  const [local, rest] = splitProps(props, ["class", "size", "unstyled", "rows"]);
  const padding = () => SIZES[typeof local.size === "string" ? local.size : "default"][2];
  return (
    <span
      class={textareaControlClass({ unstyled: local.unstyled, class: local.class })}
      data-size={local.size ?? "default"}
      data-slot="textarea-control"
    >
      <textarea
        // field-sizing: content ignores `rows`, so an explicit row count sets the minimum height.
        style={
          local.rows === undefined
            ? undefined
            : {
                "min-height": `calc(${local.rows}lh + 2 * (var(--spacing) * ${padding()} - 1px))`,
              }
        }
        data-slot="textarea"
        rows={local.rows}
        {...rest}
        class={textareaClass(local.size, local.rows !== undefined)}
      />
    </span>
  );
}
