const RELOADED_INTO = "reflex:preload-reload";

/** Production builds only: test clients run the dev server on other ports, where a worker would serve stale code. */
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  const register = () =>
    navigator.serviceWorker
      .register("/sw.js", { updateViaCache: "none" })
      .catch((error) => console.error("[reflex-web] Service worker registration failed:", error));
  if (document.readyState === "complete") void register();
  else addEventListener("load", () => void register(), { once: true });

  // A rebuild replaces dist, so a page still on the old build can't load a chunk it hasn't loaded yet.
  // One reload per build: a chunk that fails again after it is really broken.
  addEventListener("vite:preloadError", (event) => {
    const build =
      document.querySelector<HTMLScriptElement>('script[type="module"][src]')?.src ?? "";
    try {
      if (sessionStorage.getItem(RELOADED_INTO) === build) return;
      sessionStorage.setItem(RELOADED_INTO, build);
    } catch {
      return;
    }
    event.preventDefault();
    location.reload();
  });
}
