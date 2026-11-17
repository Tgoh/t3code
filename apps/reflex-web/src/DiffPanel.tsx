import { createMemo, createSignal, For, Show } from "solid-js";

import { type IDiffFile, type IPatchRow, parseDiff, patchRows } from "./diffView";
import { ChevronRight, FileDiff } from "./icons";
import { PanelHeader } from "./RightPanel";
import ThreadSession from "./ThreadSession";
import { Button } from "./ui/Button";
import { ADDED_TEXT, DIFF_COUNTS, EMPTY_NOTE, ERROR_NOTE, REMOVED_TEXT } from "./ui/notes";

const LINE_CAP = 2000;

const ROW: Record<IPatchRow["Kind"], string> = {
  added: "border-l-diff-addition bg-[color-mix(in_srgb,var(--diff-addition)_10%,transparent)]",
  removed: "border-l-diff-deletion bg-[color-mix(in_srgb,var(--diff-deletion)_10%,transparent)]",
  hunk: "border-l-transparent bg-accent text-[12px] text-muted-foreground",
  context: "border-l-transparent",
};

const NUMBER: Record<IPatchRow["Kind"], string> = {
  added: "text-diff-addition-foreground",
  removed: "text-diff-deletion-foreground",
  hunk: "text-muted-foreground",
  context: "text-muted-foreground",
};

function Patch(props: { patch: string }) {
  const rows = createMemo(() => patchRows(props.patch));
  const [all, setAll] = createSignal(false);
  const shown = () => (all() ? rows() : rows().slice(0, LINE_CAP));
  return (
    <>
      <pre class="m-0 overflow-x-auto bg-code text-[13px] leading-5">
        <For each={shown()}>
          {(row) => (
            <span class={`flex w-fit min-w-full border-l-3 ${ROW[row.Kind]}`}>
              <span class={`w-13 flex-none pr-3 text-right select-none ${NUMBER[row.Kind]}`}>
                {row.Number}
              </span>
              <span class="flex-1 pr-3">{row.Text || " "}</span>
            </span>
          )}
        </For>
      </pre>
      <Show when={!all() && rows().length > LINE_CAP}>
        <Button onClick={() => setAll(true)}>Show all {rows().length} lines</Button>
      </Show>
    </>
  );
}

function Counts(props: { additions: number; deletions: number }) {
  return (
    <span class={DIFF_COUNTS}>
      <span class={ADDED_TEXT}>+{props.additions}</span>{" "}
      <span class={REMOVED_TEXT}>-{props.deletions}</span>
    </span>
  );
}

function FileDiffRow(props: { file: IDiffFile; openFirst: boolean }) {
  const [open, setOpen] = createSignal(props.openFirst);
  return (
    <details
      class="group border-b border-border"
      open={open()}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary class="sticky top-0 z-1 flex h-8 cursor-pointer list-none items-center gap-1.5 bg-background px-3 text-[12px] [&::-webkit-details-marker]:hidden">
        <ChevronRight class="size-3.5 text-muted-foreground group-open:rotate-90" />
        <span class="min-w-0 flex-1 font-medium wrap-anywhere">{props.file.Path}</span>
        <Counts additions={props.file.Additions} deletions={props.file.Deletions} />
      </summary>
      <Show when={open()}>
        <Patch patch={props.file.Patch} />
      </Show>
    </details>
  );
}

export function DiffPanel() {
  const session = ThreadSession.use();
  const panel = () => session.state.Panels.Diff;
  const files = createMemo(() => parseDiff(panel().Text ?? ""));
  const title = () => {
    const held = panel();
    if (held.Scope === "branch") return held.BaseRef == null ? "Uncommitted" : `vs ${held.BaseRef}`;
    return held.Scope === "thread" ? "Whole thread" : `Turn ${held.ToTurnCount ?? ""}`;
  };
  return (
    <>
      <PanelHeader closeLabel="Close diff" onClose={() => session.closeDiff()}>
        <span class="inline-flex h-6 items-center gap-1 rounded-lg bg-accent px-2 text-[12px] font-medium [&_svg]:size-3.5">
          <FileDiff />
          Diff
        </span>
      </PanelHeader>
      <div class="flex h-10 flex-none items-center gap-2 border-b border-border pt-0 pr-3 pb-3 pl-2">
        <span class="rounded-lg bg-muted px-2 text-[12px] leading-6 font-medium">{title()}</span>
        <span class="flex-1" />
        <Show when={files().length > 0}>
          <Counts additions={sum(files(), "Additions")} deletions={sum(files(), "Deletions")} />
        </Show>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto">
        <Show when={session.diffLoading()}>
          <p class={EMPTY_NOTE}>Loading diff…</p>
        </Show>
        <Show when={panel().Error}>
          <p class={ERROR_NOTE}>Couldn't load the diff: {panel().Error}</p>
        </Show>
        <Show when={panel().Text === "" || (panel().Text != null && files().length === 0)}>
          <p class={EMPTY_NOTE}>No changes.</p>
        </Show>
        <For each={files()}>
          {(file, index) => <FileDiffRow file={file} openFirst={index() === 0} />}
        </For>
      </div>
    </>
  );
}

const sum = (files: IDiffFile[], key: "Additions" | "Deletions"): number =>
  files.reduce((total, file) => total + file[key], 0);
