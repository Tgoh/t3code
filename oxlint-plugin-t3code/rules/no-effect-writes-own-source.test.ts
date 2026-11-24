import { createOxlintRuleHarness } from "../test/utils.ts";

const rule = createOxlintRuleHarness("t3code/no-effect-writes-own-source", {
  filename: "fixture.tsx",
});

rule.invalid(
  "blocks the file preview's playback effect",
  `const [playback, setPlayback] = createSignal(null);
createEffect(
  () => followRevision({ held: playback(), latest: latest() }),
  (next) => { if (next !== untrack(playback)) setPlayback(next); },
);`,
);
rule.invalid(
  "blocks a compute that passes the getter bare",
  `const [count, setCount] = createSignal(0);
createEffect(() => untrack(count) + source(), (next) => setCount(next));`,
);
rule.valid(
  "allows the writable derived signal that replaced it",
  `const [playback, setPlayback] = createSignal((held) => followRevision({ held: held ?? null, latest: latest() }));
const onPlay = (source) => setPlayback(source);`,
);
rule.valid(
  "allows an effect that writes a different signal",
  `const [query] = createSignal("");
const [results, setResults] = createSignal([]);
createEffect(() => query(), (next) => setResults(search(next)));`,
);
rule.valid(
  "allows a write from a callback the apply phase registers",
  `const [clipping, setClipping] = createSignal(false);
createEffect(() => clipping(), (on) => {
  const timer = setTimeout(() => setClipping(false), 250);
  return () => clearTimeout(timer);
});`,
);
rule.valid(
  "ignores a property that shares the getter's name",
  `const [preview, setPreview] = createSignal(null);
createEffect(() => ({ text: live.preview() }), (held) => setPreview(held.text));`,
);
rule.valid(
  "allows reading the signal only in the apply phase",
  `const [open, setOpen] = createSignal(false);
createEffect(() => props.route, () => { if (open()) setOpen(false); });`,
);
