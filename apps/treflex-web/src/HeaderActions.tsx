import { createMemo, createSignal, For, Show, untrack } from "solid-js";

import Environment from "./Environment";
import { ChartNoAxesColumn, Ellipsis } from "./icons";
import {
  type ILimitTone,
  limitPools,
  limitPresentations,
  weeklyLimit,
  weeklyLimitTip,
} from "./limits";
import { useSidebarSheet } from "./viewport";
import { clockNow } from "./timestamps";
import { Button } from "./ui/Button";
import { MenuCheckboxItem, MenuPopup, MenuShortcut, openMenuFromKeys } from "./ui/Menu";
import { PopoverPopup } from "./ui/Popover";
import { Presence } from "./ui/Presence";
import { LimitsSummary } from "./UsageView";

const TONE: Record<ILimitTone, string> = {
  normal: "text-foreground",
  warning: "text-warning",
  danger: "text-destructive",
};

/** Claude's overall weekly limit as a ring of what's left, opening every limit's figures. */
export function UsageRing() {
  const environment = Environment.use();
  const sidebar = useSidebarSheet();
  const presentations = () =>
    limitPresentations(
      environment.state.EnvironmentId,
      environment.state.Label,
      environment.state.Replica.Config,
    );
  const weekly = createMemo(() => weeklyLimit(limitPools(presentations(), environment.minute())), {
    equals: (left, right) => left?.UsedPercent === right?.UsedPercent && left?.Tone === right?.Tone,
  });
  const label = () => {
    const held = weekly();
    return held === null
      ? "Weekly limit not reported"
      : `Weekly limit: ${held.RemainingPercent}% left`;
  };
  // The reset countdown is read when the tip shows, since the minute clock would leave it stale.
  const freshTip = (event: Event) => {
    const now = clockNow();
    (event.currentTarget as HTMLElement).dataset.tip = weeklyLimitTip(
      limitPools(presentations(), now),
      now,
    );
  };
  const [button, setButton] = createSignal<HTMLButtonElement>();
  const [open, setOpen] = createSignal<number | null>(null);
  return (
    <>
      <Button
        variant="ghost"
        size="icon-titlebar"
        ref={(element: HTMLButtonElement) => {
          setButton(element);
          element.addEventListener("pointerover", freshTip);
          element.addEventListener("focusin", freshTip);
        }}
        aria-label={label()}
        aria-haspopup="dialog"
        aria-expanded="false"
        data-tip={label()}
        onClick={() => {
          if (open() !== null) return setOpen(null);
          setOpen(clockNow());
          void environment.autoRefreshLimits();
        }}
      >
        <svg viewBox="0 0 16 16" class={`size-4 -rotate-90 ${TONE[weekly()?.Tone ?? "normal"]}`}>
          <circle
            cx="8"
            cy="8"
            r="6"
            fill="none"
            stroke="var(--foreground)"
            stroke-width="2"
            opacity="0.22"
          />
          <Show when={weekly()}>
            {(held) => (
              <circle
                cx="8"
                cy="8"
                r="6"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                pathLength="100"
                stroke-dasharray={`${held().RemainingPercent} 100`}
                stroke-dashoffset={-held().UsedPercent}
              />
            )}
          </Show>
        </svg>
      </Button>
      <Presence when={open() !== null && button()}>
        {(anchor) => {
          // Read once, so the popover keeps its figures while it fades out.
          const now = untrack(open) ?? 0;
          return (
            <PopoverPopup
              label="Usage limits"
              anchor={anchor()}
              align="end"
              width="sm"
              padding="compact"
              onClose={() => setOpen(null)}
            >
              <div class="flex flex-col gap-3">
                <LimitsSummary pools={limitPools(presentations(), now)} now={now} />
                <Button
                  variant="outline"
                  size="sm"
                  class="w-full"
                  onClick={() => {
                    setOpen(null);
                    sidebar.setOpen(false);
                    void environment.openView({ Kind: "usage" });
                  }}
                >
                  <ChartNoAxesColumn />
                  Open usage
                </Button>
              </div>
            </PopoverPopup>
          );
        }}
      </Presence>
    </>
  );
}

export interface IThreadMenuItem {
  Label: string;
  On: boolean;
  Shortcut: string | null;
  Run: () => void;
}

/** The thread's panel toggles, behind one "⋯" button. */
export function ThreadMenu(props: {
  items: readonly IThreadMenuItem[];
  ref: (button: HTMLButtonElement) => void;
}) {
  const [button, setButton] = createSignal<HTMLButtonElement>();
  const [open, setOpen] = createSignal(false);
  return (
    <>
      <Button
        variant="ghost"
        size="icon-titlebar"
        ref={(element) => {
          setButton(element);
          props.ref(element);
        }}
        aria-label="Thread actions"
        aria-haspopup="menu"
        aria-expanded="false"
        data-tip="Thread actions"
        onClick={() => setOpen((held) => !held)}
        onKeyDown={(event) => openMenuFromKeys(event, () => setOpen(true))}
      >
        <Ellipsis />
      </Button>
      <Presence when={open() && button()}>
        {(anchor) => (
          <MenuPopup anchor={anchor()} align="end" onClose={() => setOpen(false)}>
            <For each={props.items}>
              {(item) => (
                <MenuCheckboxItem checked={item.On} closeOnClick onClick={() => item.Run()}>
                  <span class="flex items-center gap-2">
                    {item.Label}
                    <Show when={item.Shortcut}>
                      {(shortcut) => <MenuShortcut>{shortcut()}</MenuShortcut>}
                    </Show>
                  </span>
                </MenuCheckboxItem>
              )}
            </For>
          </MenuPopup>
        )}
      </Presence>
    </>
  );
}
