import * as Effect from "effect/Effect";
import { implementation } from "treflex";

import { fileAttachmentLimit } from "../attachmentIntake";
import { loadDescriptor } from "./connection";
import { environmentInfo } from "./environmentInfo";

const RETRY_MS = 1_000;

async function readInfo() {
  const response = await fetch("/api/auth/session");
  if (!response.ok) throw new Error(`Session check failed with HTTP ${response.status}.`);
  const [session, descriptor] = await Promise.all([
    response.json(),
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
