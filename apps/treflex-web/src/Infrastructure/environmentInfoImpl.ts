import * as Effect from "effect/Effect";
import { implementation } from "treflex";

import { fileAttachmentLimit } from "../attachmentIntake";
import { loadDescriptor } from "./connection";
import { environmentInfo } from "./environmentInfo";

const RETRY_MS = 1_000;

async function readSession() {
  const response = await fetch("/api/auth/session");
  if (!response.ok) throw new Error(`Session check failed with HTTP ${response.status}.`);
  return response.json();
}

async function readInfo() {
  const [session, descriptor] = await Promise.all([
    readSession(),
    Effect.runPromise(loadDescriptor),
  ]);
  return {
    Authenticated: session.authenticated === true,
    EnvironmentId: descriptor.environmentId,
    Label: descriptor.label,
    FileAttachmentLimit: fileAttachmentLimit(descriptor.capabilities),
  };
}

export const environmentInfoImpl = implementation(environmentInfo, async () => {
  for (;;) {
    try {
      return await readInfo();
    } catch {
      await Effect.runPromise(Effect.sleep(RETRY_MS));
    }
  }
});
