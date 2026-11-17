export type IAppearanceMode = "system" | "light" | "dark";
export type IColorScheme = "light" | "dark";

export const isAppearanceMode = (value: unknown): value is IAppearanceMode =>
  value === "system" || value === "light" || value === "dark";

export const resolveScheme = (held: IAppearanceMode, systemIsDark: boolean): IColorScheme =>
  held === "system" ? (systemIsDark ? "dark" : "light") : held;

export const SYSTEM_DARK_QUERY = "(prefers-color-scheme: dark)";
