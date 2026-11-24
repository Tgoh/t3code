import type { JSX } from "@solidjs/web";
import { Errored } from "solid-js";

export function Caught(props: { fallback: JSX.Element; children: JSX.Element }) {
  // A fallback that takes the error keeps dev builds from logging the catch a second time,
  // beside the render root's onError.
  return <Errored fallback={(_error) => props.fallback}>{props.children}</Errored>;
}
