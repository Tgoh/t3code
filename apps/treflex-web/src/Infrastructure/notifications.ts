import { defineEffect, type IEffect, implementation, type IResourceImplementation } from "treflex";

import completionUrl from "../../../web/src/assets/notification-completion.mp3";
import inputUrl from "../../../web/src/assets/notification-input.mp3";
import {
  hasDesktopNotifications,
  hasNotificationSound,
  type INotificationKind,
  type INotificationMode,
  type INotificationStatus,
} from "../threadNotifications";
import { closeThreadToast, showThreadToast } from "../threadNotificationToast";

export interface IShownNotification {
  ThreadId: string;
  Kind: INotificationKind;
  Status: INotificationStatus;
  Title: string;
  Body: string;
  Tag: string;
}

/** A note with what the environment knows when it's shown. */
export interface INotificationShow extends IShownNotification {
  InApp: boolean;
  /** Its thread is the one on screen, which an in-app toast skips. */
  Viewing: boolean;
}

declare module "treflex" {
  interface IResourceTypeRegistry {
    threadNotifier: {
      Params: {};
      /** The person clicked a system notification or a toast's Open thread for this thread. */
      Message: { Opened: string };
      Methods: {
        setMode(mode: INotificationMode, inApp: boolean): void;
        show(note: INotificationShow): void;
        /** The thread is now on screen, so its toasts close. */
        opened(threadId: string): void;
      };
    };
  }
}

// Follows apps/web/src/threadNotifications.ts and the presentation half of
// apps/web/src/components/ThreadNotificationCoordinator.tsx, which has no desktop bridge here.

let audioContext: AudioContext | undefined;
const buffers = new Map<string, Promise<AudioBuffer>>();
/** When each sound's current playback ends, on the audio context's clock. */
const playingUntil = new Map<string, number>();

function loadBuffer(context: AudioContext, url: string): Promise<AudioBuffer> {
  let buffer = buffers.get(url);
  if (!buffer) {
    buffer = fetch(url)
      .then((response) => response.arrayBuffer())
      .then((data) => context.decodeAudioData(data))
      .catch((error: unknown) => {
        buffers.delete(url);
        throw error;
      });
    buffers.set(url, buffer);
  }
  return buffer;
}

/** Called from a gesture so browsers allow later background playback. */
function unlockAudio() {
  if (typeof AudioContext === "undefined") return;
  const firstUnlock = audioContext === undefined;
  audioContext ??= new AudioContext();
  void audioContext.resume().catch(() => undefined);
  if (!firstUnlock) return;
  // Fetch and decode during interaction so the first alert is ready when the thread finishes.
  for (const url of [completionUrl, inputUrl]) {
    void loadBuffer(audioContext, url).catch(() => undefined);
  }
}

async function playSound(kind: INotificationKind, shouldPlay: () => boolean) {
  if (!audioContext || audioContext.state !== "running") return;
  const context = audioContext;
  const url = kind === "completion" ? completionUrl : inputUrl;
  try {
    const decoded = await loadBuffer(context, url);
    if (!shouldPlay() || context.state !== "running") return;
    // Coalesce same-sound bursts after decode to avoid clipping; each sound keeps its own slot.
    if (context.currentTime < (playingUntil.get(url) ?? 0)) return;
    const source = context.createBufferSource();
    source.buffer = decoded;
    source.connect(context.destination);
    source.start();
    playingUntil.set(url, context.currentTime + decoded.duration);
  } catch {
    // A failed load is retried on the next alert.
  }
}

let originalFavicon: HTMLLinkElement | undefined;
let badgeFavicon: HTMLLinkElement | undefined;

function setBadge(count: number) {
  let image: string | null = null;
  if (count > 0) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    const context = canvas.getContext("2d");
    if (context) {
      context.fillStyle = "#e5484d";
      context.beginPath();
      context.arc(32, 32, 28, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "white";
      context.font = `600 ${count > 9 ? 30 : 40}px "Segoe UI", sans-serif`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(count > 9 ? "9+" : String(count), 32, 34);
      image = canvas.toDataURL("image/png");
    }
  }
  if (image) {
    if (!badgeFavicon) {
      originalFavicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]') ?? undefined;
      badgeFavicon = document.createElement("link");
      badgeFavicon.rel = "icon";
      badgeFavicon.type = "image/png";
      badgeFavicon.sizes.value = "64x64";
      originalFavicon?.remove();
      document.head.append(badgeFavicon);
    }
    badgeFavicon.href = image;
  } else if (badgeFavicon) {
    badgeFavicon.remove();
    badgeFavicon = undefined;
    if (originalFavicon) document.head.append(originalFavicon);
    originalFavicon = undefined;
  }
}

