import { createMemo, createSignal, For, Show } from "solid-js";

import type { IDiffPanel } from "./Diff";
import { type IDiffFile, type IPatchRow, parseDiff, patchRows } from "./diffView";
import Environment from "./Environment";
import { ChevronRight, FileDiff } from "./icons";
import { PanelHeader } from "./RightPanel";
import ThreadSession from "./ThreadSession";
import { Button } from "./ui/Button";
import { ERROR_TEXT } from "./ui/notice";
import { Skeleton } from "./ui/Skeleton";
import { ADDED_TEXT, DIFF_COUNTS, REMOVED_TEXT } from "./ui/notes";

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

// Wrapping follows the Word wrap setting, as stock's DiffPanel.tsx does (`wordWrap`).
function Patch(props: { patch: string }) {
  const environment = Environment.use();
  const rows = createMemo(() => patchRows(props.patch));
  const [all, setAll] = createSignal(false);
  const shown = () => (all() ? rows() : rows().slice(0, LINE_CAP));
  return (
    <>
      <pre
        class="group/patch m-0 overflow-x-auto bg-code text-[13px] leading-5 data-wrap:whitespace-pre-wrap data-wrap:wrap-break-word"
        data-wrap={environment.wordWrap() ? "" : undefined}
      >
        <For each={shown()}>
          {(row) => (
            <span
              class={`flex w-fit min-w-full border-l-3 group-data-wrap/patch:w-full ${ROW[row.Kind]}`}
            >
              <span class={`w-13 flex-none pr-3 text-right select-none ${NUMBER[row.Kind]}`}>
                {row.Number}
              </span>
              <span class="min-w-0 flex-1 pr-3">{row.Text || " "}</span>
            </span>
          )}
        </For>
      </pre>
      <Show when={!all() && rows().length > LINE_CAP}>
        <Button variant="outline" size="sm" onClick={() => setAll(true)}>
          Show all {rows().length} lines
        </Button>
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

function FileDiffRow(props: { file: IDiffFile; open: boolean; onToggle: (open: boolean) => void }) {
  return (
    <details
      class="group border-b border-border"
      open={props.open}
      onToggle={(event) => props.onToggle(event.currentTarget.open)}
    >
      <summary class="sticky top-0 z-1 flex h-8 cursor-pointer list-none items-center gap-1.5 bg-background px-3 text-[12px] [&::-webkit-details-marker]:hidden">
        <ChevronRight class="size-3.5 text-muted-foreground group-open:rotate-90" />
        <span class="min-w-0 flex-1 font-medium wrap-anywhere">{props.file.Path}</span>
        <Counts additions={props.file.Additions} deletions={props.file.Deletions} />
      </summary>
      <Show when={props.open}>
        <Patch patch={props.file.Patch} />
      </Show>
    </details>
  );
}

type ISkeletonWidth = "short" | "medium" | "long";

const FILE_TITLE_WIDTH: Record<ISkeletonWidth, string> = {
  short: "h-3 w-2/5 max-w-52",
  medium: "h-3 w-1/2 max-w-64",
  long: "h-3 w-3/5 max-w-72",
};

const CODE_LINE_WIDTH: Record<ISkeletonWidth, string> = {
  short: "h-2.5 w-3/5",
  medium: "h-2.5 w-2/3",
  long: "h-2.5 w-4/5",
};

function DiffFileHeaderSkeleton(props: { titleWidth: ISkeletonWidth }) {
  return (
    <div class="flex h-8 items-center gap-2 px-2 pr-3">
      <div class="flex size-5 shrink-0 items-center justify-center">
        <Skeleton class="size-2.5" />
      </div>
      <Skeleton class="size-5 shrink-0" />
      <Skeleton shape="pill" class={FILE_TITLE_WIDTH[props.titleWidth]} />
      <div class="ml-auto flex shrink-0 items-center gap-2">
        <Skeleton shape="pill" class="h-3 w-5" />
        <Skeleton shape="pill" class="h-3 w-5" />
      </div>
    </div>
  );
}

function DiffCodeLineSkeleton(props: { width: ISkeletonWidth }) {
  return (
    <div class="flex items-center gap-3">
      <Skeleton shape="pill" class="h-2.5 w-5 shrink-0" />
      <Skeleton shape="pill" class={CODE_LINE_WIDTH[props.width]} />
    </div>
  );
}

function DiffLoadingState(props: { label: string }) {
  return (
    <div
      class="min-h-0 flex-1 overflow-hidden bg-background"
      role="status"
      aria-live="polite"
      aria-label={props.label}
    >
      <DiffFileHeaderSkeleton titleWidth="medium" />
      <div class="flex h-6 items-center gap-2 px-2 pr-3">
        <div class="h-px flex-1 bg-border/40" />
        <Skeleton shape="pill" class="h-2.5 w-24" />
        <div class="h-px flex-1 bg-border/40" />
      </div>
      <div class="space-y-2 px-3 py-2">
        <DiffCodeLineSkeleton width="medium" />
        <DiffCodeLineSkeleton width="long" />
        <DiffCodeLineSkeleton width="short" />
      </div>
      <DiffFileHeaderSkeleton titleWidth="short" />
      <DiffFileHeaderSkeleton titleWidth="long" />
      <span class="sr-only">{props.label}</span>
    </div>
  );
}

export function DiffPanel(props: { panel: IDiffPanel }) {
  const session = ThreadSession.use();
  const panel = () => props.panel;
  const files = createMemo(() => parseDiff(panel().Text ?? ""));
  const [opened, setOpened] = createSignal<Record<string, boolean>>({});
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
          <DiffLoadingState label="Loading diff…" />
        </Show>
        <Show when={panel().Error}>
          <p class={ERROR_TEXT}>Couldn't load the diff: {panel().Error}</p>
        </Show>
        <Show when={panel().Text === "" || (panel().Text != null && files().length === 0)}>
          <div class="flex h-full items-center justify-center px-3 py-2 text-xs text-muted-foreground/70">
            <p>No changes.</p>
          </div>
        </Show>
        <For each={files()}>
          {(file, index) => (
            <FileDiffRow
              file={file}
              open={opened()[file.Path] ?? index() === 0}
              onToggle={(open) => setOpened((held) => ({ ...held, [file.Path]: open }))}
            />
          )}
        </For>
      </div>
    </>
  );
}

const sum = (files: IDiffFile[], key: "Additions" | "Deletions"): number =>
  files.reduce((total, file) => total + file[key], 0);
