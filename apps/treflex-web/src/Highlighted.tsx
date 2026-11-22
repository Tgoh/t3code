import { type SearchRange, splitSearchText } from "@t3tools/shared/paletteSearch";
import { For } from "solid-js";

export function Highlighted(props: { text: string; ranges: ReadonlyArray<SearchRange> }) {
  return (
    <For each={splitSearchText(props.text, props.ranges)}>
      {(part) => (part.highlighted ? <mark>{part.text}</mark> : part.text)}
    </For>
  );
}
