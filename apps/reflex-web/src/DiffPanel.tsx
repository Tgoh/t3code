import { createMemo, createSignal, For, Show } from "solid-js";

import { type IDiffFile, parseDiff, patchRows } from "./diffView";
import { ChevronRight, FileDiff, X } from "./icons";
import ThreadSession from "./ThreadSession";
import { Button } from "./ui/Button";
import { IconButton } from "./ui/IconButton";

const LINE_CAP = 2000;

function Patch(props: { patch: string }) {
  const rows = createMemo(() => patchRows(props.patch));
  const [all, setAll] = createSignal(false);
  const shown = () => (all() ? rows() : rows().slice(0, LINE_CAP));
  return (
    <>
      <pre class="patch">
        <For each={shown()}>
          {(row) => (
            <span class={`patch-row ${row.Kind}`}>
              <span class="patch-number">{row.Number}</span>
              <span class="patch-text">{row.Text || " "}</span>
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

function FileDiffRow(props: { file: IDiffFile; openFirst: boolean }) {
  const [open, setOpen] = createSignal(props.openFirst);
  return (
    <details
      class="diff-file"
      open={open()}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <ChevronRight class="diff-chevron" />
        <span class="diff-path">{props.file.Path}</span>
        <span class="diff-counts">
          <span class="added-text">+{props.file.Additions}</span>{" "}
          <span class="removed-text">-{props.file.Deletions}</span>
        </span>
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
    <aside class="right-panel">
      <header class="panel-header">
        <span class="panel-tab">
          <FileDiff />
          Diff
        </span>
        <span class="composer-spacer" />
        <IconButton
          aria-label="Close diff"
          data-tip="Close diff"
          onClick={() => session.closeDiff()}
        >
          <X />
        </IconButton>
      </header>
      <div class="panel-subheader">
        <span class="panel-chip">{title()}</span>
        <span class="composer-spacer" />
        <Show when={files().length > 0}>
          <span class="diff-counts">
            <span class="added-text">+{sum(files(), "Additions")}</span>{" "}
            <span class="removed-text">-{sum(files(), "Deletions")}</span>
          </span>
        </Show>
      </div>
      <div class="diff-body">
        <Show when={session.diffLoading()}>
          <p class="empty">Loading diff…</p>
        </Show>
        <Show when={panel().Error}>
          <p class="composer-error">Couldn't load the diff: {panel().Error}</p>
        </Show>
        <Show when={panel().Text === "" || (panel().Text != null && files().length === 0)}>
          <p class="empty">No changes.</p>
        </Show>
        <For each={files()}>
          {(file, index) => <FileDiffRow file={file} openFirst={index() === 0} />}
        </For>
      </div>
    </aside>
  );
}

const sum = (files: IDiffFile[], key: "Additions" | "Deletions"): number =>
  files.reduce((total, file) => total + file[key], 0);
