import type { JSX } from "@solidjs/web";
import { omit } from "solid-js";

const ROOT =
  "inline-flex h-[calc(var(--thumb-size)+2px)] w-[calc(var(--thumb-size)*2-2px)] shrink-0 cursor-pointer items-center rounded-full p-[2px] outline-none transition-[background-color,box-shadow] duration-200 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background data-checked:bg-primary data-unchecked:bg-input data-disabled:cursor-not-allowed data-disabled:opacity-64 data-[mixed]:bg-input";
const SIZES = {
  default: "[--thumb-size:--spacing(5)] sm:[--thumb-size:--spacing(4)]",
  sm: "[--thumb-size:--spacing(4)] sm:[--thumb-size:--spacing(3.5)]",
};

const THUMB =
  "pointer-events-none block size-[calc(var(--thumb-size)-2px)] shrink-0 origin-left in-[[role=switch]:active,[data-slot=label]:active,[data-slot=field-label]:active]:not-data-disabled:scale-x-110 in-[[role=switch]:active,[data-slot=label]:active,[data-slot=field-label]:active]:rounded-[var(--thumb-size)/calc(var(--thumb-size)*1.1)] rounded-(--thumb-size) bg-background shadow-sm/5 dark:data-unchecked:bg-muted-foreground [transition:translate_.15s,border-radius_.15s,scale_.1s_.1s,transform-origin_.15s] data-checked:origin-right";
// Stands in for tailwind-merge: mixed centres the thumb in place of the checked offset.
const THUMB_OFFSET = {
  default: "data-checked:translate-x-[calc(var(--thumb-size)-4px)]",
  mixed:
    "translate-x-[calc((var(--thumb-size)-4px)/2)] opacity-70 data-checked:translate-x-[calc((var(--thumb-size)-4px)/2)]",
};

const flag = (on: boolean | "" | undefined) => (on === true ? "" : undefined);

export function Switch(
  props: Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> & {
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
    size?: keyof typeof SIZES;
    mixed?: boolean;
  },
) {
  const rest = omit(props, "checked", "onCheckedChange", "size", "mixed", "class", "disabled");
  return (
    <button
      type="button"
      role="switch"
      data-slot="switch"
      {...rest}
      data-checked={flag(props.checked)}
      data-unchecked={flag(!props.checked)}
      data-disabled={flag(props.disabled)}
      data-size={props.size ?? "default"}
      data-mixed={flag(props.mixed)}
      aria-checked={props.mixed === true ? "mixed" : props.checked ? "true" : "false"}
      disabled={props.disabled}
      class={[ROOT, SIZES[props.size ?? "default"], props.class].filter(Boolean).join(" ")}
      onClick={() => props.onCheckedChange(!props.checked)}
    >
      <span
        class={`${THUMB} ${THUMB_OFFSET[props.mixed === true ? "mixed" : "default"]}`}
        data-slot="switch-thumb"
        data-checked={flag(props.checked)}
        data-unchecked={flag(!props.checked)}
        data-disabled={flag(props.disabled)}
      />
    </button>
  );
}
