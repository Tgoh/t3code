// @effect-diagnostics globalTimers:off -- A view-only reset of the copied icon, outside any Effect runtime.
import { createSignal, Match, Switch } from "solid-js";

import { copyText } from "./clipboard";
import { Check, Copy, X } from "./icons";
import { Button } from "./ui/Button";

const COPIED_MS = 1_200;

/** `icon-xs` is the code block's, which doesn't colour the check or disable while it shows. */
export function CopyButton(props: { text: string; label: string; size?: "xs" | "icon-xs" }) {
  const [outcome, setOutcome] = createSignal<"idle" | "copied" | "failed">("idle");
  const copy = async () => {
    setOutcome((await copyText(props.text)) ? "copied" : "failed");
    setTimeout(() => setOutcome("idle"), COPIED_MS);
  };
  return (
    <Button
      variant="ghost-muted"
      size={props.size ?? "xs"}
      aria-label={outcome() === "failed" ? "Couldn't copy" : props.label}
      data-tip={props.label}
      disabled={props.size !== "icon-xs" && outcome() !== "idle"}
      onClick={() => void copy()}
    >
      <Switch fallback={<Copy class="size-3" />}>
        <Match when={outcome() === "copied"}>
          <Check class={props.size === "icon-xs" ? "size-3" : "size-3 text-primary"} />
        </Match>
        <Match when={outcome() === "failed"}>
          <X class="size-3" />
        </Match>
      </Switch>
    </Button>
  );
}
