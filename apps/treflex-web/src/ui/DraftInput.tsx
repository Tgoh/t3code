import { createSignal, splitProps } from "solid-js";

import { Input, type InputProps } from "./Input";

/** Holds the typed text as a draft and commits it on blur or Enter, if it changed. */
export function DraftInput(
  props: Omit<InputProps, "value" | "onInput" | "onFocus" | "onBlur" | "onKeyDown"> & {
    value: string;
    onCommit: (next: string) => void;
  },
) {
  const [local, rest] = splitProps(props, ["value", "onCommit"]);
  const [draft, setDraft] = createSignal<{ Text: string; OnFocus: string } | null>(null);
  return (
    <Input
      {...rest}
      value={draft()?.Text ?? local.value}
      onInput={(event) => {
        const text = event.currentTarget.value;
        setDraft((current) => ({ Text: text, OnFocus: current?.OnFocus ?? local.value }));
      }}
      onFocus={() => setDraft({ Text: local.value, OnFocus: local.value })}
      onBlur={() => {
        const held = draft();
        setDraft(null);
        if (held !== null && held.Text !== held.OnFocus && held.Text !== local.value) {
          local.onCommit(held.Text);
        }
      }}
      onKeyDown={(event) => {
        if (event.isComposing || event.keyCode === 229) return;
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
    />
  );
}
