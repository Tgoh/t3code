import { useResource } from "treflex-solid";
import { createEffect, createSignal, onCleanup, Show, untrack } from "solid-js";

import { Trash2, X } from "./icons";
import ThreadSession from "./ThreadSession";
import { IconButton } from "./ui/IconButton";
import { ERROR_TEXT } from "./ui/notice";

const RECONNECTING = new Set(["connecting", "backoff", "offline", "blocked"]);

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
    <aside class="terminal-drawer">
      <div class="terminal-controls">
        <Show when={state() !== "running"}>
          <span class="terminal-state">{state()}</span>
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
        <p class={`${ERROR_TEXT} terminal-error`}>{error()}</p>
      </Show>
      <div class="terminal-host" ref={setHost} />
    </aside>
  );
}
