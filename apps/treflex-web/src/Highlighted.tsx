import { type SearchRange, splitSearchText } from "@t3tools/shared/paletteSearch";
import { For } from "solid-js";

export function Highlighted(props: {
  text: string;
  ranges: ReadonlyArray<SearchRange>;
  markClass?: string;
}) {
  return (
    <For each={splitSearchText(props.text, props.ranges)}>
      {(part) => (part.highlighted ? <mark class={props.markClass}>{part.text}</mark> : part.text)}
    </For>
  );
}
