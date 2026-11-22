import type { BackgroundScope } from "@t3tools/contracts";
import { defineEffect, type IEffect } from "treflex";

export interface IDeviceActivity {
  Visible: boolean;
  Focused: boolean;
  RecentlyInteracted: boolean;
}

declare module "treflex" {
  interface IResourceTypeRegistry {
    deviceActivity: { Params: {}; Message: IDeviceActivity };
  }
}

export interface IReportActivity extends IEffect, IDeviceActivity {
  Type: "reportActivity";
  EnvironmentId: string;
  Scopes: BackgroundScope[];
}

/** Never fails: a lost report only lets the lease lapse until the next one. */
export const reportActivityEffect = defineEffect<IReportActivity, void>("reportActivity");
