// @effect-diagnostics globalTimers:off -- A resource's idle timer, outside any Effect runtime.
import { request } from "@t3tools/client-runtime/rpc";
import { EnvironmentId, WS_METHODS } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import { implementation, type IResourceImplementation } from "treflex";

import { reportActivityEffect } from "./clientActivity";
import { inEnvironment } from "./commandsImpl";

// Follows apps/web/src/lib/backgroundActivityReporter.ts.
const CLIENT_ID_STORAGE_KEY = "t3.backgroundActivity.clientId";
const REPORT_TIMEOUT_MS = 15_000;
const LEASE_TTL_MS = 45_000;
const RECENT_INTERACTION_WINDOW_MS = LEASE_TTL_MS;

function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function clientId(): string {
  try {
    const existing = localStorage.getItem(CLIENT_ID_STORAGE_KEY);
    if (existing) return existing;
    const next = randomId();
    localStorage.setItem(CLIENT_ID_STORAGE_KEY, next);
    return next;
  } catch {
    return "ephemeral-browser-client";
  }
}

export const reportActivityImpl = implementation(reportActivityEffect, async (input) => {
  const report = DateTime.now.pipe(
    Effect.flatMap((observedAt) =>
      request(WS_METHODS.serverReportClientActivity, {
        environmentId: EnvironmentId.make(input.EnvironmentId),
        clientId: clientId(),
        clientKind: "web",
        visible: input.Visible,
        focused: input.Focused,
        recentlyInteracted: input.RecentlyInteracted,
        appState: input.Visible ? "active" : "background",
        scopes: input.Scopes,
        ttlMs: LEASE_TTL_MS,
        observedAt,
      }),
    ),
    Effect.timeout(`${REPORT_TIMEOUT_MS} millis`),
  );
  await inEnvironment(input.EnvironmentId, report).catch(() => {});
});

/** Reports visibility, focus and recent interaction, on open and whenever one changes. */
export const deviceActivity: IResourceImplementation<"deviceActivity"> = (_params, r) => {
  let lastInteractionAt = Number.NEGATIVE_INFINITY;
  let recent = false;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const emit = () =>
    void r.emit({
      Visible: document.visibilityState === "visible",
      Focused: document.hasFocus(),
      RecentlyInteracted: recent,
    });
  const checkIdle = () => {
    const left = lastInteractionAt + RECENT_INTERACTION_WINDOW_MS - performance.now();
    if (left > 0) {
      idleTimer = setTimeout(checkIdle, left);
      return;
    }
    idleTimer = undefined;
    recent = false;
    emit();
  };
  const onInteraction = () => {
    lastInteractionAt = performance.now();
    if (recent) return;
    recent = true;
    idleTimer = setTimeout(checkIdle, RECENT_INTERACTION_WINDOW_MS);
    emit();
  };
  const passive = { passive: true } as const;
  document.addEventListener("visibilitychange", emit);
  window.addEventListener("focus", emit);
  window.addEventListener("blur", emit);
  window.addEventListener("online", emit);
  window.addEventListener("pointermove", onInteraction, passive);
  window.addEventListener("keydown", onInteraction);
  window.addEventListener("wheel", onInteraction, passive);
  window.addEventListener("touchstart", onInteraction, passive);
  r.signal.addEventListener("abort", () => {
    clearTimeout(idleTimer);
    document.removeEventListener("visibilitychange", emit);
    window.removeEventListener("focus", emit);
    window.removeEventListener("blur", emit);
    window.removeEventListener("online", emit);
    window.removeEventListener("pointermove", onInteraction);
    window.removeEventListener("keydown", onInteraction);
    window.removeEventListener("wheel", onInteraction);
    window.removeEventListener("touchstart", onInteraction);
  });
  emit();
};
