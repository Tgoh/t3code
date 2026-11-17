import { createMemo, createSignal, For, Show } from "solid-js";

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
import { IconButton } from "./ui/IconButton";
import { MenuCheck, MenuItem, Popup } from "./ui/Menu";
import { LimitsSummary } from "./UsageView";

const MARGIN = 8;

/** Opens under its anchor, right edges aligned, kept inside the window. */
const placeBelow = (anchor: HTMLElement) => (popup: HTMLElement) => {
  const rect = anchor.getBoundingClientRect();
  const width = popup.offsetWidth;
  popup.style.top = `${rect.bottom + 4}px`;
  popup.style.left = `${Math.max(MARGIN, Math.min(rect.right - width, window.innerWidth - width - MARGIN))}px`;
};

const TONE: Record<ILimitTone, string> = {
  normal: "text-muted-foreground",
  warning: "text-warning",
  danger: "text-destructive",
};

/** Claude's overall weekly limit as a ring that fills as it's used, opening every limit's figures. */
export function UsageRing() {
  const environment = Environment.use();
  const sidebar = useSidebarSheet();
  const presentations = () =>
    limitPresentations(
      environment.state.EnvironmentId,
      environment.state.Label,
      environment.state.Replica.Config?.providers,
    );
  const weekly = createMemo(() => weeklyLimit(limitPools(presentations(), clockNow())), null, {
    equals: (left, right) => left?.UsedPercent === right?.UsedPercent && left?.Tone === right?.Tone,
  });
  const label = () => {
    const held = weekly();
    return held === null
      ? "Weekly limit not reported"
      : `Weekly limit: ${held.RemainingPercent}% left`;
  };
  // The reset countdown is read when the tip shows, so the ring never re-renders on a clock.
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
      <IconButton
        ref={setButton}
        aria-label={label()}
        aria-haspopup="dialog"
        aria-expanded={open() !== null}
        pressed={open() !== null}
        data-tip={label()}
        on:pointerover={freshTip}
        on:focusin={freshTip}
        onClick={() => setOpen((held) => (held === null ? clockNow() : null))}
      >
        <svg viewBox="0 0 16 16" class={`size-4 -rotate-90 ${TONE[weekly()?.Tone ?? "normal"]}`}>
          <circle
            cx="8"
            cy="8"
            r="6"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            opacity="0.2"
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
                stroke-dasharray={`${held().UsedPercent} 100`}
              />
            )}
          </Show>
        </svg>
      </IconButton>
      <Show when={open() !== null && button()}>
        {(anchor) => (
          <Popup
            portal
            role="dialog"
            label="Usage limits"
            anchor={anchor()}
            place={placeBelow(anchor())}
            class="fixed z-[120] flex max-h-[calc(100dvh-16px)] w-64 flex-col gap-3 overflow-y-auto rounded-lg border border-border bg-popover p-3 text-foreground shadow-[0_10px_25px_-5px_rgb(0_0_0/20%)]"
            onClose={(reason) => {
              setOpen(null);
              if (reason === "escape") anchor().focus();
            }}
          >
            <LimitsSummary pools={limitPools(presentations(), open() ?? 0)} now={open() ?? 0} />
            <Button
              class="flex w-full items-center justify-center gap-1.5 [&_svg]:size-3.5"
              onClick={() => {
                setOpen(null);
                sidebar.setOpen(false);
                void environment.openView({ Kind: "usage" });
              }}
            >
              <ChartNoAxesColumn />
              Open usage
            </Button>
          </Popup>
        )}
      </Show>
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
      <IconButton
        ref={(element) => {
          setButton(element);
          props.ref(element);
        }}
        aria-label="Thread actions"
        aria-haspopup="menu"
        aria-expanded={open()}
        pressed={open()}
        data-tip="Thread actions"
        onClick={() => setOpen((held) => !held)}
      >
        <Ellipsis />
      </IconButton>
      <Show when={open() && button()}>
        {(anchor) => (
          <Popup
            portal
            label="Thread actions"
            anchor={anchor()}
            place={placeBelow(anchor())}
            onClose={(reason) => {
              setOpen(false);
              if (reason === "escape") anchor().focus();
            }}
          >
            <For each={props.items}>
              {(item) => (
                <MenuItem
                  icon={<MenuCheck on={item.On} />}
                  label={item.Label}
                  detail={item.Shortcut ?? undefined}
                  aria-checked={item.On}
                  role="menuitemcheckbox"
                  onSelect={() => {
                    setOpen(false);
                    item.Run();
                  }}
                />
              )}
            </For>
          </Popup>
        )}
      </Show>
    </>
  );
}
