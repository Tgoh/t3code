import { defineEffect, type IEffect, implementation } from "treflex";

interface IAddressThreadEffect extends IEffect {
  Type: "addressThread";
}

interface ISetAddressThreadEffect extends IEffect {
  Type: "setAddressThread";
  ThreadId: string | null;
}

export const addressThread = defineEffect<IAddressThreadEffect, string | null>("addressThread");

const setAddress = defineEffect<ISetAddressThreadEffect, void>("setAddressThread");

export const setAddressThread = (threadId: string | null) => setAddress({ ThreadId: threadId });

export const addressThreadImpl = implementation(addressThread, () =>
  new URL(location.href).searchParams.get("thread"),
);

export const setAddressThreadImpl = implementation(setAddress, (effect) => {
  const url = new URL(location.href);
  if (effect.ThreadId === null) url.searchParams.delete("thread");
  else url.searchParams.set("thread", effect.ThreadId);
  history.replaceState(null, "", url);
});

/** A page over the thread view; the thread stays in the address underneath it. */
export type IAddressView = { Kind: "settings"; Page: string } | { Kind: "usage" };

interface IAddressViewEffect extends IEffect {
  Type: "addressView";
}

interface ISetAddressViewEffect extends IEffect {
  Type: "setAddressView";
  View: IAddressView | null;
}

export const addressView = defineEffect<IAddressViewEffect, IAddressView | null>("addressView");

const setView = defineEffect<ISetAddressViewEffect, void>("setAddressView");

export const setAddressView = (view: IAddressView | null) => setView({ View: view });

export const addressViewImpl = implementation(addressView, (): IAddressView | null => {
  const params = new URL(location.href).searchParams;
  const page = params.get("settings");
  if (page !== null) return { Kind: "settings", Page: page };
  return params.has("usage") ? { Kind: "usage" } : null;
});

export const setAddressViewImpl = implementation(setView, (effect) => {
  const url = new URL(location.href);
  url.searchParams.delete("settings");
  url.searchParams.delete("usage");
  if (effect.View?.Kind === "settings") url.searchParams.set("settings", effect.View.Page);
  if (effect.View?.Kind === "usage") url.searchParams.set("usage", "");
  history.replaceState(null, "", url);
});
