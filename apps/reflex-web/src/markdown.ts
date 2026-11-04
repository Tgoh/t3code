// @effect-diagnostics globalTimers:off -- A view-only reset of the copied icon, outside any Effect runtime.
import DOMPurify from "dompurify";
import { Marked } from "marked";

const COPIED_MS = 1_200;

const icon = (name: string, paths: string): string =>
  `<svg class="lucide code-icon ${name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

const WRAP_ICON = icon(
  "wrap",
  '<path d="m16 16-2 2 2 2"/><path d="M3 12h15a3 3 0 1 1 0 6h-4"/><path d="M3 18h7"/><path d="M3 6h18"/>',
);
const COPY_ICONS = [
  icon(
    "copy",
    '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  ),
  icon("copied", '<path d="M20 6 9 17l-5-5"/>'),
  icon("failed", '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),
].join("");

const escapeHtml = (text: string): string =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

// Follows the tag list rehype-sanitize's default schema gives stock's assistant messages.
const ALLOWED_TAGS = [
  ..."h1 h2 h3 h4 h5 h6 br b i strong em a pre code img tt div ins del sup sub p ol ul".split(" "),
  ..."table thead tbody tfoot tr td th blockquote dl dt dd kbd q samp var hr ruby rt rp".split(" "),
  ..."li s strike summary details caption figure figcaption abbr bdo cite dfn mark small".split(
    " ",
  ),
  ..."span time wbr".split(" "),
];
const ALLOWED_ATTR = "href src alt class open colspan rowspan align start reversed".split(" ");
const LANGUAGE_CLASS = /^language-[\w+#.-]+$/;
const EXTERNAL_LINK = /^(?:https?:|mailto:)/i;

DOMPurify.addHook("uponSanitizeAttribute", (node, data) => {
  if (
    data.attrName === "class" &&
    !(node.nodeName === "CODE" && LANGUAGE_CLASS.test(data.attrValue))
  )
    data.keepAttr = false;
});

// A relative href is a file path an agent named, and following it would leave the app and lose drafts.
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.nodeName !== "A") return;
  const href = node.getAttribute("href");
  if (href === null) return;
  if (EXTERNAL_LINK.test(href)) {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  } else {
    node.removeAttribute("href");
    node.setAttribute("data-tip", href);
  }
});

// The HTML parser reads everything after one of these as its content, so a mention in prose would
// swallow the rest of the message.
const RAW_TEXT_TAG =
  /<\/?(?:style|script|title|textarea|xmp|iframe|noembed|noframes|noscript|plaintext)\b/i;

const assistantParser = new Marked({
  renderer: {
    html: ({ text }) => (RAW_TEXT_TAG.test(text) ? escapeHtml(text) : text),
  },
});
const userParser = new Marked({
  breaks: true,
  renderer: {
    html: ({ text }) => escapeHtml(text),
  },
});

const CODE_BLOCK = /<pre><code(?: class="language-([\w+#.-]+)")?>([\s\S]*?)<\/code><\/pre>/g;

function withCodeBlockChrome(html: string): string {
  return html.replace(
    CODE_BLOCK,
    (_match, language: string | undefined, code: string) =>
      `<div class="code-block" dir="ltr" data-wrap="true"><div class="code-block-header"><span class="code-language">${language ?? "text"}</span><span class="code-actions"><button type="button" class="icon-button small pressed" data-code-wrap aria-pressed="true" aria-label="Disable line wrap" data-tip="Disable line wrap">${WRAP_ICON}</button><button type="button" class="icon-button small" data-code-copy aria-label="Copy code" data-tip="Copy code">${COPY_ICONS}</button></span></div><pre><code>${code}</code></pre></div>`,
  );
}

export const renderMarkdown = (text: string, fromUser: boolean): string =>
  withCodeBlockChrome(
    DOMPurify.sanitize((fromUser ? userParser : assistantParser).parse(text, { async: false }), {
      ALLOWED_TAGS,
      ALLOWED_ATTR,
      ADD_ATTR: ["target", "rel"],
    }),
  );

function copyBySelection(text: string): boolean {
  const previous = document.activeElement;
  const area = document.createElement("textarea");
  area.value = text;
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.append(area);
  area.select();
  const copied = document.execCommand("copy");
  area.remove();
  if (previous instanceof HTMLElement) previous.focus();
  return copied;
}

// navigator.clipboard is undefined on plain HTTP, which is how a tailnet browser reaches a server.
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return copyBySelection(text);
  }
}

function toggleWrap(button: HTMLElement): void {
  const block = button.closest<HTMLElement>(".code-block");
  if (block === null) return;
  const wrapped = block.dataset.wrap !== "true";
  const label = wrapped ? "Disable line wrap" : "Wrap lines";
  block.dataset.wrap = String(wrapped);
  button.classList.toggle("pressed", wrapped);
  button.setAttribute("aria-pressed", String(wrapped));
  button.setAttribute("aria-label", label);
  button.dataset.tip = label;
}

async function copyBlock(button: HTMLElement): Promise<void> {
  const code = button.closest(".code-block")?.querySelector("pre")?.textContent ?? "";
  button.dataset.copied = (await copyText(code)) ? "true" : "failed";
  setTimeout(() => delete button.dataset.copied, COPIED_MS);
}

export function onCodeBlockAction(event: MouseEvent): void {
  const target = event.target as Element;
  const wrap = target.closest<HTMLElement>("[data-code-wrap]");
  if (wrap !== null) toggleWrap(wrap);
  const copy = target.closest<HTMLElement>("[data-code-copy]");
  if (copy !== null) void copyBlock(copy);
}
