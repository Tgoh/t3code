// @effect-diagnostics globalTimers:off -- A view-only reset of the copied icon, outside any Effect runtime.
import { createSignal, Match, Switch } from "solid-js";

import { copyText } from "./clipboard";
import { Check, Copy, X } from "./icons";
import { Button } from "./ui/Button";
import { ANCHORED_COPY_TOAST_TIMEOUT_MS, showAnchoredCopyErrorToast } from "./ui/Toast";

/**
 * `icon-xs` is the code block's, which doesn't colour the check or disable while it shows, and
 * marks a failed copy with an X where a message's copy shows stock's anchored error toast.
 */
export function CopyButton(props: { text: string; label: string; size?: "xs" | "icon-xs" }) {
  const [outcome, setOutcome] = createSignal<"idle" | "copied" | "failed">("idle");
  const [button, setButton] = createSignal<HTMLButtonElement>();
  const codeBlock = () => props.size === "icon-xs";
  const copy = async () => {
    const copied = await copyText(props.text);
    if (!copied && !codeBlock()) {
      showAnchoredCopyErrorToast(button(), "Failed to copy text to the clipboard.");
      return;
    }
    setOutcome(copied ? "copied" : "failed");
    setTimeout(() => setOutcome("idle"), ANCHORED_COPY_TOAST_TIMEOUT_MS);
  };
  return (
    <Button
      ref={setButton}
      variant="ghost-muted"
      size={props.size ?? "xs"}
      aria-label={outcome() === "failed" ? "Couldn't copy" : props.label}
      data-tip={props.label}
      disabled={!codeBlock() && outcome() !== "idle"}
      onClick={() => void copy()}
    >
      <Switch fallback={<Copy class="size-3" />}>
        <Match when={outcome() === "copied"}>
          <Check class={codeBlock() ? "size-3" : "size-3 text-primary"} />
        </Match>
        <Match when={outcome() === "failed"}>
          <X class="size-3" />
        </Match>
      </Switch>
    </Button>
  );
}
