import {
  EnvironmentRegistry,
  type EnvironmentSupervisor,
} from "@t3tools/client-runtime/connection";
import { request } from "@t3tools/client-runtime/rpc";
import {
  EnvironmentId,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  PROVIDER_SEND_TURN_SUPPORTED_IMAGE_MIME_TYPES,
  WS_METHODS,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type { IResourceImplementation } from "treflex";

import type { IWireAttachment } from "./commandEffects";
import { connectionRuntime } from "./connection";

export type IPickedFile =
  | { Id: string; Name: string; MimeType: string; SizeBytes: number }
  | { Id: null; Name: string; Error: string };

declare module "treflex" {
  interface IResourceTypeRegistry {
    composerFiles: {
      Params: { EnvironmentId: string };
      Methods: {
        upload(id: string): IWireAttachment;
        remove(id: string): void;
        forget(ids: string[]): void;
      };
      Supply: ReadonlyArray<File>;
      SupplyResponse: IPickedFile[];
    };
  }
}

const SUPPORTED: ReadonlyArray<string> = PROVIDER_SEND_TURN_SUPPORTED_IMAGE_MIME_TYPES;

export const composerFiles: IResourceImplementation<"composerFiles"> = (params, r) => {
  const environmentId = EnvironmentId.make(params.EnvironmentId);
  const held = new Map<string, File>();
  const landed = new Map<string, string>();
  let nextId = 0;
  const rpc = <A, E>(effect: Effect.Effect<A, E, EnvironmentSupervisor.EnvironmentSupervisor>) =>
    connectionRuntime.runPromise(
      EnvironmentRegistry.EnvironmentRegistry.pipe(
        Effect.flatMap((registry) => registry.run(environmentId, effect)),
      ),
    );
  r.onSupply((files) =>
    files.map((file): IPickedFile => {
      if (!SUPPORTED.includes(file.type))
        return { Id: null, Name: file.name, Error: "Unsupported image type." };
      if (file.size === 0 || file.size > PROVIDER_SEND_TURN_MAX_IMAGE_BYTES)
        return { Id: null, Name: file.name, Error: "Images must be under 10 MB." };
      const id = `file-${(nextId += 1)}`;
      held.set(id, file);
      return { Id: id, Name: file.name, MimeType: file.type, SizeBytes: file.size };
    }),
  );
  r.methods({
    upload: async (_ctx, id) => {
      const file = held.get(id);
      if (file === undefined) throw new Error("That image is no longer held. Pick it again.");
      let attachmentId = landed.get(id);
      if (attachmentId === undefined) {
        const minted = await rpc(
          request(WS_METHODS.attachmentsCreateUploadUrl, {
            name: file.name,
            mimeType: file.type as (typeof PROVIDER_SEND_TURN_SUPPORTED_IMAGE_MIME_TYPES)[number],
            sizeBytes: file.size,
          }),
        );
        const response = await fetch(minted.relativeUrl, {
          method: "POST",
          headers: { "Content-Type": file.type },
          body: file,
          signal: r.signal,
        });
        if (!response.ok) throw new Error(`Upload rejected (${response.status}).`);
        attachmentId = minted.attachmentId;
        if (!held.has(id)) {
          void rpc(request(WS_METHODS.attachmentsDelete, { attachmentId })).catch(() => undefined);
          throw new Error("That image was removed during its upload.");
        }
        landed.set(id, attachmentId);
      }
      return {
        type: "image",
        id: attachmentId,
        name: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
      } as IWireAttachment;
    },
    remove: (_ctx, id) => {
      const attachmentId = landed.get(id);
      held.delete(id);
      landed.delete(id);
      if (attachmentId !== undefined) {
        void rpc(request(WS_METHODS.attachmentsDelete, { attachmentId })).catch(() => undefined);
      }
    },
    forget: (_ctx, ids) => {
      for (const id of ids) {
        held.delete(id);
        landed.delete(id);
      }
    },
  });
};
