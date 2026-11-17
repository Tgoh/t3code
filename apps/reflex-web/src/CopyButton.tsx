// @effect-diagnostics globalTimers:off -- A view-only reset of the copied icon, outside any Effect runtime.
import { createSignal, Match, Switch } from "solid-js";

import { copyText } from "./clipboard";
import { Check, Copy, X } from "./icons";
import { IconButton } from "./ui/IconButton";

const COPIED_MS = 1_200;

/** `xs` is the code block's, which doesn't colour the check. */
export function CopyButton(props: { text: string; label: string; size?: "sm" | "xs" }) {
  const [outcome, setOutcome] = createSignal<"idle" | "copied" | "failed">("idle");
  const copy = async () => {
    setOutcome((await copyText(props.text)) ? "copied" : "failed");
    setTimeout(() => setOutcome("idle"), COPIED_MS);
  };
  return (
    <IconButton
      variant="muted"
      size={props.size ?? "sm"}
      class={props.size === "xs" ? undefined : "data-copied:text-primary"}
      data-copied={outcome() === "copied" ? "" : undefined}
      aria-label={outcome() === "failed" ? "Couldn't copy" : props.label}
      data-tip={props.label}
      disabled={outcome() !== "idle"}
      onClick={() => void copy()}
    >
      <Switch fallback={<Copy />}>
        <Match when={outcome() === "copied"}>
          <Check />
        </Match>
        <Match when={outcome() === "failed"}>
          <X />
        </Match>
      </Switch>
    </IconButton>
  );
}
