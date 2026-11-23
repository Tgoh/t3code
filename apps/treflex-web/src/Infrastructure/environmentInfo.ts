import { defineEffect, type IEffect } from "treflex";

export interface IEnvironmentInfo {
  Authenticated: boolean;
  /** How this environment lets a browser pair, which the unpaired page describes. */
  BootstrapMethods: string[];
  EnvironmentId: string;
  Label: string;
  FileAttachmentLimit: number | null;
}

interface IEnvironmentInfoEffect extends IEffect {
  Type: "environmentInfo";
}

export const environmentInfo = defineEffect<IEnvironmentInfoEffect, IEnvironmentInfo>(
  "environmentInfo",
);
