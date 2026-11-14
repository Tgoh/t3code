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
