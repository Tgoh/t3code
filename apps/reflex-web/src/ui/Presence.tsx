import {
  type Accessor,
  createContext,
  createRenderEffect,
  createSignal,
  type JSX,
  on,
  Show,
  useContext,
} from "solid-js";

interface IPresence {
  closing: Accessor<boolean>;
  /** Registers an element whose transitions the unmount waits for. */
  track: (element: HTMLElement) => void;
}

const PresenceContext = createContext<IPresence>({ closing: () => false, track: () => {} });

/**
 * The surface's side of `Presence`: spread `data-closing` from `closing()` and pass `track` as a
 * ref, so `data-closing:` styles play the exit transition before the surface unmounts.
 */
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
  let generation = 0;
  createRenderEffect(
    on(
      () => props.when,
      (when) => {
        const run = ++generation;
        if (when) {
          setHeld(() => when as NonNullable<T>);
          return;
        }
        if (held() === undefined) return;
        // Closing mid-entrance cancels the entrance, whose promise settles before the exit has
        // run, so the wait reads the transitions again until none is left.
        const settle = async () => {
          for (;;) {
            const running = [...elements].flatMap((element) =>
              element.isConnected ? element.getAnimations({ subtree: true }) : [],
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
              setHeld(undefined);
            }),
        );
      },
    ),
  );
  const presence: IPresence = {
    closing: () => !props.when && held() !== undefined,
    track: (element) => elements.add(element),
  };
  return (
    <PresenceContext.Provider value={presence}>
      <Show
        when={props.keyed}
        fallback={<Show when={held()}>{(value) => props.children(value)}</Show>}
      >
        <Show when={held()} keyed>
          {(value) => props.children(() => value)}
        </Show>
      </Show>
    </PresenceContext.Provider>
  );
}
