import { defineEffect, type IEffect, implementation } from "treflex";

import { toastManager, type ToastType } from "../ui/toastStore";

export interface IToastRequest {
  Kind: Exclude<ToastType, "loading">;
  Title: string;
  Description?: string | null;
  /** Shows the toast only while this thread is open, as stock's thread-scoped toasts do. */
  Thread?: { EnvironmentId: string; ThreadId: string } | null;
  /** Stays until dismissed, as stock's `timeout: 0` toasts do. */
  Sticky?: boolean;
}

interface IToastEffect extends IEffect, IToastRequest {
  Type: "toast";
}

export const toastEffect = defineEffect<IToastEffect, void>("toast", { settles: "sync" });

export const toast = (request: IToastRequest) => toastEffect(request);

export const toastImpl = implementation(toastEffect, (effect) => {
  toastManager.add({
    type: effect.Kind,
    title: effect.Title,
    ...(effect.Description != null && { description: effect.Description }),
    ...(effect.Sticky === true && { timeout: 0 }),
    ...(effect.Thread != null && {
      data: {
        threadRef: { environmentId: effect.Thread.EnvironmentId, threadId: effect.Thread.ThreadId },
      },
    }),
  });
});
