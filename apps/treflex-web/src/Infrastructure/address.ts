import { defineEffect, type IEffect, implementation, type IResourceImplementation } from "treflex";

/** A page over the thread view; the thread stays in the address underneath it. */
export type IAddressView = { Kind: "settings"; Page: string } | { Kind: "usage" };

/** What the address holds: the thread, or the project whose new thread is open, and the page over it. */
export interface IAddress {
  Thread: string | null;
  NewThreadIn: string | null;
  View: IAddressView | null;
}

declare module "treflex" {
  interface IResourceTypeRegistry {
    addressHistory: { Params: {}; Message: { Address: IAddress } };
  }
}

interface IAddressEffect extends IEffect {
  Type: "address";
}

interface IWriteAddressEffect extends IEffect {
  Type: "writeAddress";
  Address: IAddress;
  Push: boolean;
}

export const address = defineEffect<IAddressEffect, IAddress>("address", { settles: "sync" });

export const writeAddressEffect = defineEffect<IWriteAddressEffect, void>("writeAddress");

const readAddress = (): IAddress => {
  const params = new URL(location.href).searchParams;
  const page = params.get("settings");
  return {
    Thread: params.get("thread"),
    NewThreadIn: params.get("new"),
    View:
      page !== null
        ? { Kind: "settings", Page: page }
        : params.has("usage")
          ? { Kind: "usage" }
          : null,
  };
};

export const addressImpl = implementation(address, readAddress);

export const writeAddressImpl = implementation(writeAddressEffect, ({ Address, Push }) => {
  const url = new URL(location.href);
  for (const key of ["thread", "new", "settings", "usage"]) url.searchParams.delete(key);
  if (Address.Thread !== null) url.searchParams.set("thread", Address.Thread);
  if (Address.NewThreadIn !== null) url.searchParams.set("new", Address.NewThreadIn);
  if (Address.View?.Kind === "settings") url.searchParams.set("settings", Address.View.Page);
  if (Address.View?.Kind === "usage") url.searchParams.set("usage", "");
  if (url.href === location.href) return;
  if (Push) history.pushState(null, "", url);
  else history.replaceState(null, "", url);
});

/** Reports the address the back and forward buttons move to. */
export const addressHistory: IResourceImplementation<"addressHistory"> = (_params, r) => {
  const onPop = () => void r.emit({ Address: readAddress() });
  window.addEventListener("popstate", onPop);
  r.signal.addEventListener("abort", () => window.removeEventListener("popstate", onPop));
};
