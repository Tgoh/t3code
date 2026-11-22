import { defineEffect, type IEffect } from "treflex";

export interface IEnvironmentInfo {
  Authenticated: boolean;
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
