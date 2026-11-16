import { createSignal } from "solid-js";

export type IAppearanceMode = "system" | "light" | "dark";
export type IColorScheme = "light" | "dark";

// Stock's key (THEME_APPEARANCE_MODE_STORAGE_KEY), so a browser on stock's origin reads the same value.
const KEY = "t3code:theme-appearance-mode";

export const isAppearanceMode = (value: unknown): value is IAppearanceMode =>
  value === "system" || value === "light" || value === "dark";

function storedMode(): IAppearanceMode {
  try {
    const held = localStorage.getItem(KEY);
    return isAppearanceMode(held) ? held : "system";
  } catch {
    return "system";
  }
}

const system = matchMedia("(prefers-color-scheme: dark)");
const [mode, setMode] = createSignal<IAppearanceMode>(storedMode());
const [systemDark, setSystemDark] = createSignal(system.matches);
system.addEventListener("change", (event) => setSystemDark(event.matches));

export const resolveScheme = (held: IAppearanceMode, systemIsDark: boolean): IColorScheme =>
  held === "system" ? (systemIsDark ? "dark" : "light") : held;

export const appearanceMode = mode;
export const colorScheme = (): IColorScheme => resolveScheme(mode(), systemDark());

const listeners = new Set<(scheme: IColorScheme) => void>();

/** Calls `listener` whenever the resolved scheme changes; returns the unsubscribe. */
export function onColorSchemeChange(listener: (scheme: IColorScheme) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

let applied: IColorScheme | null = null;
function apply() {
  const scheme = colorScheme();
  document.documentElement.dataset.theme = scheme;
  if (applied === scheme) return;
  const first = applied === null;
  applied = scheme;
  if (!first) for (const listener of listeners) listener(scheme);
}

system.addEventListener("change", apply);
window.addEventListener("storage", (event) => {
  if (event.key !== KEY) return;
  setMode(storedMode());
  apply();
});
apply();

export function setAppearanceMode(next: IAppearanceMode): void {
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // Still applies for this page when storage is blocked.
  }
  setMode(next);
  apply();
}
