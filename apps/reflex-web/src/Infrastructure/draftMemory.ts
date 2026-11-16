import { defineEffect, type IEffect, implementation } from "treflex";

import type { IAttachmentKind } from "../attachmentIntake";
import type { IWireModelSelection, IWireRuntimeMode } from "./commandEffects";

export interface IStoredDraft {
  Text: string;
  NewThreadProjectId: string | null;
  ModelSelection: IWireModelSelection | null;
  RuntimeMode: IWireRuntimeMode | null;
}

/** An image keeps its bytes, as stock's draft store does; a file keeps only its finished upload. */
export interface IStoredAttachment {
  Kind: IAttachmentKind;
  Name: string;
  MimeType: string;
  SizeBytes: number;
  PastedText: boolean;
  DataUrl?: string;
  AttachmentId?: string;
}

interface IStoredDraftEffect extends IEffect {
  Type: "storedDraft";
  ThreadId: string;
}

interface IStoredNewThreadEffect extends IEffect {
  Type: "storedNewThread";
  ProjectId: string;
}

interface IStoreDraftEffect extends IEffect {
  Type: "storeDraft";
  ThreadId: string;
  Draft: IStoredDraft | null;
}

interface IStoredDraftFilesEffect extends IEffect {
  Type: "storedDraftFiles";
  ThreadId: string;
}

interface IStoreDraftFilesEffect extends IEffect {
  Type: "storeDraftFiles";
  ThreadId: string;
  Files: IStoredAttachment[];
}

const TEXT_PREFIX = "reflex-web:draft:";
const FILES_PREFIX = "reflex-web:draft-files:";

export const storedDraftEffect = defineEffect<IStoredDraftEffect, IStoredDraft | null>(
  "storedDraft",
);
export const storedNewThreadEffect = defineEffect<IStoredNewThreadEffect, string | null>(
  "storedNewThread",
);
export const storeDraftEffect = defineEffect<IStoreDraftEffect, void>("storeDraft");
export const storedDraftFilesEffect = defineEffect<IStoredDraftFilesEffect, IStoredAttachment[]>(
  "storedDraftFiles",
);
export const storeDraftFilesEffect = defineEffect<IStoreDraftFilesEffect, void>("storeDraftFiles");

function readJson<T>(key: string): T | null {
  try {
    const held = localStorage.getItem(key);
    return held === null ? null : (JSON.parse(held) as T);
  } catch {
    return null;
  }
}

function write(key: string, value: unknown | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // A full store drops the write, as stock's draft store does; the draft stays on screen.
  }
}

export const storedDraftImpl = implementation(storedDraftEffect, (effect) =>
  readJson<IStoredDraft>(TEXT_PREFIX + effect.ThreadId),
);

export const storedNewThreadImpl = implementation(storedNewThreadEffect, (effect) => {
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key === null || !key.startsWith(TEXT_PREFIX)) continue;
    if (readJson<IStoredDraft>(key)?.NewThreadProjectId === effect.ProjectId) {
      return key.slice(TEXT_PREFIX.length);
    }
  }
  return null;
});

export const storeDraftImpl = implementation(storeDraftEffect, (effect) =>
  write(TEXT_PREFIX + effect.ThreadId, effect.Draft),
);

export const storedDraftFilesImpl = implementation(
  storedDraftFilesEffect,
  (effect) => readJson<IStoredAttachment[]>(FILES_PREFIX + effect.ThreadId) ?? [],
);

export const storeDraftFilesImpl = implementation(storeDraftFilesEffect, (effect) =>
  write(FILES_PREFIX + effect.ThreadId, effect.Files.length === 0 ? null : effect.Files),
);
