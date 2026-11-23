import type { IResourceImplementation } from "treflex";

import { type IConfigIssue, keybindingsWarnings } from "../keybindingsWarning";
import { clockNow } from "../timestamps";
import { Button } from "../ui/Button";
import { stackedThreadToast, toastManager } from "../ui/toastStore";

declare module "treflex" {
  interface IResourceTypeRegistry {
    keybindingsWarning: {
      Params: {};
      /** The person pressed the warning's Open keybindings.json. */
      Message: { Open: string };
      Methods: {
        /** Takes each `keybindingsUpdated` event's issues. */
        report(issues: readonly IConfigIssue[], configPath: string, canOpen: boolean): void;
      };
    };
  }
}

/** Follows apps/web/src/components/KeybindingsUpdateToast.tsx and KeybindingsConfigWarning.tsx. */
export const keybindingsWarning: IResourceImplementation<"keybindingsWarning"> = (_params, r) => {
  const warn = keybindingsWarnings(clockNow);
  r.methods({
    report: (_ctx, issues, configPath, canOpen) => {
      const message = warn(issues);
      if (message === null) return;
      toastManager.add(
        stackedThreadToast({
          type: "warning",
          title: "Invalid keybindings configuration",
          description: (
            <>
              {message}
              <span class="mt-2 flex justify-end">
                <Button
                  size="xs"
                  variant="outline"
                  disabled={!canOpen}
                  onClick={() => void r.emit({ Open: configPath })}
                >
                  Open keybindings.json
                </Button>
              </span>
            </>
          ),
        }),
      );
    },
  });
};
