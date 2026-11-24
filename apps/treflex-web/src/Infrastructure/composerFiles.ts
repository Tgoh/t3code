// @effect-diagnostics globalTimers:off -- A resource's progress delay, outside any Effect runtime.
import {
  EnvironmentRegistry,
  type EnvironmentSupervisor,
} from "@t3tools/client-runtime/connection";
import { request } from "@t3tools/client-runtime/rpc";
import {
  type AttachmentCreateUploadUrlInput,
  EnvironmentId,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  PROVIDER_SEND_TURN_SUPPORTED_IMAGE_MIME_TYPES,
  WS_METHODS,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type { IResourceImplementation } from "treflex";

import { attachmentKey, type IAdmittedFile, type IAttachmentKind } from "../attachmentIntake";
import { errorText } from "../errorText";
import type { IWireAttachment } from "./commandEffects";
import { type IStoredAttachment, storedDraftFiles } from "./draftMemory";
import { connectionRuntime } from "./connection";
import { prepareImageForAttachment } from "./imagePreparation";
import { randomId } from "./randomId";
import { serverFailure, serverFetch, settle } from "./serverError";

export interface IPickedFile {
  Id: string;
  Kind: IAttachmentKind;
  Name: string;
  MimeType: string;
  SizeBytes: number;
  PastedText: boolean;
}

export type IFileStatus =
  | { Phase: "uploading"; Progress: number }
  | { Phase: "failed"; Error: string };

export interface IComposerFilesView {
  Preparing: Array<{ Id: string; Name: string }>;
  Status: Record<string, IFileStatus>;
  /** Image previews by attachment id; they don't outlive this instance. */
  Previews: Record<string, string>;
}

declare module "treflex" {
  interface IResourceTypeRegistry {
    composerFiles: {
      Params: { EnvironmentId: string; ThreadId: string };
      Value: IComposerFilesView;
      /** The kept files an open couldn't hold again. */
      Message: { Lost: string[] };
      Methods: {
        upload(id: string): IWireAttachment;
        retry(id: string): void;
        remove(id: string): void;
        forget(ids: string[]): void;
        stored(ids: string[]): IStoredAttachment[];
        recall(attachments: IWireAttachment[]): IPickedFile[];
      };
      Supply: ReadonlyArray<IAdmittedFile>;
      /** `Preparing` counts the images other supplies are still preparing. */
      SupplyResponse: { Picked: IPickedFile[]; Error: string | null; Preparing: number };
    };
  }
}

interface IHeldFile {
  Id: string;
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
  Keys: string[];
  Status: IFileStatus | null;
  ShowProgress: boolean;
}

const MAX_UPLOADS = 3;
const UPLOAD_TIMEOUT_MS = 5 * 60_000;
const PROGRESS_DELAY_MS = 150;
const PROGRESS_STEPS = 20;

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

async function keyOf(kind: IAttachmentKind, file: File): Promise<string> {
  if (kind !== "image") return attachmentKey(kind, file);
  const bytes = await file.arrayBuffer().catch(() => null);
  return attachmentKey(kind, file, bytes === null ? undefined : new Uint8Array(bytes));
}

// Follows uploadBytes in apps/web/src/lib/attachmentUploadQueue.ts; fetch reports no upload progress.
function postFile(
  url: string,
  file: File,
  signal: AbortSignal,
  onProgress: (progress: number) => void,
): Promise<void> {
  const xhr = new XMLHttpRequest();
  return new Promise<void>((resolve, reject) => {
    xhr.open("POST", url, true);
    xhr.timeout = UPLOAD_TIMEOUT_MS;
    xhr.setRequestHeader("Content-Type", file.type);
    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total);
    });
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(serverFailure(`Upload rejected (${xhr.status}).`));
    });
    xhr.addEventListener("error", () => reject(serverFailure("Upload failed.")));
    xhr.addEventListener("timeout", () => reject(serverFailure("Upload timed out.")));
    xhr.addEventListener("abort", () => reject(signal.reason));
    signal.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(file);
  });
}

