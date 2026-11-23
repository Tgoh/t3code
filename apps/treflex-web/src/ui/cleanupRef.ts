import { onCleanup } from "solid-js";

/**
 * A ref whose setup returns its teardown, run when the calling component disposes. Call it in a
 * component body or as the `ref={...}` expression: Solid refuses `onCleanup` inside the ref itself.
 */
export function cleanupRef<T>(setup: (element: T) => (() => void) | undefined) {
  const stops: (() => void)[] = [];
  onCleanup(() => {
    for (const stop of stops) stop();
  });
  return (element: T) => {
    const stop = setup(element);
    if (stop !== undefined) stops.push(stop);
  };
}
