// @effect-diagnostics globalTimers:off -- A view-only reset of the copied icon, outside any Effect runtime.
import { type JSX, Portal } from "@solidjs/web";
import { createRenderEffect, createSignal, For, Show } from "solid-js";

import { copyHtml, copyText } from "./clipboard";
import { Check, Copy } from "./icons";
import { tableToCsv, tableToHtml, tableToMarkdown } from "./tableClipboard";
import { Button } from "./ui/Button";
import { MenuItem, MenuPopup, openMenuFromKeys } from "./ui/Menu";
import { Presence } from "./ui/Presence";

const COPIED_MS = 1_200;

type ITableCopyFormat = "markdown" | "csv" | "html";

// Follows MarkdownTable in apps/web/src/components/chat/MarkdownTable.tsx.
export function TableCopyMenu(props: { table: () => HTMLTableElement | undefined }) {
  const [button, setButton] = createSignal<HTMLButtonElement>();
  const [open, setOpen] = createSignal(false);
  const [copied, setCopied] = createSignal(false);
  const label = () => (copied() ? "Copied" : "Copy table");
  const write = (format: ITableCopyFormat, table: HTMLTableElement) => {
    if (format === "markdown") return copyText(tableToMarkdown(table));
    if (format === "csv") return copyText(tableToCsv(table));
    // Plain-text targets get the markup; rich targets (mail, docs, wikis) paste a real table.
    const html = tableToHtml(table);
    return copyHtml(html, `<meta charset="utf-8">${html}`);
  };
  const copy = async (format: ITableCopyFormat) => {
    const table = props.table();
    if (table === undefined || !(await write(format, table))) return;
    setCopied(true);
    setTimeout(() => setCopied(false), COPIED_MS);
  };
  return (
    <div class="mt-0.5 -mx-1 flex items-center justify-end select-none">
      <Button
        variant="ghost-muted"
        size="icon-xs"
        ref={setButton}
        aria-label={label()}
        aria-haspopup="menu"
        aria-expanded="false"
        data-tip={label()}
        onClick={() => setOpen((held) => !held)}
        onKeyDown={(event) => openMenuFromKeys(event, () => setOpen(true))}
      >
        <Show when={copied()} fallback={<Copy class="size-3" />}>
          <Check class="size-3" />
        </Show>
      </Button>
      <Presence when={open() && button()}>
        {(anchor) => (
          <MenuPopup anchor={anchor()} align="end" onClose={() => setOpen(false)}>
            <MenuItem closeOnClick onClick={() => void copy("markdown")}>
              Copy as Markdown
            </MenuItem>
            <MenuItem closeOnClick onClick={() => void copy("csv")}>
              Copy as CSV
            </MenuItem>
            <MenuItem closeOnClick onClick={() => void copy("html")}>
              Copy as HTML
            </MenuItem>
          </MenuPopup>
        )}
      </Presence>
    </div>
  );
}

interface ITableMount {
  table: HTMLTableElement;
  menu: HTMLElement;
}

function wrapTables(container: HTMLElement): ITableMount[] {
  return Array.from(container.querySelectorAll("table"), (table) => {
    const wrapper = document.createElement("div");
    wrapper.className = "chat-markdown-table-container";
    const scroller = document.createElement("div");
    scroller.className = "w-full max-w-full overflow-x-auto";
    const menu = document.createElement("div");
    table.replaceWith(wrapper);
    scroller.append(table);
    wrapper.append(scroller, menu);
    return { table, menu };
  });
}

/** Sanitized HTML markup, whose tables get the copy menu that stock's rehype-raw tables have. */
export function RawHtml(props: {
  markup: string;
  class: string;
  onClick?: JSX.EventHandler<HTMLDivElement, MouseEvent>;
}) {
  const [element, setElement] = createSignal<HTMLDivElement>();
  const [tables, setTables] = createSignal<ITableMount[]>([]);
  createRenderEffect(
    () => [element(), props.markup] as const,
    ([container, markup]) => {
      if (container === undefined) return;
      container.innerHTML = markup;
      setTables(wrapTables(container));
    },
  );
  return (
    <>
      <div ref={setElement} class={props.class} onClick={(event) => props.onClick?.(event)} />
      <For each={tables()}>
        {(mount) => (
          <Portal mount={mount.menu}>
            <TableCopyMenu table={() => mount.table} />
          </Portal>
        )}
      </For>
    </>
  );
}
