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
import type { IStoredAttachment } from "./draftMemory";
import { connectionRuntime } from "./connection";
import { serverFailure, serverFetch, settle } from "./serverError";

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
        stored(ids: string[]): IStoredAttachment[];
        restore(files: IStoredAttachment[]): IPickedFile[];
        recall(attachments: IWireAttachment[]): IPickedFile[];
      };
      Supply: ReadonlyArray<IAdmittedFile>;
      SupplyResponse: IPickedFile[];
    };
  }
}

interface IHeldFile {
  Kind: IAttachmentKind;
  File: File | null;
  PastedText: boolean;
  Name: string;
  MimeType: string;
  SizeBytes: number;
  PreviewUrl: string | null;
  DataUrl: string | null;
  Abort: AbortController;
  Minted: string | null;
  Upload: Promise<string>;
}

const MAX_UPLOADS = 3;

const readDataUrl = (file: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("Couldn't read the image."));
    reader.readAsDataURL(file);
  });

async function fileOfDataUrl(dataUrl: string, name: string, mimeType: string) {
  const blob = await (await fetch(dataUrl)).blob();
  return new File([blob], name, { type: mimeType });
}

export const composerFiles: IResourceImplementation<"composerFiles"> = (params, r) => {
  const environmentId = EnvironmentId.make(params.EnvironmentId);
  const held = new Map<string, IHeldFile>();
  let nextId = 0;
  let active = 0;
  const waiting: Array<() => void> = [];
  const rpc = <A, E>(effect: Effect.Effect<A, E, EnvironmentSupervisor.EnvironmentSupervisor>) =>
    settle(
      connectionRuntime.runPromiseExit(
        EnvironmentRegistry.EnvironmentRegistry.pipe(
          Effect.flatMap((registry) => registry.run(environmentId, effect)),
        ),
      ),
    );
  const deleteUpload = (attachmentId: string) =>
    void rpc(request(WS_METHODS.attachmentsDelete, { attachmentId })).catch(() => undefined);

  const transfer = async (entry: IHeldFile, file: File): Promise<string> => {
    if (active >= MAX_UPLOADS) await new Promise<void>((resolve) => waiting.push(resolve));
    active += 1;
    try {
      entry.Abort.signal.throwIfAborted();
      const name = entry.Name;
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
      const response = await serverFetch(minted.relativeUrl, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
        signal: entry.Abort.signal,
      });
      if (!response.ok) throw serverFailure(`Upload rejected (${response.status}).`);
      return minted.attachmentId;
    } finally {
      active -= 1;
      waiting.shift()?.();
    }
  };

  const startUpload = (entry: IHeldFile) => {
    const file = entry.File;
    if (file === null) throw serverFailure(`Attach ${entry.Name} again.`);
    if (entry.Minted !== null) deleteUpload(entry.Minted);
    entry.Minted = null;
    entry.Upload = transfer(entry, file);
    entry.Upload.catch(() => undefined);
  };

  const hold = (entry: IHeldFile): IPickedFile => {
    const id = `file-${(nextId += 1)}`;
    held.set(id, entry);
    return {
      Id: id,
      Kind: entry.Kind,
      Name: entry.Name,
      MimeType: entry.MimeType,
      SizeBytes: entry.SizeBytes,
      PastedText: entry.PastedText,
      PreviewUrl: entry.PreviewUrl,
    };
  };

  const heldFile = (
    kind: IAttachmentKind,
    file: File | null,
    described: Pick<IHeldFile, "Name" | "MimeType" | "SizeBytes" | "PastedText">,
  ): IHeldFile => ({
    ...described,
    Kind: kind,
    File: file,
    PreviewUrl: kind === "image" && file !== null ? URL.createObjectURL(file) : null,
    DataUrl: null,
    Abort: new AbortController(),
    Minted: null,
    Upload: Promise.resolve(""),
  });

  const storedOf = async (entry: IHeldFile): Promise<IStoredAttachment | null> => {
    const described = {
      Kind: entry.Kind,
      Name: entry.Name,
      MimeType: entry.MimeType,
      SizeBytes: entry.SizeBytes,
      PastedText: entry.PastedText,
    };
    try {
      if (entry.Kind === "image" && entry.File !== null) {
        entry.DataUrl ??= await readDataUrl(entry.File);
        return { ...described, DataUrl: entry.DataUrl };
      }
      return { ...described, AttachmentId: await entry.Upload };
    } catch {
      return null;
    }
  };

  const restoreOne = async (stored: IStoredAttachment): Promise<IHeldFile | null> => {
    if (stored.DataUrl !== undefined) {
      const file = await fileOfDataUrl(stored.DataUrl, stored.Name, stored.MimeType).catch(
        () => null,
      );
      if (file === null) return null;
      const entry = heldFile(stored.Kind, file, stored);
      entry.DataUrl = stored.DataUrl;
      startUpload(entry);
      return entry;
    }
    if (stored.AttachmentId === undefined) return null;
    const entry = heldFile(stored.Kind, null, stored);
    entry.Minted = stored.AttachmentId;
    entry.Upload = Promise.resolve(stored.AttachmentId);
    return entry;
  };

  // Follows prepareRevertedMessageAttachments in apps/web/src/components/ChatView.logic.ts.
  const download = async (attachment: IWireAttachment): Promise<IHeldFile> => {
    if (attachment.type !== "image" && attachment.type !== "file") {
      throw serverFailure("This message has an attachment that cannot be restored.");
    }
    const { relativeUrl } = await rpc(
      request(WS_METHODS.assetsCreateUrl, {
        resource: {
          _tag: "attachment",
          attachmentId: attachment.id,
          fileName: attachment.name,
          mimeType: attachment.mimeType,
        },
      }),
    );
    const response = await serverFetch(relativeUrl, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw serverFailure(`Could not restore attachment: ${attachment.name}`);
    const file = new File([await response.blob()], attachment.name, {
      type: attachment.mimeType,
    });
    const pastedText =
      "source" in attachment &&
      attachment.source !== undefined &&
      "_tag" in attachment.source &&
      attachment.source._tag === "pasted-text";
    return heldFile(attachment.type, file, {
      Name: attachment.name,
      MimeType: attachment.mimeType,
      SizeBytes: file.size,
      PastedText: pastedText,
    });
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
    admitted.map(({ Kind, File: file, PastedText }) => {
      const entry = heldFile(Kind, file, {
        Name: file.name || Kind,
        MimeType: file.type,
        SizeBytes: file.size,
        PastedText,
      });
      startUpload(entry);
      return hold(entry);
    }),
  );

  r.methods({
    upload: async (_ctx, id) => {
      const entry = held.get(id);
      if (entry === undefined) {
        throw serverFailure("That file is no longer held. Attach it again.");
      }
      let attachmentId: string;
      try {
        attachmentId = await entry.Upload;
      } catch {
        if (!held.has(id)) throw serverFailure("That file was removed during its upload.");
        startUpload(entry);
        attachmentId = await entry.Upload;
      }
      return {
        type: entry.Kind,
        id: attachmentId,
        name: entry.Name,
        mimeType: entry.MimeType,
        sizeBytes: entry.SizeBytes,
        ...(entry.PastedText ? { source: { _tag: "pasted-text" } } : {}),
      } as IWireAttachment;
    },
    remove: (_ctx, id) => release(id, true),
    forget: (_ctx, ids) => {
      for (const id of ids) release(id, false);
    },
    stored: async (_ctx, ids) => {
      const entries = ids.flatMap((id) => held.get(id) ?? []);
      const stored = await Promise.all(entries.map(storedOf));
      return stored.filter((file) => file !== null);
    },
    restore: async (_ctx, files) => {
      const entries = await Promise.all(files.map(restoreOne));
      return entries.filter((entry) => entry !== null).map(hold);
    },
    recall: async (_ctx, attachments) => {
      const entries = await Promise.all(attachments.map(download));
      for (const entry of entries) startUpload(entry);
      return entries.map(hold);
    },
  });
};
