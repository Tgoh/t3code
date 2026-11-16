import { createSignal, For, type JSX, onCleanup, Show } from "solid-js";

import {
  FileDiff,
  Files,
  GitPullRequest,
  Globe,
  Link,
  MessagesSquare,
  Smartphone,
  SquareTerminal,
  X,
} from "./icons";
import { type ISurfaceAction, type ISurfaceKind, shortcutAction } from "./surfaces";

const ICONS: Record<ISurfaceKind, () => JSX.Element> = {
  browser: () => <Globe />,
  terminal: () => <SquareTerminal />,
  files: () => <Files />,
  diff: () => <FileDiff />,
  pullRequest: () => <GitPullRequest />,
  pullRequests: () => <Link />,
  device: () => <Smartphone />,
  sideChat: () => <MessagesSquare />,
};

export function SurfaceLauncher(props: {
  actions: ISurfaceAction[];
  onRun: (kind: ISurfaceKind) => void;
  onClose: () => void;
}) {
  const available = () => props.actions.filter((action) => action.Unavailable === null);
  const [highlight, setHighlight] = createSignal(-1);
  const onShortcut = (event: KeyboardEvent) => {
    if (document.querySelector("dialog[open], .thread-menu")) return;
    const target = event.composedPath()[0] ?? event.target;
    const action = shortcutAction(props.actions, event, target instanceof Element ? target : null);
    if (action === null) return;
    event.preventDefault();
    event.stopPropagation();
    props.onRun(action.Kind);
  };
  window.addEventListener("keydown", onShortcut, true);
  onCleanup(() => window.removeEventListener("keydown", onShortcut, true));
  const onKeyDown = (event: KeyboardEvent) => {
    const count = available().length;
    if (count === 0 || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault();
      setHighlight((held) => (held + 1) % count);
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault();
      setHighlight((held) => (held === -1 ? count - 1 : (held - 1 + count) % count));
    } else if (event.key === "Enter" && event.target === event.currentTarget) {
      const action = available()[highlight()];
      if (action === undefined) return;
      event.preventDefault();
      props.onRun(action.Kind);
    }
  };
  return (
    <aside class="right-panel">
      <header class="panel-header">
        <span class="composer-spacer" />
        <button
          class="icon-button"
          aria-label="Close panel"
          data-tip="Close panel"
          onClick={props.onClose}
        >
          <X />
        </button>
      </header>
      <div class="surface-launcher" tabIndex={0} aria-label="Open a surface" onKeyDown={onKeyDown}>
        <div class="surface-launcher-body">
          <h3>Open a surface</h3>
          <div class="surface-list">
            <For each={props.actions}>
              {(action) => (
                <Show
                  when={action.Unavailable === null}
                  fallback={
                    <div
                      class="surface-item"
                      tabIndex={0}
                      aria-disabled="true"
                      data-tip={action.Unavailable ?? undefined}
                    >
                      {ICONS[action.Kind]()}
                      <span class="surface-label">{action.Label}</span>
                      <kbd>{action.Shortcut}</kbd>
                    </div>
                  }
                >
                  <button
                    class="surface-item"
                    classList={{ highlighted: available()[highlight()] === action }}
                    onMouseEnter={() => setHighlight(available().indexOf(action))}
                    onClick={() => props.onRun(action.Kind)}
                  >
                    {ICONS[action.Kind]()}
                    <span class="surface-label">{action.Label}</span>
                    <kbd>{action.Shortcut}</kbd>
                  </button>
                </Show>
              )}
            </For>
          </div>
        </div>
      </div>
    </aside>
  );
}
