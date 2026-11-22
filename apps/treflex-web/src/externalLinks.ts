/**
 * An iOS home-screen app opens a new-tab link in an in-app browser sheet, without the user's Safari
 * tabs and sign-ins. iOS 17's `x-safari-https:` scheme hands the link to Safari itself instead.
 */
export function openExternalLinksInSafari() {
  if (Reflect.get(navigator, "standalone") !== true) return;
  document.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (!(link instanceof HTMLAnchorElement) || link.target !== "_blank") return;
    if (link.protocol !== "https:" && link.protocol !== "http:") return;
    // Safari doesn't share the home-screen app's cookies, so this server's own files stay in the sheet.
    if (link.origin === window.location.origin) return;
    event.preventDefault();
    window.location.href = `x-safari-${link.href}`;
  });
}
