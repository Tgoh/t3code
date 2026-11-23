import type { JSX } from "@solidjs/web";
import {
  type Accessor,
  createContext,
  createRenderEffect,
  createSignal,
  Show,
  untrack,
  useContext,
} from "solid-js";

const STARTING = "data-starting-style";
const ENDING = "data-ending-style";

interface IPresence {
  /**
   * Registers an element whose transitions the unmount waits for, and gives it Base UI's
   * `data-starting-style` for its first frame and `data-ending-style` while it's held for the exit.
   */
  track: (element: HTMLElement) => void;
  /** Whether the children are only held for the exit, after `when` stopped. */
  exiting: Accessor<boolean>;
}

const PresenceContext = createContext<IPresence>({ track: () => {}, exiting: () => false });

/** The surface's side of `Presence`: pass `track` as a ref. */
export const usePresence = () => useContext(PresenceContext);

/**
 * Shows its children while `when` holds, and keeps the last value shown after it stops until the
 * tracked surfaces' transitions finish.
 */
export function Presence<T>(props: {
  when: T | undefined | null | false;
  keyed?: boolean;
  children: (value: Accessor<NonNullable<T>>) => JSX.Element;
}) {
  const [held, setHeld] = createSignal<NonNullable<T>>();
  const elements = new Set<HTMLElement>();
  const [ending, setEnding] = createSignal(false);
  let generation = 0;
  createRenderEffect(
    () => props.when,
    (when) => {
      const run = ++generation;
      if (when) {
        for (const element of elements) {
          if (!element.isConnected) elements.delete(element);
          else if (ending()) element.removeAttribute(ENDING);
        }
        setEnding(false);
        setHeld(() => when as NonNullable<T>);
        return;
      }
      if (held() === undefined) return;
      setEnding(true);
      for (const element of elements) {
        element.removeAttribute(STARTING);
        element.setAttribute(ENDING, "");
      }
      // Closing mid-entrance cancels the entrance, whose promise settles before the exit has
      // run, so the wait reads the transitions again until none is left. An infinite animation
      // (a spinner inside) never finishes, so it's left out, as Base UI does.
      const settle = async () => {
        for (;;) {
          const running = [...elements].flatMap((element) =>
            element.isConnected
              ? element
                  .getAnimations({ subtree: true })
                  .filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity)
              : [],
          );
          if (running.length === 0 || run !== generation) return;
          await Promise.allSettled(running.map((animation) => animation.finished));
        }
      };
      queueMicrotask(
        () =>
          void settle().then(() => {
            if (run !== generation) return;
            elements.clear();
            // Unmount first, so the children never see `exiting` turn false as a reopen.
            setHeld(undefined);
            setEnding(false);
          }),
      );
    },
  );
  const presence: IPresence = {
    track: (element) => {
      elements.add(element);
      if (untrack(ending)) {
        element.setAttribute(ENDING, "");
        return;
      }
      element.setAttribute(STARTING, "");
      requestAnimationFrame(() => element.removeAttribute(STARTING));
    },
    exiting: ending,
  };
  return (
    <PresenceContext value={presence}>
      <Show
        when={props.keyed}
        fallback={<Show when={held()}>{(value) => props.children(value)}</Show>}
      >
        <Show when={held()} keyed>
          {(value) => props.children(() => value)}
        </Show>
      </Show>
    </PresenceContext>
  );
}
