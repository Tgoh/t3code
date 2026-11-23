// @effect-diagnostics globalTimers:off globalDate:off -- A view-only toast queue, outside any Effect runtime.
import type { JSX } from "solid-js";

import type { ButtonVariant } from "./Button";

export type ToastType = "error" | "warning" | "success" | "info" | "loading";

export interface IToastButtonProps {
  children: JSX.Element;
  onClick?: (event: MouseEvent) => void;
  disabled?: boolean;
  class?: string;
  "aria-label"?: string;
}

export interface IThreadToastData {
  threadRef?: { environmentId: string; threadId: string } | null;
  threadId?: string | null;
  leadingIcon?: JSX.Element;
  tooltipStyle?: boolean;
  onClose?: () => void;
  dismissAfterVisibleMs?: number;
  hideCopyButton?: boolean;
  additionalActions?: ReadonlyArray<{ id: string; props: IToastButtonProps }>;
  secondaryActionProps?: IToastButtonProps;
  secondaryActionVariant?: ButtonVariant;
  expandableContent?: JSX.Element;
  expandableLabels?: { expand?: string; collapse?: string };
  expandableDescriptionTrigger?: boolean;
  actionLayout?: "inline" | "stacked-end";
  actionVariant?: ButtonVariant;
}

export interface IToastOptions {
  id?: string;
  type?: ToastType;
  title?: JSX.Element;
  description?: JSX.Element;
  timeout?: number | undefined;
  priority?: "low" | "high";
  actionProps?: IToastButtonProps;
  data?: IThreadToastData;
  positionerProps?: { anchor: Element; sideOffset?: number };
  onClose?: () => void;
  onRemove?: () => void;
}

export interface IToast extends IToastOptions {
  id: string;
  updateKey: number;
  transitionStatus?: "starting" | "ending" | undefined;
  height?: number;
  limited?: boolean;
}

interface ITimer {
  handle: ReturnType<typeof setTimeout> | undefined;
  start: number;
  delay: number;
  remaining: number;
  callback: () => void;
}

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_LIMIT = 3;

let nextId = 0;

/** Marks the live toasts past `limit` (newest first) as limited, as Base UI's `applyLimited` does. */
function applyLimited(toasts: readonly IToast[], limit: number): IToast[] {
  let active = 0;
  return toasts.map((toast) => {
    if (toast.transitionStatus === "ending") return toast;
    const limited = active >= limit;
    active += 1;
    return toast.limited === limited ? toast : { ...toast, limited };
  });
}

export interface IToastPromiseOptions<T> {
  loading: IToastOptions;
  success: IToastOptions | ((result: T) => IToastOptions);
  error: IToastOptions | ((error: unknown) => IToastOptions);
}

/**
 * Base UI's `ToastStore` and `createToastManager` in one: the queue, auto-dismiss timers that pause
 * while the stack is hovered or focused or the window is blurred, and the limit. The view reports
 * those interaction states and heights, and removes a toast once its exit transition ends.
 */
export class ToastStore {
  toasts: IToast[] = [];
  hovering = false;
  focused = false;
  windowFocused = true;
  prevFocusElement: Element | null = null;
  private readonly timers = new Map<string, ITimer>();
  private timersPaused = false;
  private readonly listeners = new Set<() => void>();

  constructor(
    readonly timeout = DEFAULT_TIMEOUT_MS,
    readonly limit = DEFAULT_LIMIT,
  ) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get expanded(): boolean {
    return this.hovering || this.focused;
  }

