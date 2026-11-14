import {
  TERMINAL_PALETTES,
  terminalOutputSpans,
  type TerminalSpanStyle,
} from "@t3tools/shared/terminalOutput";
import { type IActionGenerator, type IEntity, openResource } from "treflex";
import { useComponentState, useResource } from "treflex-solid";
import { createEffect, createMemo, createSignal, Index, onMount, Show } from "solid-js";

declare module "treflex" {
  interface IResourceRegistry {
    "Command/Output": { Type: "commandOutput" };
  }
}

const palette = () =>
  TERMINAL_PALETTES[matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"];

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

// The component entity's removal closes the subscription.
export function CommandOutput(props: { environmentId: string; threadId: string; itemId: string }) {
  const local = useComponentState(() => ({}));
  const output = useResource(local.state, "Command/Output");
  onMount(() => local.dispatch(openOutput, props.environmentId, props.threadId, props.itemId));
  const spans = createMemo(() => terminalOutputSpans(output.value()?.Text ?? "", palette()));
  const [scroller, setScroller] = createSignal<HTMLPreElement>();
  const [following, setFollowing] = createSignal(true);
  createEffect(() => {
    spans();
    const element = scroller();
    if (element !== undefined && following()) element.scrollTop = element.scrollHeight;
  });
  return (
    <Show when={output.value()} fallback={<p class="command-note">Loading output…</p>}>
      {(shown) => (
        <>
          <Show when={shown().Error}>
            <p class="composer-error">Couldn't load output: {shown().Error}</p>
          </Show>
          <Show when={shown().Truncated}>
            <p class="command-note">Earlier output not shown.</p>
          </Show>
          <Show
            when={shown().Text !== ""}
            fallback={
              <Show when={!shown().Running && shown().Error === null}>
                <p class="command-note">No output.</p>
              </Show>
            }
          >
            <pre
              class="code"
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
