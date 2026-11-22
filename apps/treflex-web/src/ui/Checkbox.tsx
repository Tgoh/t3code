import { type JSX, Show, splitProps } from "solid-js";

// Stands in for tailwind-merge: a variant's border colour replaces the default one.
const ROOT =
  "relative inline-flex size-4.5 shrink-0 items-center justify-center rounded-[.25rem] border bg-background not-dark:bg-clip-padding shadow-xs/5 outline-none transition-shadow before:pointer-events-none before:absolute before:inset-0 before:rounded-[3px] not-data-disabled:not-data-checked:not-aria-invalid:before:shadow-[0_1px_--theme(--color-black/4%)] focus-visible:outline-2 focus-visible:outline-solid focus-visible:-outline-offset-2 focus-visible:outline-ring aria-invalid:border-destructive/36 focus-visible:aria-invalid:border-destructive/64 focus-visible:aria-invalid:outline-destructive/48 data-disabled:opacity-64 sm:size-4 dark:not-data-checked:bg-input/32 dark:focus-visible:aria-invalid:outline-destructive/24 dark:not-data-disabled:not-data-checked:not-aria-invalid:before:shadow-[0_-1px_--theme(--color-white/6%)] [[data-disabled],[data-checked],[aria-invalid]]:shadow-none";
const VARIANTS = {
  default: "border-input",
  contrast: "border-foreground/55",
};

const INDICATOR =
  "-inset-px absolute flex items-center justify-center rounded-[.25rem] text-primary-foreground data-unchecked:hidden data-checked:bg-primary data-indeterminate:text-foreground in-[[data-slot=checkbox]:focus-visible]:inset-shadow-[0_0_0_3px_var(--background)] in-[[data-slot=checkbox]:focus-visible]:outline-2 in-[[data-slot=checkbox]:focus-visible]:outline-solid in-[[data-slot=checkbox]:focus-visible]:-outline-offset-2 in-[[data-slot=checkbox]:focus-visible]:outline-inherit";

type ICheckboxVariant = keyof typeof VARIANTS;

const flag = (on: boolean | undefined) => (on === true ? "" : undefined);

function Glyph(props: { path: string }) {
  return (
    <svg
      class="size-3.5 text-current sm:size-3"
      fill="none"
      height="24"
      stroke="currentColor"
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width="3"
      viewBox="0 0 24 24"
      width="24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d={props.path} />
    </svg>
  );
}

const CHECK = "M5.252 12.7 10.2 18.63 18.748 5.37";
const DASH = "M5.252 12h13.496";

export function Checkbox(
  props: Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> & {
    checked: boolean;
    indeterminate?: boolean;
    onCheckedChange: (checked: boolean) => void;
    variant?: ICheckboxVariant;
  },
) {
  const [local, rest] = splitProps(props, [
    "checked",
    "indeterminate",
    "onCheckedChange",
    "variant",
    "class",
    "disabled",
  ]);
  const mixed = () => local.indeterminate === true;
  return (
    <button
      type="button"
      role="checkbox"
      data-slot="checkbox"
      {...rest}
      aria-checked={mixed() ? "mixed" : local.checked}
      data-checked={flag(!mixed() && local.checked)}
      data-unchecked={flag(!mixed() && !local.checked)}
      data-indeterminate={flag(mixed())}
      data-disabled={flag(local.disabled)}
      disabled={local.disabled}
      class={[ROOT, VARIANTS[local.variant ?? "default"], local.class].filter(Boolean).join(" ")}
      onClick={() => local.onCheckedChange(!local.checked)}
      onKeyDown={(event) => {
        // Checkboxes toggle with Space only.
        if (event.key === "Enter") event.preventDefault();
      }}
    >
      <Show when={mixed() || local.checked}>
        <span
          class={INDICATOR}
          data-slot="checkbox-indicator"
          data-checked={flag(!mixed() && local.checked)}
          data-indeterminate={flag(mixed())}
          data-disabled={flag(local.disabled)}
        >
          <Glyph path={mixed() ? DASH : CHECK} />
        </span>
      </Show>
    </button>
  );
}

/** Checkbox's look without its control, for a row that is itself the button. */
export function CheckboxMark(props: { checked: boolean; variant?: ICheckboxVariant }) {
  return (
    <span
      aria-hidden="true"
      class={`${ROOT} ${VARIANTS[props.variant ?? "default"]}`}
      data-slot="checkbox"
      data-checked={flag(props.checked)}
      data-unchecked={flag(!props.checked)}
    >
      <span
        class={INDICATOR}
        data-slot="checkbox-indicator"
        data-checked={flag(props.checked)}
        data-unchecked={flag(!props.checked)}
      >
        <Glyph path={CHECK} />
      </span>
    </span>
  );
}
