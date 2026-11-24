import { type SearchRange, splitSearchText } from "@t3tools/shared/paletteSearch";
import { For } from "solid-js";

import { Caught } from "./ui/Caught";

export function Highlighted(props: {
  text: string;
  ranges: ReadonlyArray<SearchRange>;
  markClass?: string;
}) {
  return (
    <Caught fallback={props.text}>
      <For each={splitSearchText(props.text, props.ranges)}>
        {(part) =>
          part.highlighted ? <mark class={props.markClass}>{part.text}</mark> : part.text
        }
      </For>
    </Caught>
  );
}
