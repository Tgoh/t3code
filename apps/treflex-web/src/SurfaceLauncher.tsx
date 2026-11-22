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
} from "./icons";
import { arrowStep, stepHighlight } from "./listNavigation";
import { useNavigation } from "./navigation";
import { PanelHeader } from "./RightPanel";
import { type ISurfaceAction, type ISurfaceKind, shortcutAction } from "./surfaces";

const ITEM =
  "flex h-8 w-full cursor-pointer items-center gap-2.5 rounded-lg border-0 bg-transparent px-2.5 py-0 text-left text-[14px] text-foreground hover:not-aria-disabled:bg-[color-mix(in_srgb,var(--accent)_60%,transparent)] data-highlighted:bg-[color-mix(in_srgb,var(--accent)_60%,transparent)] aria-disabled:cursor-default aria-disabled:opacity-50 [&_svg]:size-4 [&_svg]:flex-none";

function ItemContent(props: { action: ISurfaceAction }) {
  return (
    <>
      {ICONS[props.action.Kind]()}
      <span class="min-w-0 flex-1 truncate">{props.action.Label}</span>
      <kbd class="rounded-sm border border-border bg-muted px-1 py-0 font-[family-name:inherit] text-[11px] leading-4 text-muted-foreground">
        {props.action.Shortcut}
      </kbd>
    </>
  );
}

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
  onCleanup(
    useNavigation().takeLetters((event) => {
      const target = event.composedPath()[0] ?? event.target;
      const action = shortcutAction(
        props.actions,
        event,
        target instanceof Element ? target : null,
      );
      if (action === null) return false;
      props.onRun(action.Kind);
      return true;
    }),
  );
  const onKeyDown = (event: KeyboardEvent) => {
    const count = available().length;
    if (count === 0 || event.metaKey || event.ctrlKey || event.altKey) return;
    const step = arrowStep(event.key, true);
    if (step !== null) {
      event.preventDefault();
      setHighlight((held) => stepHighlight(held, count, step)!);
    } else if (event.key === "Enter" && event.target === event.currentTarget) {
      const action = available()[highlight()];
      if (action === undefined) return;
      event.preventDefault();
      props.onRun(action.Kind);
    }
  };
  return (
    <>
      <PanelHeader closeLabel="Close panel" onClose={props.onClose} />
      <div
        class="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-6 pt-0 pb-(--workspace-topbar-height) outline-none"
        tabIndex={0}
        aria-label="Open a surface"
        onKeyDown={onKeyDown}
      >
        <div class="w-full max-w-80 py-6">
          <h3 class="mx-0 mt-0 mb-3 text-center text-[14px] font-medium">Open a surface</h3>
          <div class="flex flex-col gap-0.5">
            <For each={props.actions}>
              {(action) => (
                <Show
                  when={action.Unavailable === null}
                  fallback={
                    <div
                      class={ITEM}
                      tabIndex={0}
                      aria-disabled="true"
                      data-tip={action.Unavailable ?? undefined}
                    >
                      <ItemContent action={action} />
                    </div>
                  }
                >
                  <button
                    class={ITEM}
                    data-highlighted={available()[highlight()] === action ? "" : undefined}
                    onMouseEnter={() => setHighlight(available().indexOf(action))}
                    onClick={() => props.onRun(action.Kind)}
                  >
                    <ItemContent action={action} />
                  </button>
                </Show>
              )}
            </For>
          </div>
        </div>
      </div>
    </>
  );
}
