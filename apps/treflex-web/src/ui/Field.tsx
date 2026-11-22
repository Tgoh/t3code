import { type JSX, splitProps } from "solid-js";

import { ChevronDown } from "../icons";

const FIELD = "rounded-lg border border-input bg-popover text-[14px] text-foreground";
const LINE = `${FIELD} h-8 px-2 py-0`;

const join = (look: string, extra: string | undefined) => (extra ? `${look} ${extra}` : look);

/** Width is the caller's: settings rows use `min-w-44`. */
export function Input(props: JSX.InputHTMLAttributes<HTMLInputElement>) {
  const [local, rest] = splitProps(props, ["class"]);
  return <input {...rest} class={join(LINE, local.class)} />;
}

export function Select(props: JSX.SelectHTMLAttributes<HTMLSelectElement>) {
  const [local, rest] = splitProps(props, ["class"]);
  return <select {...rest} class={join(LINE, local.class)} />;
}

/**
 * A select whose chosen label wraps below `md`, where a long label is wider than the row: a native
 * select can't wrap, so there it turns invisible over a copy of the label and still takes the tap.
 */
export function WrapSelect(props: JSX.SelectHTMLAttributes<HTMLSelectElement> & { label: string }) {
  const [local, rest] = splitProps(props, ["class", "label"]);
  return (
    <span class="group grid max-md:w-full">
      <select
        {...rest}
        class={join(
          `${LINE} [grid-area:1/1] max-md:h-auto max-md:w-full max-md:min-w-0 max-md:opacity-0`,
          local.class,
        )}
      />
      <span
        aria-hidden="true"
        class={`${FIELD} pointer-events-none hidden items-center gap-2 px-2 py-1 [grid-area:1/1] group-has-[:focus-visible]:outline-2 group-has-[:focus-visible]:outline-ring max-md:flex max-sm:text-[16px]`}
      >
        <span class="min-w-0 flex-1">{local.label}</span>
        <ChevronDown class="size-4 flex-none opacity-60" />
      </span>
    </span>
  );
}

export function Textarea(props: JSX.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const [local, rest] = splitProps(props, ["class"]);
  return <textarea {...rest} class={join(`${FIELD} h-[72px] resize-y px-2 py-1.5`, local.class)} />;
}
