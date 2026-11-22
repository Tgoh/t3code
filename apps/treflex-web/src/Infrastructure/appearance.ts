import type { IResourceImplementation } from "treflex";

import {
  type IAppearanceMode,
  type IColorScheme,
  SCHEME_BACKGROUND,
  SYSTEM_DARK_QUERY,
} from "../colorScheme";
import { APPEARANCE_MODE_KEY, storedAppearanceMode } from "./preferences";

declare module "treflex" {
  interface IResourceTypeRegistry {
    appearance: {
      Params: {};
      Message: { SystemDark: boolean; Mode: IAppearanceMode | null };
      Methods: { apply(scheme: IColorScheme): void };
    };
  }
}

/** Reports the system scheme, and appearance changes made in another tab, and applies a scheme. */
export const appearance: IResourceImplementation<"appearance"> = (_params, r) => {
  const system = matchMedia(SYSTEM_DARK_QUERY);
  const onSystem = () => void r.emit({ SystemDark: system.matches, Mode: null });
  const onStorage = (event: StorageEvent) => {
    if (event.key !== APPEARANCE_MODE_KEY) return;
    void r.emit({ SystemDark: system.matches, Mode: storedAppearanceMode() });
  };
  system.addEventListener("change", onSystem);
  window.addEventListener("storage", onStorage);
  r.signal.addEventListener("abort", () => {
    system.removeEventListener("change", onSystem);
    window.removeEventListener("storage", onStorage);
  });
  r.methods({
    apply: (_ctx, scheme) => {
      document.documentElement.dataset.theme = scheme;
      for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]'))
        meta.content = SCHEME_BACKGROUND[scheme];
    },
  });
  onSystem();
};
