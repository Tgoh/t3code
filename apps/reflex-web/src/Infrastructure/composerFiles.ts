import {
  EnvironmentRegistry,
  type EnvironmentSupervisor,
} from "@t3tools/client-runtime/connection";
import { request } from "@t3tools/client-runtime/rpc";
import {
  type AttachmentCreateUploadUrlInput,
  EnvironmentId,
  PROVIDER_SEND_TURN_SUPPORTED_IMAGE_MIME_TYPES,
  WS_METHODS,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type { IResourceImplementation } from "treflex";

import type { IAdmittedFile, IAttachmentKind } from "../attachmentIntake";
import type { IWireAttachment } from "./commandEffects";
import { connectionRuntime } from "./connection";

export interface IPickedFile {
  Id: string;
  Kind: IAttachmentKind;
  Name: string;
  MimeType: string;
  SizeBytes: number;
  PastedText: boolean;
  PreviewUrl: string | null;
}

declare module "treflex" {
  interface IResourceTypeRegistry {
    composerFiles: {
      Params: { EnvironmentId: string };
      Methods: {
        upload(id: string): IWireAttachment;
        remove(id: string): void;
        forget(ids: string[]): void;
      };
      Supply: ReadonlyArray<IAdmittedFile>;
      SupplyResponse: IPickedFile[];
    };
  }
}

interface IHeldFile extends IAdmittedFile {
  PreviewUrl: string | null;
  Abort: AbortController;
  Minted: string | null;
  Upload: Promise<string>;
}

const MAX_UPLOADS = 3;

export const composerFiles: IResourceImplementation<"composerFiles"> = (params, r) => {
  const environmentId = EnvironmentId.make(params.EnvironmentId);
  const held = new Map<string, IHeldFile>();
  let nextId = 0;
  let active = 0;
  const waiting: Array<() => void> = [];
  const rpc = <A, E>(effect: Effect.Effect<A, E, EnvironmentSupervisor.EnvironmentSupervisor>) =>
    connectionRuntime.runPromise(
      EnvironmentRegistry.EnvironmentRegistry.pipe(
        Effect.flatMap((registry) => registry.run(environmentId, effect)),
      ),
    );
  const deleteUpload = (attachmentId: string) =>
    void rpc(request(WS_METHODS.attachmentsDelete, { attachmentId })).catch(() => undefined);

  const transfer = async (entry: IHeldFile): Promise<string> => {
    if (active >= MAX_UPLOADS) await new Promise<void>((resolve) => waiting.push(resolve));
    active += 1;
    try {
      entry.Abort.signal.throwIfAborted();
      const file = entry.File;
      const name = file.name || entry.Kind;
      const input: AttachmentCreateUploadUrlInput =
        entry.Kind === "file"
          ? { type: "file", name, mimeType: file.type, sizeBytes: file.size }
          : {
              name,
              mimeType: file.type as (typeof PROVIDER_SEND_TURN_SUPPORTED_IMAGE_MIME_TYPES)[number],
              sizeBytes: file.size,
            };
      const minted = await rpc(request(WS_METHODS.attachmentsCreateUploadUrl, input));
      if (entry.Abort.signal.aborted) {
        deleteUpload(minted.attachmentId);
        entry.Abort.signal.throwIfAborted();
      }
      entry.Minted = minted.attachmentId;
      const response = await fetch(minted.relativeUrl, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
        signal: entry.Abort.signal,
      });
      if (!response.ok) throw new Error(`Upload rejected (${response.status}).`);
      return minted.attachmentId;
    } finally {
      active -= 1;
      waiting.shift()?.();
    }
  };

  const startUpload = (entry: IHeldFile) => {
    if (entry.Minted !== null) deleteUpload(entry.Minted);
    entry.Minted = null;
    entry.Upload = transfer(entry);
    entry.Upload.catch(() => undefined);
  };

  const release = (id: string, discard: boolean) => {
    const entry = held.get(id);
    if (entry === undefined) return;
    held.delete(id);
    if (entry.PreviewUrl) URL.revokeObjectURL(entry.PreviewUrl);
    if (!discard) return;
    entry.Abort.abort();
    if (entry.Minted !== null) deleteUpload(entry.Minted);
  };

  r.signal.addEventListener("abort", () => {
    for (const id of Array.from(held.keys())) release(id, true);
  });

  r.onSupply((admitted) =>
    admitted.map((admittedFile): IPickedFile => {
      const id = `file-${(nextId += 1)}`;
      const previewUrl =
        admittedFile.Kind === "image" ? URL.createObjectURL(admittedFile.File) : null;
      const entry: IHeldFile = {
        ...admittedFile,
        PreviewUrl: previewUrl,
        Abort: new AbortController(),
        Minted: null,
        Upload: Promise.resolve(""),
      };
      held.set(id, entry);
      startUpload(entry);
      return {
        Id: id,
        Kind: admittedFile.Kind,
        Name: admittedFile.File.name || admittedFile.Kind,
        MimeType: admittedFile.File.type,
        SizeBytes: admittedFile.File.size,
        PastedText: admittedFile.PastedText,
        PreviewUrl: previewUrl,
      };
    }),
  );

  r.methods({
    upload: async (_ctx, id) => {
      const entry = held.get(id);
      if (entry === undefined) throw new Error("That file is no longer held. Attach it again.");
      let attachmentId: string;
      try {
        attachmentId = await entry.Upload;
      } catch {
        if (!held.has(id)) throw new Error("That file was removed during its upload.");
        startUpload(entry);
        attachmentId = await entry.Upload;
      }
      return {
        type: entry.Kind,
        id: attachmentId,
        name: entry.File.name || entry.Kind,
        mimeType: entry.File.type,
        sizeBytes: entry.File.size,
        ...(entry.PastedText ? { source: { _tag: "pasted-text" } } : {}),
      } as IWireAttachment;
    },
    remove: (_ctx, id) => release(id, true),
    forget: (_ctx, ids) => {
      for (const id of ids) release(id, false);
    },
  });
};
