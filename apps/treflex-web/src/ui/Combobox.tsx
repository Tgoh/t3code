import { type JSX, splitProps } from "solid-js";

import { Search } from "../icons";

const SEARCH_LABEL = "block min-w-0 shrink-0 cursor-text px-3 pt-2.5";

const SEARCH_FRAME =
  "relative -translate-y-px border-b border-border/70 pb-1.5 transition-colors focus-within:border-ring";

const SEARCH_ICON =
  "pointer-events-none absolute top-1.5 left-0 size-4 shrink-0 text-muted-foreground/55";

const SEARCH_ROOT =
  "relative not-has-[>*.w-full]:w-fit w-full text-foreground has-disabled:opacity-64";

// Stock's unstyled small Input control merged with ComboboxInput's and ComboboxSearchInput's
// classes, as tailwind-merge leaves them.
const SEARCH_CONTROL =
  "has-disabled:opacity-100 rounded-none bg-transparent text-sm has-[+[data-slot=combobox-trigger],+[data-slot=combobox-clear]]:*:data-[slot=combobox-input]:pe-6.5 flex w-full [&_input]:h-6.5 [&_input]:ps-5 [&_input]:font-sans [&_input]:leading-6.5";

const SEARCH_FIELD =
  "w-full min-w-0 rounded-[inherit] outline-none placeholder:text-placeholder [transition:background-color_5000000s_ease-in-out_0s] h-7.5 px-[calc(--spacing(2.5)-1px)] leading-7.5 sm:h-6.5 sm:leading-6.5";

const EMPTY = "not-empty:p-2 text-center text-base text-muted-foreground sm:text-sm";

/**
 * A combobox's filter field over its list. The list keeps its highlight while focus stays here, so
 * pass the highlighted row's id as `aria-activedescendant`.
 */
export function ComboboxSearchInput(
  props: Omit<JSX.InputHTMLAttributes<HTMLInputElement>, "class" | "size">,
) {
  return (
    <label class={SEARCH_LABEL}>
      <div class={SEARCH_FRAME}>
        <Search aria-hidden="true" class={SEARCH_ICON} />
        <div class={SEARCH_ROOT}>
          <span class={SEARCH_CONTROL} data-size="sm" data-slot="input-control">
            <input
              role="combobox"
              aria-autocomplete="list"
              aria-expanded="true"
              autocomplete="off"
              spellcheck={false}
              {...props}
              class={SEARCH_FIELD}
              data-slot="combobox-input"
            />
          </span>
        </div>
      </div>
    </label>
  );
}

export function ComboboxEmpty(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <div
      {...rest}
      class={local.class === undefined ? EMPTY : `${EMPTY} ${local.class}`}
      data-slot="combobox-empty"
    />
  );
}