  private get expandedOrOutOfFocus(): boolean {
    return this.hovering || this.focused || !this.windowFocused;
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  private setToasts(toasts: IToast[], clearInteraction = toasts.length === 0): void {
    this.toasts = toasts;
    if (clearInteraction) {
      this.hovering = false;
      this.focused = false;
    }
    this.emit();
  }

  setInteraction(patch: { hovering?: boolean; focused?: boolean; windowFocused?: boolean }): void {
    Object.assign(this, patch);
    this.emit();
  }

  find(id: string): IToast | undefined {
    return this.toasts.find((toast) => toast.id === id);
  }

  add = (options: IToastOptions): string => {
    const id = options.id ?? `toast-${++nextId}`;
    if (options.id !== undefined) {
      const existing = this.find(options.id);
      if (existing?.transitionStatus === "ending") this.remove(options.id, true);
      else if (existing) {
        const { id: _id, ...updates } = options;
        this.updateInternal(options.id, updates, true, true);
        return options.id;
      }
    }
    const toast: IToast = { ...options, id, updateKey: 0, transitionStatus: "starting" };
    this.setToasts(applyLimited([toast, ...this.toasts], this.limit));
    const duration = toast.timeout ?? this.timeout;
    if (toast.type !== "loading" && duration > 0) {
      this.scheduleTimer(id, duration, () => this.close(id));
    }
    if (this.expandedOrOutOfFocus) this.pauseTimers();
    return id;
  };

  update = (id: string, updates: Partial<IToastOptions>): void => {
    const previous = this.find(id);
    if (!previous || previous.transitionStatus === "ending") return;
    this.updateInternal(id, updates, false, true);
  };

  /** The view's own writes (height, settled entrance), which don't count as an update. */
  updateInternal(
    id: string,
    updates: Partial<IToast>,
    resetTimer = false,
    markUpdated = false,
  ): void {
    const previous = this.find(id);
    if (!previous || previous.transitionStatus === "ending") return;
    const next: IToast = {
      ...previous,
      ...updates,
      ...(markUpdated && { updateKey: previous.updateKey + 1 }),
    };
    this.setToasts(this.toasts.map((toast) => (toast.id === id ? next : toast)));
    const nextTimeout = next.timeout ?? this.timeout;
    const previousTimeout = previous.timeout ?? this.timeout;
    const shouldHaveTimer = next.type !== "loading" && nextTimeout > 0;
    const hasTimer = this.timers.has(id);
    if (!shouldHaveTimer && hasTimer) {
      this.clearTimer(id);
      return;
    }
    if (
      shouldHaveTimer &&
      (!hasTimer ||
        previousTimeout !== nextTimeout ||
        Object.hasOwn(updates, "timeout") ||
        previous.type === "loading" ||
        resetTimer)
    ) {
      this.clearTimer(id);
      this.scheduleTimer(id, nextTimeout, () => this.close(id));
      if (this.expandedOrOutOfFocus) this.pauseTimers();
    }
  }

  close = (id?: string): void => {
    const closeAll = id === undefined;
    let closing: IToast[];
    if (closeAll) {
      closing = this.toasts;
      this.clearTimers();
    } else {
      const toast = this.find(id);
      if (!toast) return;
      closing = [toast];
      this.clearTimer(id);
    }
    const ending = this.toasts.map((toast) =>
      closeAll || toast.id === id
        ? { ...toast, transitionStatus: "ending" as const, height: 0 }
        : toast,
    );
    const next = applyLimited(ending, this.limit);
    this.setToasts(next, !next.some((toast) => toast.transitionStatus !== "ending"));
    for (const toast of closing) {
      if (toast.transitionStatus !== "ending") toast.onClose?.();
    }
  };

  /** Drops a toast once its exit has played. */
  remove(id: string, skipOnRemove = false): void {
    const toast = this.find(id);
    if (!toast) return;
    if (!skipOnRemove) toast.onRemove?.();
    this.setToasts(this.toasts.filter((item) => item.id !== id));
  }

  promise = <T>(value: Promise<T>, options: IToastPromiseOptions<T>): Promise<T> => {
    const id = this.add({ ...options.loading, type: "loading" });
    return value.then(
      (result) => {
        const success =
          typeof options.success === "function" ? options.success(result) : options.success;
        this.update(id, { ...success, type: "success", timeout: success.timeout });
        return result;
      },
      (error: unknown) => {
        const failure = typeof options.error === "function" ? options.error(error) : options.error;
        this.update(id, { ...failure, type: "error", timeout: failure.timeout });
        throw error;
      },
    );
  };

  pauseTimers(): void {
    if (this.timersPaused) return;
    this.timersPaused = true;
    for (const timer of this.timers.values()) {
      if (timer.handle === undefined) continue;
      clearTimeout(timer.handle);
      timer.handle = undefined;
      timer.remaining = Math.max(timer.remaining - (Date.now() - timer.start), 0);
    }
  }

  resumeTimers(): void {
    if (!this.timersPaused) return;
    this.timersPaused = false;
    for (const [id, timer] of this.timers) {
      timer.remaining = timer.remaining > 0 ? timer.remaining : timer.delay;
      timer.handle = setTimeout(() => {
        this.timerFired(id);
        timer.callback();
      }, timer.remaining);
      timer.start = Date.now();
    }
  }

  /** Hover and focus end, and the timers run again unless the window is still blurred. */
  release(patch: { hovering?: boolean; focused?: boolean }): void {
    this.setInteraction(patch);
    if (!this.expandedOrOutOfFocus) this.resumeTimers();
  }

  private scheduleTimer(id: string, delay: number, callback: () => void): void {
    const start = Date.now();
    const handle = this.expandedOrOutOfFocus
      ? undefined
      : setTimeout(() => {
          this.timerFired(id);
          callback();
        }, delay);
    this.timers.set(id, { handle, start, delay, remaining: delay, callback });
  }

  private clearTimers(): void {
    for (const timer of this.timers.values()) clearTimeout(timer.handle);
    this.timers.clear();
    this.timersPaused = false;
  }

  private clearTimer(id: string): void {
    clearTimeout(this.timers.get(id)?.handle);
    this.timers.delete(id);
    if (this.timers.size === 0) this.timersPaused = false;
  }

  private timerFired(id: string): void {
    this.timers.delete(id);
    if (this.timers.size === 0) this.timersPaused = false;
  }
}

export const toastManager = new ToastStore();
export const anchoredToastManager = new ToastStore();

export function hasVisibleToastAction(actionProps: IToastButtonProps | undefined): boolean {
  const children = actionProps?.children;
  return children != null && children !== false && children !== "";
}

export function shouldHideCollapsedToastContent(index: number, count: number): boolean {
  return count > 1 && index > 0;
}

/** Each toast's place in the stack, where a closing toast keeps its slot and the live ones close up. */
export function buildVisibleToastLayout(toasts: readonly IToast[]): {
  frontmostHeight: number;
  items: Array<{ toast: IToast; visibleIndex: number; offsetY: number }>;
} {
  let fullIndex = 0;
  let fullOffsetY = 0;
  let liveIndex = 0;
  let liveOffsetY = 0;
  const items = toasts.map((toast) => {
    const height = normalizeHeight(toast.height);
    const ending = toast.transitionStatus === "ending";
    const item = ending
      ? { toast, visibleIndex: fullIndex, offsetY: fullOffsetY }
      : { toast, visibleIndex: liveIndex, offsetY: liveOffsetY };
    fullOffsetY += height;
    fullIndex += 1;
    if (!ending) {
      liveOffsetY += height;
      liveIndex += 1;
    }
    return item;
  });
  const frontmost = toasts.find((toast) => toast.transitionStatus !== "ending");
  return { frontmostHeight: normalizeHeight(frontmost?.height), items };
}

function normalizeHeight(height: number | undefined): number {
  return typeof height === "number" && Number.isFinite(height) && height > 0 ? height : 0;
}

export function shouldRenderThreadScopedToast(
  data: IThreadToastData | undefined,
  active: { environmentId: string; threadId: string } | null,
): boolean {
  if (data?.threadRef) {
    return (
      active !== null &&
      data.threadRef.environmentId === active.environmentId &&
      data.threadRef.threadId === active.threadId
    );
  }
  if (!data?.threadId) return true;
  return active?.threadId === data.threadId;
}

export interface IStackedThreadToastOptions {
  type: ToastType;
  title: JSX.Element;
  description?: JSX.Element;
  timeout?: number;
  priority?: "low" | "high";
  actionProps?: IToastButtonProps;
  actionVariant?: ButtonVariant;
  data?: Omit<IThreadToastData, "actionLayout">;
}

/** A toast whose actions sit in a row under its text. */
export function stackedThreadToast(options: IStackedThreadToastOptions): IToastOptions {
  const { type, title, description, timeout, priority, actionProps, actionVariant, data } = options;
  return {
    type,
    title,
    data: {
      ...data,
      actionLayout: "stacked-end",
      ...(actionVariant !== undefined && { actionVariant }),
    },
    ...(description !== undefined && { description }),
    ...(timeout !== undefined && { timeout }),
    ...(priority !== undefined && { priority }),
    ...(actionProps !== undefined && { actionProps }),
  };
}
