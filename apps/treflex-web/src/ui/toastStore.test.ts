import { describe, expect, it, vi } from "vite-plus/test";

import { buildVisibleToastLayout, shouldRenderThreadScopedToast, ToastStore } from "./toastStore";

function withTimers(run: (store: ToastStore) => void) {
  vi.useFakeTimers();
  try {
    run(new ToastStore());
  } finally {
    vi.useRealTimers();
  }
}

const live = (store: ToastStore) =>
  store.toasts.filter((toast) => toast.transitionStatus !== "ending").map((toast) => toast.title);

describe("ToastStore", () => {
  it("closes a toast after its timeout, and never a loading one", () =>
    withTimers((store) => {
      store.add({ title: "saved", type: "success" });
      store.add({ title: "working", type: "loading" });
      vi.advanceTimersByTime(4_999);
      expect(live(store)).toEqual(["working", "saved"]);
      vi.advanceTimersByTime(1);
      expect(live(store)).toEqual(["working"]);
      vi.advanceTimersByTime(60_000);
      expect(live(store)).toEqual(["working"]);
    }));

  it("pauses the timers while hovered and resumes with the time that was left", () =>
    withTimers((store) => {
      store.add({ title: "saved", timeout: 1_000 });
      vi.advanceTimersByTime(600);
      store.pauseTimers();
      store.setInteraction({ hovering: true });
      vi.advanceTimersByTime(5_000);
      expect(live(store)).toEqual(["saved"]);
      store.release({ hovering: false });
      vi.advanceTimersByTime(399);
      expect(live(store)).toEqual(["saved"]);
      vi.advanceTimersByTime(1);
      expect(live(store)).toEqual([]);
    }));

  it("keeps the timers paused while the window is blurred, even once the hover ends", () =>
    withTimers((store) => {
      store.setInteraction({ windowFocused: false });
      store.add({ title: "saved", timeout: 1_000 });
      store.setInteraction({ hovering: true });
      store.release({ hovering: false });
      vi.advanceTimersByTime(5_000);
      expect(live(store)).toEqual(["saved"]);
    }));

  it("limits the stack to the newest three", () =>
    withTimers((store) => {
      for (const title of ["a", "b", "c", "d"]) store.add({ title });
      expect(store.toasts.map((toast) => [toast.title, toast.limited])).toEqual([
        ["d", false],
        ["c", false],
        ["b", false],
        ["a", true],
      ]);
    }));

  it("updates a toast added again under the same id, restarting its timer", () =>
    withTimers((store) => {
      store.add({ id: "git", title: "Pushing…", type: "loading" });
      vi.advanceTimersByTime(10_000);
      store.add({ id: "git", title: "Pushed", type: "success" });
      expect(store.toasts.map((toast) => toast.title)).toEqual(["Pushed"]);
      vi.advanceTimersByTime(5_000);
      expect(live(store)).toEqual([]);
    }));

  it("turns a loading toast into its outcome when the promise settles", async () => {
    const store = new ToastStore();
    await store.promise(Promise.resolve(2), {
      loading: { title: "Counting" },
      success: (count) => ({ title: `Counted ${count}` }),
      error: { title: "Failed" },
    });
    expect(store.toasts.map((toast) => [toast.type, toast.title])).toEqual([
      ["success", "Counted 2"],
    ]);
  });

  it("ignores updates to a closing toast, and removes it once its exit ends", () => {
    const store = new ToastStore();
    const onClose = vi.fn();
    const id = store.add({ title: "saved", onClose });
    store.close(id);
    store.update(id, { title: "changed" });
    expect(store.toasts.map((toast) => [toast.title, toast.transitionStatus])).toEqual([
      ["saved", "ending"],
    ]);
    expect(onClose).toHaveBeenCalledOnce();
    store.remove(id);
    expect(store.toasts).toEqual([]);
  });
});

describe("buildVisibleToastLayout", () => {
  it("closes the live toasts up behind one that's leaving", () => {
    const layout = buildVisibleToastLayout([
      { id: "a", updateKey: 0, height: 40 },
      { id: "b", updateKey: 0, height: 50, transitionStatus: "ending" },
      { id: "c", updateKey: 0, height: 60 },
    ]);
    expect(layout.frontmostHeight).toBe(40);
    expect(layout.items.map(({ visibleIndex, offsetY }) => [visibleIndex, offsetY])).toEqual([
      [0, 0],
      [1, 40],
      [1, 40],
    ]);
  });
});

describe("shouldRenderThreadScopedToast", () => {
  const active = { environmentId: "env", threadId: "t1" };
  it.each([
    [undefined, true],
    [{ threadId: "t1" }, true],
    [{ threadId: "t2" }, false],
    [{ threadRef: { environmentId: "env", threadId: "t1" } }, true],
    [{ threadRef: { environmentId: "other", threadId: "t1" } }, false],
  ])("scopes %o", (data, shown) => {
    expect(shouldRenderThreadScopedToast(data, active)).toBe(shown);
  });
});