const isWindows = () => /^Win/i.test(navigator.platform);

/** Plays sounds and shows system notifications for the mode it's given, and reports their clicks. */
export const threadNotifier: IResourceImplementation<"threadNotifier"> = (_params, r) => {
  const pending = new Map<string, Notification>();
  const clearPending = () => {
    for (const notification of pending.values()) notification.close();
    pending.clear();
    setBadge(0);
  };
  let mode: INotificationMode = "off";
  let stopModeListeners = () => {};
  const applyMode = (next: INotificationMode) => {
    if (next === mode) return;
    mode = next;
    stopModeListeners();
    clearPending();
    const stops: Array<() => void> = [];
    if (hasDesktopNotifications(next)) {
      window.addEventListener("focus", clearPending);
      stops.push(() => {
        window.removeEventListener("focus", clearPending);
        clearPending();
      });
    }
    if (hasNotificationSound(next)) {
      document.addEventListener("pointerdown", unlockAudio);
      document.addEventListener("keydown", unlockAudio);
      stops.push(() => {
        document.removeEventListener("pointerdown", unlockAudio);
        document.removeEventListener("keydown", unlockAudio);
      });
    }
    stopModeListeners = () => {
      for (const stop of stops) stop();
    };
  };
  // Toast ids by thread, so opening the thread or turning in-app off closes them.
  const toasts = new Map<string, string[]>();
  const closeToasts = (threadId?: string) => {
    for (const [id, held] of toasts) {
      if (threadId !== undefined && id !== threadId) continue;
      for (const toast of held) closeThreadToast(toast);
      toasts.delete(id);
    }
  };
  let inApp = false;
  r.signal.addEventListener("abort", () => {
    stopModeListeners();
    closeToasts();
  });
  r.methods({
    setMode: (_ctx, next, nextInApp) => {
      applyMode(next);
      inApp = nextInApp;
      if (!inApp) closeToasts();
    },
    opened: (_ctx, threadId) => closeToasts(threadId),
    show: (_ctx, note) => {
      if (hasNotificationSound(mode)) void playSound(note.Kind, () => hasNotificationSound(mode));
      if (
        inApp &&
        note.InApp &&
        !note.Viewing &&
        document.visibilityState === "visible" &&
        document.hasFocus()
      ) {
        const forget = () => {
          const left = (toasts.get(note.ThreadId) ?? []).filter((held) => held !== id);
          if (left.length === 0) toasts.delete(note.ThreadId);
          else toasts.set(note.ThreadId, left);
        };
        const id = showThreadToast(note, () => void r.emit({ Opened: note.ThreadId }), forget);
        toasts.set(note.ThreadId, [...(toasts.get(note.ThreadId) ?? []), id]);
        return;
      }
      if (
        !hasDesktopNotifications(mode) ||
        (document.visibilityState === "visible" && document.hasFocus()) ||
        typeof Notification === "undefined" ||
        Notification.permission !== "granted"
      )
        return;
      try {
        const notification = new Notification(note.Title, {
          body: note.Body,
          tag: note.Tag,
          silent: true,
          // Windows drops clicks after a toast moves into Notification Center.
          requireInteraction: note.Kind === "completion" && isWindows(),
        });
        pending.get(note.Tag)?.close();
        pending.set(note.Tag, notification);
        setBadge(pending.size);
        notification.addEventListener("click", () => {
          notification.close();
          window.focus();
          void r.emit({ Opened: note.ThreadId });
        });
      } catch {
        // Some browsers expose Notification but reject desktop presentation.
      }
    },
  });
};

export type INotificationPermission = "granted" | "denied" | "unsupported" | "unavailable";

interface IChooseNotificationModeEffect extends IEffect {
  Type: "chooseNotificationMode";
  Mode: INotificationMode;
}

/**
 * Unlocks sound and asks for permission to notify, as choosing a mode in stock's settings does.
 * Runs from the choosing gesture, which browsers want for both.
 */
export const chooseNotificationModeEffect = defineEffect<
  IChooseNotificationModeEffect,
  INotificationPermission
>("chooseNotificationMode");

// Follows NotificationSettings in apps/web/src/components/settings/NotificationSettings.tsx.
export const chooseNotificationModeImpl = implementation(
  chooseNotificationModeEffect,
  async (effect): Promise<INotificationPermission> => {
    if (hasNotificationSound(effect.Mode)) unlockAudio();
    if (!hasDesktopNotifications(effect.Mode)) return "granted";
    if (typeof Notification === "undefined" || !window.isSecureContext) return "unsupported";
    try {
      return (await Notification.requestPermission()) === "granted" ? "granted" : "denied";
    } catch {
      return "unavailable";
    }
  },
);
