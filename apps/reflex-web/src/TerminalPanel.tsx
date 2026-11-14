import { useResource } from "treflex-solid";
import { createEffect, createSignal, onCleanup, Show, untrack } from "solid-js";

import { Trash2, X } from "./icons";
import ThreadSession from "./ThreadSession";

const RECONNECTING = new Set(["connecting", "backoff", "offline", "blocked"]);

export function TerminalPanel() {
  const session = ThreadSession.use();
  const panel = () => session.state.Terminal;
  const live = useResource(() => session.state, "Terminal/Session");
  const state = () => {
    const status = live.status();
    if (status.State === "live" && RECONNECTING.has(status.Detail ?? "")) return "reconnecting";
    return panel().Status ?? "starting";
  };
  const [host, setHost] = createSignal<HTMLDivElement>();
  createEffect(() => {
    const view = live.value();
    const element = host();
    if (view === undefined || element === undefined) return;
    onCleanup(
      view.mount(
        element,
        untrack(() => panel().FocusOnMount),
      ),
    );
  });
  return (
    <aside class="terminal-drawer">
      <div class="terminal-controls">
        <Show when={state() !== "running"}>
          <span class="terminal-state">{state()}</span>
        </Show>
        <button
          class="icon-button small"
          aria-label="End shell"
          data-tip="End shell"
          disabled={session.ending()}
          onClick={() => session.endTerminal()}
        >
          <Trash2 />
        </button>
        <button
          class="icon-button small"
          aria-label="Hide terminal"
          data-tip="Hide terminal"
          onClick={() => session.closeTerminal()}
        >
          <X />
        </button>
      </div>
      <Show when={panel().Error}>
        <p class="composer-error terminal-error">{panel().Error}</p>
      </Show>
      <div class="terminal-host" ref={setHost} />
    </aside>
  );
}
