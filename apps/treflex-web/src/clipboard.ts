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
