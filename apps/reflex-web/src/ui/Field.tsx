import { type JSX, splitProps } from "solid-js";

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

export function Textarea(props: JSX.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const [local, rest] = splitProps(props, ["class"]);
  return <textarea {...rest} class={join(`${FIELD} h-[72px] resize-y px-2 py-1.5`, local.class)} />;
}
