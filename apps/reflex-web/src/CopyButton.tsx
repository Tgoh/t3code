// @effect-diagnostics globalTimers:off -- A view-only reset of the copied icon, outside any Effect runtime.
import { createSignal, Match, Switch } from "solid-js";

import { copyText } from "./clipboard";
import { Check, Copy, X } from "./icons";

const COPIED_MS = 1_200;

export function CopyButton(props: { text: string; label: string }) {
  const [outcome, setOutcome] = createSignal<"idle" | "copied" | "failed">("idle");
  const copy = async () => {
    setOutcome((await copyText(props.text)) ? "copied" : "failed");
    setTimeout(() => setOutcome("idle"), COPIED_MS);
  };
  return (
    <button
      type="button"
      class="icon-button small copy-button"
      classList={{ copied: outcome() === "copied" }}
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
    </button>
  );
}
