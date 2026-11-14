import { defineEffect, type IEffect } from "treflex";

export interface IEnvironmentInfo {
  Authenticated: boolean;
  EnvironmentId: string;
  Label: string;
}

interface IEnvironmentInfoEffect extends IEffect {
  Type: "environmentInfo";
}

export const environmentInfo = defineEffect<IEnvironmentInfoEffect, IEnvironmentInfo>(
  "environmentInfo",
);
