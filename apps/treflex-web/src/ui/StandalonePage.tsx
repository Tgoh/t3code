import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";

import { T3Mark } from "../brand";

export function StandalonePage(props: { children: JSX.Element }) {
  return (
    // The page owns scrolling because root cannot scroll; safe centering keeps oversized cards top-aligned.
    <div class="flex h-full items-center-safe justify-center overflow-y-auto scrollbar-gutter-both bg-background px-4 py-10 text-foreground sm:px-6">
      <section class="dialog-glass w-full max-w-xl rounded-2xl border p-6">
        {props.children}
      </section>
    </div>
  );
}

export function StandalonePageHeader(props: {
  context?: JSX.Element;
  title: JSX.Element;
  description: JSX.Element;
}) {
  return (
    <>
      <div class="flex items-baseline justify-between gap-3 text-muted-foreground">
        <span class="flex items-baseline gap-1.5" role="img" aria-label="T3 Code">
          <T3Mark class="h-3 w-auto shrink-0 text-foreground" aria-hidden="true" />
          <span class="text-lg font-medium tracking-tight">Code</span>
        </span>
        <Show when={props.context}>
          <span class="text-sm">{props.context}</span>
        </Show>
      </div>
      <h1 class="mt-6 text-xl leading-tight font-semibold">{props.title}</h1>
      <p class="mt-2 text-sm text-muted-foreground">{props.description}</p>
    </>
  );
}
