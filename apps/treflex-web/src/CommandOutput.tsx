import {
  TERMINAL_PALETTES,
  terminalOutputSpans,
  type TerminalSpanStyle,
} from "@t3tools/shared/terminalOutput";
import { useResource } from "treflex-solid";
import { createEffect, createMemo, createSignal, Index, Show } from "solid-js";

import Environment from "./Environment";
import ThreadSession from "./ThreadSession";
import type { IToolDetail } from "./ToolDetail";
import { ERROR_TEXT } from "./ui/notice";

const cssOf = (style: TerminalSpanStyle) => ({
  color: style.color,
  "background-color": style.backgroundColor,
  "font-weight": style.fontWeight,
  opacity: style.opacity,
  "font-style": style.fontStyle,
  "text-decoration-line": style.textDecorationLine,
});

export const WORK_PRE =
  "m-0 max-h-64 overflow-auto font-mono text-[11px] leading-[1.625] wrap-anywhere whitespace-pre-wrap text-secondary-label";

const NOTE = "m-0 text-[12px] text-muted-foreground";

// Follows useFetchedTurnItem in apps/web/src/components/chat/V2ItemInspector.tsx.
export function ToolDetailNote(props: { detail: IToolDetail }) {
  return (
    <Show
      when={props.detail.Error}
      fallback={
        <Show
          when={props.detail.Missing}
          fallback={
            <Show when={props.detail.Item === null}>
              <p class={NOTE}>Loading output…</p>
            </Show>
          }
        >
          <p class={NOTE}>Output is no longer available.</p>
        </Show>
      }
    >
      {(error) => <p class={ERROR_TEXT}>Couldn't load output: {error()}</p>}
    </Show>
  );
}

export function CommandOutput(props: { itemId: string }) {
  const environment = Environment.use();
  const session = ThreadSession.use();
  const output = useResource(() => session.state.CommandOutputs[props.itemId], "Command/Output");
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
            <p class={ERROR_TEXT}>Couldn't load output: {shown().Error}</p>
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
