import { createOxlintRuleHarness } from "../test/utils.ts";

const rule = createOxlintRuleHarness("t3code/no-cleanup-in-ref", { filename: "fixture.tsx" });

rule.invalid(
  "blocks the file preview's crash: a named ref that registers a cleanup",
  `function PreviewImage() {
  const observe = (node: HTMLDivElement) => {
    const observer = new ResizeObserver(() => {});
    observer.observe(node);
    onCleanup(() => observer.disconnect());
  };
  return <div ref={observe} />;
}`,
);
rule.invalid(
  "blocks an inline ref that registers a cleanup",
  `const View = () => <div ref={(node) => { onCleanup(() => node.remove()); }} />;`,
);
rule.invalid(
  "blocks a function declaration used as a ref",
  `function track(node: HTMLElement) { onCleanup(() => node.remove()); }
const View = () => <div ref={track} />;`,
);
rule.valid(
  "allows cleanupRef, which registers its cleanup in the component body",
  `function PreviewImage() {
  const observe = cleanupRef((node: HTMLDivElement) => {
    const observer = new ResizeObserver(() => {});
    observer.observe(node);
    return () => observer.disconnect();
  });
  return <div ref={observe} />;
}`,
);
rule.valid(
  "allows onCleanup in a component body beside a plain ref",
  `function View() {
  let el: HTMLDivElement | undefined;
  const timer = setInterval(() => {}, 1000);
  onCleanup(() => clearInterval(timer));
  return <div ref={(node) => (el = node)} />;
}`,
);
rule.valid(
  "allows onCleanup in a named helper that is not a ref",
  `function View() {
  const start = () => { const t = setInterval(() => {}, 1000); onCleanup(() => clearInterval(t)); };
  start();
  return <div ref={(node) => node.focus()} />;
}`,
);