export const composerFiles: IResourceImplementation<"composerFiles"> = (params, r) => {
  const environmentId = EnvironmentId.make(params.EnvironmentId);
  const held = new Map<string, IHeldFile>();
  const preparing = new Map<string, string>();
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

  const show = () => {
    if (r.signal.aborted) return;
    const status: Record<string, IFileStatus> = {};
    const previews: Record<string, string> = {};
    for (const [id, entry] of held) {
      if (entry.PreviewUrl !== null) previews[id] = entry.PreviewUrl;
      if (entry.Status === null) continue;
      if (entry.Status.Phase === "uploading" && !entry.ShowProgress) continue;
      status[id] = entry.Status;
    }
    r.expose({
      Preparing: Array.from(preparing, ([Id, Name]) => ({ Id, Name })),
      Status: status,
      Previews: previews,
    });
  };
  show();

  const isHeld = (keys: ReadonlyArray<string>) => {
    for (const entry of held.values()) {
      if (entry.Keys.some((key) => keys.includes(key))) return true;
    }
    return false;
  };

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
      let step = 0;
      await postFile(minted.relativeUrl, file, entry.Abort.signal, (progress) => {
        const next = Math.floor(progress * PROGRESS_STEPS);
        if (next === step || entry.Abort.signal.aborted) return;
        step = next;
        entry.Status = { Phase: "uploading", Progress: progress };
        if (entry.ShowProgress) show();
      });
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
    entry.Status = { Phase: "uploading", Progress: 0 };
    entry.ShowProgress = false;
    const reveal = setTimeout(() => {
      entry.ShowProgress = true;
      show();
    }, PROGRESS_DELAY_MS);
    const upload = transfer(entry, file);
    entry.Upload = upload;
    upload.then(
      () => {
        clearTimeout(reveal);
        if (entry.Upload !== upload) return;
        entry.Status = null;
        show();
      },
      (error: unknown) => {
        clearTimeout(reveal);
        if (entry.Upload !== upload || entry.Abort.signal.aborted) return;
        entry.Status = { Phase: "failed", Error: errorText(error) };
        show();
      },
    );
  };

  const hold = (entry: IHeldFile): IPickedFile => {
    held.set(entry.Id, entry);
    return {
      Id: entry.Id,
      Kind: entry.Kind,
      Name: entry.Name,
      MimeType: entry.MimeType,
      SizeBytes: entry.SizeBytes,
      PastedText: entry.PastedText,
    };
  };

  const heldFile = (
    kind: IAttachmentKind,
    file: File | null,
    described: Pick<IHeldFile, "Name" | "MimeType" | "SizeBytes" | "PastedText">,
    keys: string[],
    id: string = randomId(),
  ): IHeldFile => ({
    ...described,
    Id: id,
    Kind: kind,
    File: file,
    PreviewUrl: kind === "image" && file !== null ? URL.createObjectURL(file) : null,
    DataUrl: null,
    Abort: new AbortController(),
    Minted: null,
    Upload: Promise.resolve(""),
    Keys: keys,
    Status: null,
    ShowProgress: false,
  });

  const storedOf = async (entry: IHeldFile): Promise<IStoredAttachment | null> => {
    const described = {
      Id: entry.Id,
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
      const keys = [await keyOf(stored.Kind, file)];
      const entry = heldFile(stored.Kind, file, stored, keys, stored.Id);
      entry.DataUrl = stored.DataUrl;
      startUpload(entry);
      return entry;
    }
    if (stored.AttachmentId === undefined) return null;
    const key = attachmentKey(stored.Kind, {
      name: stored.Name,
      type: stored.MimeType,
      size: stored.SizeBytes,
    });
    const entry = heldFile(stored.Kind, null, stored, [key], stored.Id);
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
    return heldFile(
      attachment.type,
      file,
      {
        Name: attachment.name,
        MimeType: attachment.mimeType,
        SizeBytes: file.size,
        PastedText: pastedText,
      },
      [await keyOf(attachment.type, file)],
    );
  };

  const release = (id: string, discard: boolean) => {
    if (preparing.delete(id)) show();
    const entry = held.get(id);
    if (entry === undefined) return;
    held.delete(id);
    if (entry.PreviewUrl) URL.revokeObjectURL(entry.PreviewUrl);
    if (entry.Status !== null || entry.PreviewUrl !== null) show();
    if (!discard) return;
    entry.Abort.abort();
    if (entry.Minted !== null) deleteUpload(entry.Minted);
  };

  r.signal.addEventListener("abort", () => {
    preparing.clear();
    for (const id of Array.from(held.keys())) release(id, true);
  });

  // Holds what the thread's draft kept, under the ids its state has.
  const kept = storedDraftFiles(params.ThreadId);
  const restored = Promise.all(kept.map((stored) => restoreOne(stored).catch(() => null))).then(
    (entries) => {
      const lost: string[] = [];
      for (const [index, entry] of entries.entries()) {
        if (entry === null) lost.push(kept[index]!.Id);
        else if (r.signal.aborted) {
          entry.Abort.abort();
          if (entry.PreviewUrl) URL.revokeObjectURL(entry.PreviewUrl);
        } else hold(entry);
      }
      show();
      if (lost.length > 0 && !r.signal.aborted) void r.emit({ Lost: lost });
    },
  );

  /** Fits an image to the provider's limits; null drops it as a repeat or a removal. */
  const prepareImage = async (id: string, source: File): Promise<IHeldFile | string | null> => {
    if (!preparing.has(id)) return null;
    const sourceKey = await keyOf("image", source);
    if (isHeld([sourceKey])) return null;
    const prepared = await prepareImageForAttachment(source, PROVIDER_SEND_TURN_MAX_IMAGE_BYTES);
    if (!preparing.has(id)) return null;
    if (!prepared.ok) {
      return prepared.reason === "unreadable"
        ? `'${source.name}' could not be read as an image.`
        : `'${source.name}' is too large to attach, even after compression.`;
    }
    const file = prepared.file;
    const keys = file === source ? [sourceKey] : [sourceKey, await keyOf("image", file)];
    if (!preparing.has(id) || isHeld(keys)) return null;
    const name = file.name || "image";
    return heldFile(
      "image",
      file,
      { Name: name, MimeType: file.type, SizeBytes: file.size, PastedText: false },
      keys,
      id,
    );
  };

  r.onSupply(async (admitted) => {
    await restored;
    const ids = admitted.map(({ Kind, File: file }) => {
      const id = randomId();
      if (Kind === "image") preparing.set(id, file.name || "image");
      return id;
    });
    if (preparing.size > 0) show();
    const picked: IPickedFile[] = [];
    let error: string | null = null;
    for (const [index, { Kind, File: file, PastedText }] of admitted.entries()) {
      const id = ids[index]!;
      if (Kind === "file") {
        const key = attachmentKey(Kind, file);
        if (isHeld([key])) continue;
        const described = { Name: file.name || Kind, MimeType: file.type, SizeBytes: file.size };
        const entry = heldFile(Kind, file, { ...described, PastedText }, [key], id);
        picked.push(hold(entry));
        startUpload(entry);
        continue;
      }
      const prepared = await prepareImage(id, file).catch(
        () => `'${file.name}' could not be read as an image.`,
      );
      if (typeof prepared === "string") error = prepared;
      else if (prepared !== null) {
        picked.push(hold(prepared));
        startUpload(prepared);
      }
    }
    for (const id of ids) preparing.delete(id);
    show();
    return {
      Picked: picked.filter((file) => held.has(file.Id)),
      Error: error,
      Preparing: preparing.size,
    };
  });

  r.methods({
    upload: async (_ctx, id) => {
      await restored;
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
    retry: async (_ctx, id) => {
      await restored;
      const entry = held.get(id);
      if (entry?.Status?.Phase === "failed") startUpload(entry);
    },
    remove: async (_ctx, id) => {
      await restored;
      release(id, true);
    },
    forget: async (_ctx, ids) => {
      await restored;
      for (const id of ids) release(id, false);
    },
    stored: async (_ctx, ids) => {
      await restored;
      const entries = ids.flatMap((id) => held.get(id) ?? []);
      const stored = await Promise.all(entries.map(storedOf));
      return stored.filter((file) => file !== null);
    },
    recall: async (_ctx, attachments) => {
      const entries = await Promise.all(attachments.map(download));
      const picked = entries.map(hold);
      for (const entry of entries) startUpload(entry);
      show();
      return picked;
    },
  });
};
