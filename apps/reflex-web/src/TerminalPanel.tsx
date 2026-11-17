import { useResource } from "treflex-solid";
import { createEffect, createSignal, onCleanup, Show, untrack } from "solid-js";

import { Trash2, X } from "./icons";
import ThreadSession from "./ThreadSession";
import { IconButton } from "./ui/IconButton";
import { ERROR_NOTE } from "./ui/notes";

const RECONNECTING = new Set(["connecting", "backoff", "offline", "blocked"]);

// ThreadView sets .panel-sheet on narrow screens and .panel-motion once the thread has mounted,
// so a drawer already open on a thread switch doesn't slide in again.
const DRAWER = [
  "relative flex min-h-0 flex-[0_0_280px] flex-col border-t border-border bg-(--terminal-background)",
  "in-[.panel-sheet]:absolute in-[.panel-sheet]:inset-x-0 in-[.panel-sheet]:bottom-0 in-[.panel-sheet]:z-56 in-[.panel-sheet]:h-[min(60%,420px)] in-[.panel-sheet]:overflow-hidden in-[.panel-sheet]:rounded-t-[12px] in-[.panel-sheet]:pb-(--safe-bottom) in-[.panel-sheet]:shadow-[0_-8px_24px_rgb(0_0_0/12%)]",
  "in-[.panel-motion]:motion-safe:transition-[translate,opacity] in-[.panel-motion]:motion-safe:duration-200 in-[.panel-motion]:motion-safe:ease-in-out starting:in-[.panel-sheet]:translate-y-full starting:not-in-[.panel-sheet]:translate-y-2 starting:not-in-[.panel-sheet]:opacity-0",
].join(" ");

export function TerminalPanel() {
  const session = ThreadSession.use();
  const panel = () => session.state.Terminal;
  const live = useResource(() => session.state, "Terminal/Session");
  const state = () => {
    const status = live.status();
    if (status.State === "ended") return "error";
    if (status.State === "live" && RECONNECTING.has(status.Detail ?? "")) return "reconnecting";
    return session.terminalAttachment().Status ?? "starting";
  };
  const error = () => {
    const status = live.status();
    return panel().Error ?? (status.State === "ended" ? status.Reason : undefined);
  };
  const [host, setHost] = createSignal<HTMLDivElement>();
  createEffect(() => {
    const view = live.value();
    const element = host();
    if (view === undefined || element === undefined) return;
    onCleanup(
      view.mount(
        element,
        untrack(() => session.terminalAttachment().FocusOnMount),
      ),
    );
  });
  return (
    <aside class={DRAWER} data-terminal-drawer>
      <div class="absolute top-1 right-3.5 z-2 flex items-center gap-0.5 rounded-lg bg-(--terminal-background)">
        <Show when={state() !== "running"}>
          <span class="mr-1.5 text-[12px] text-muted-foreground">{state()}</span>
        </Show>
        <IconButton
          size="sm"
          aria-label="End shell"
          data-tip="End shell"
          disabled={session.ending()}
          onClick={() => session.endTerminal()}
        >
          <Trash2 />
        </IconButton>
        <IconButton
          size="sm"
          aria-label="Hide terminal"
          data-tip="Hide terminal"
          onClick={() => session.closeTerminal()}
        >
          <X />
        </IconButton>
      </div>
      <Show when={error()}>
        <p class={`${ERROR_NOTE} flex-none py-1`}>{error()}</p>
      </Show>
      <div
        class="terminal-host min-h-0 flex-1 overflow-hidden bg-(--terminal-background)"
        ref={setHost}
      />
    </aside>
  );
}
