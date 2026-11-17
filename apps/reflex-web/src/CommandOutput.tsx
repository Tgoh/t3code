import {
  TERMINAL_PALETTES,
  terminalOutputSpans,
  type TerminalSpanStyle,
} from "@t3tools/shared/terminalOutput";
import { type IActionGenerator, type IEntity, openResource } from "treflex";
import { useComponentState, useResource } from "treflex-solid";
import { createEffect, createMemo, createSignal, Index, onMount, Show } from "solid-js";

import Environment from "./Environment";
import { ERROR_NOTE } from "./ui/notes";

declare module "treflex" {
  interface IResourceRegistry {
    "Command/Output": { Type: "commandOutput" };
  }
}

const cssOf = (style: TerminalSpanStyle) => ({
  color: style.color,
  "background-color": style.backgroundColor,
  "font-weight": style.fontWeight,
  opacity: style.opacity,
  "font-style": style.fontStyle,
  "text-decoration-line": style.textDecorationLine,
});

function* openOutput(
  draft: IEntity,
  environmentId: string,
  threadId: string,
  itemId: string,
): IActionGenerator {
  yield* openResource(draft, "Command/Output", {
    Type: "commandOutput",
    EnvironmentId: environmentId,
    ThreadId: threadId,
    ItemId: itemId,
  });
}

export const WORK_PRE =
  "m-0 max-h-64 overflow-auto font-mono text-[11px] leading-[1.625] wrap-anywhere whitespace-pre-wrap text-secondary-label";

const NOTE = "m-0 text-[12px] text-muted-foreground";

// The component entity's removal closes the subscription.
export function CommandOutput(props: { environmentId: string; threadId: string; itemId: string }) {
  const environment = Environment.use();
  const local = useComponentState(() => ({}));
  const output = useResource(local.state, "Command/Output");
  onMount(() => local.dispatch(openOutput, props.environmentId, props.threadId, props.itemId));
  const spans = createMemo(() =>
    terminalOutputSpans(output.value()?.Text ?? "", TERMINAL_PALETTES[environment.colorScheme()]),
  );
  const [scroller, setScroller] = createSignal<HTMLPreElement>();
  const [following, setFollowing] = createSignal(true);
  createEffect(() => {
    spans();
    const element = scroller();
    if (element !== undefined && following()) element.scrollTop = element.scrollHeight;
  });
  return (
    <Show when={output.value()} fallback={<p class={NOTE}>Loading output…</p>}>
      {(shown) => (
        <>
          <Show when={shown().Error}>
            <p class={ERROR_NOTE}>Couldn't load output: {shown().Error}</p>
          </Show>
          <Show when={shown().Truncated}>
            <p class={NOTE}>Earlier output not shown.</p>
          </Show>
          <Show
            when={shown().Text !== ""}
            fallback={
              <Show when={!shown().Running && shown().Error === null}>
                <p class={NOTE}>No output.</p>
              </Show>
            }
          >
            <pre
              class={WORK_PRE}
              ref={setScroller}
              onScroll={(event) => {
                const element = event.currentTarget;
                setFollowing(element.scrollHeight - element.scrollTop - element.clientHeight < 8);
              }}
            >
              <Index each={spans()}>
                {(span) => (
                  <Show when={span().style} fallback={span().text}>
                    {(style) => <span style={cssOf(style())}>{span().text}</span>}
                  </Show>
                )}
              </Index>
            </pre>
          </Show>
        </>
      )}
    </Show>
  );
}
