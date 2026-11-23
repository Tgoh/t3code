/** With `html`, it reports a copy only when the HTML flavour was written too. */
function copyBySelection(text: string, html?: string): boolean {
  const previous = document.activeElement;
  const area = document.createElement("textarea");
  area.value = text;
  area.style.position = "fixed";
  area.style.opacity = "0";
  let wroteHtml = false;
  const onCopy = (event: ClipboardEvent) => {
    if (html === undefined || event.clipboardData === null) return;
    event.clipboardData.setData("text/plain", text);
    event.clipboardData.setData("text/html", html);
    event.preventDefault();
    wroteHtml = true;
  };
  area.addEventListener("copy", onCopy);
  document.body.append(area);
  area.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } finally {
    area.remove();
    if (previous instanceof HTMLElement) previous.focus();
  }
  return copied && (html === undefined || wroteHtml);
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

// Follows writeTextToClipboard's extra flavours and requireHtml in apps/web/src/hooks/useCopyToClipboard.ts.
/** Copies `text` with an HTML flavour, so rich paste targets get the markup rendered. */
export async function copyHtml(text: string, html: string): Promise<boolean> {
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/plain": new Blob([text], { type: "text/plain" }),
        "text/html": new Blob([html], { type: "text/html" }),
      }),
    ]);
    return true;
  } catch {
    return copyBySelection(text, html);
  }
}
