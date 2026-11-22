import { useInFlight, useResource } from "treflex-solid";
import { createEffect, createSignal, onCleanup, Show, untrack } from "solid-js";

import { Trash2, X } from "./icons";
import Terminal, { endTerminal } from "./Terminal";
import { Button } from "./ui/Button";
import { ERROR_TEXT } from "./ui/notice";
import { enterPanel } from "./viewport";

const RECONNECTING = new Set(["connecting", "backoff", "offline", "blocked"]);

// ThreadView sets .panel-sheet on narrow screens.
const DRAWER = [
  "relative flex min-h-0 flex-[0_0_280px] flex-col border-t border-border bg-(--terminal-background)",
  "in-[.panel-sheet]:absolute in-[.panel-sheet]:inset-x-0 in-[.panel-sheet]:bottom-0 in-[.panel-sheet]:z-56 in-[.panel-sheet]:h-[min(60%,420px)] in-[.panel-sheet]:overflow-hidden in-[.panel-sheet]:rounded-t-[12px] in-[.panel-sheet]:pb-(--safe-bottom) in-[.panel-sheet]:shadow-[0_-8px_24px_rgb(0_0_0/12%)]",
  "transition-[translate,opacity] duration-200 ease-in-out data-entering:in-[.panel-sheet]:translate-y-full data-entering:not-in-[.panel-sheet]:translate-y-2 data-entering:not-in-[.panel-sheet]:opacity-0",
].join(" ");

export const TerminalPanel = Terminal.provider(() => {
  const terminal = Terminal.use();
  const live = useResource(() => terminal.state, "Terminal/Session");
  const ending = useInFlight(endTerminal, () => terminal.state);
  const state = () => {
    const status = live.status();
    if (status.State === "ended") return "error";
    if (status.State === "live" && RECONNECTING.has(status.Detail ?? "")) return "reconnecting";
    return terminal.state.Status ?? "starting";
  };
  const error = () => {
    const status = live.status();
    return terminal.state.Error ?? (status.State === "ended" ? status.Reason : undefined);
  };
  const [host, setHost] = createSignal<HTMLDivElement>();
  createEffect(() => {
    const view = live.value();
    const element = host();
    if (view === undefined || element === undefined) return;
    onCleanup(
      view.mount(
        element,
        untrack(() => terminal.state.FocusOnMount),
      ),
    );
  });
  return (
    <aside ref={enterPanel} class={DRAWER} data-terminal-drawer>
      <div class="absolute top-1 right-3.5 z-2 flex items-center gap-0.5 rounded-lg bg-(--terminal-background)">
        <Show when={state() !== "running"}>
          <span class="mr-1.5 text-[12px] text-muted-foreground">{state()}</span>
        </Show>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="End shell"
          data-tip="End shell"
          disabled={ending()}
          onClick={() => terminal.endTerminal()}
        >
          <Trash2 />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Hide terminal"
          data-tip="Hide terminal"
          onClick={() => terminal.closeTerminal()}
        >
          <X />
        </Button>
      </div>
      <Show when={error()}>
        <p class={`${ERROR_TEXT} flex-none py-1`}>{error()}</p>
      </Show>
      <div
        class="terminal-host min-h-0 flex-1 overflow-hidden bg-(--terminal-background)"
        ref={setHost}
      />
    </aside>
  );
});
