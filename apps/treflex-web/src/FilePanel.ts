import { filePreviewKind } from "@t3tools/shared/filePreview";
import { type IActionGenerator, type IEntity, latest } from "treflex";

import { attachmentNeedsText } from "./filePreview";
import {
  assetTextEffect,
  type IProjectFileRead,
  type IWireAttachment,
  readProjectFileEffect,
} from "./Infrastructure/commandEffects";
import { serverError } from "./Infrastructure/serverError";

export type IFileSource =
  | {
      Kind: "workspace";
      /** Workspace-relative, or an absolute host path for a file outside the workspace. */
      Path: string;
      Cwd: string;
    }
  | {
      Kind: "attachment";
      Id: string;
      Name: string;
      MimeType: string;
      SizeBytes: number;
    };

export type IFileRead =
  | IProjectFileRead
  | { Kind: "attachment"; Text: string; Truncated: boolean }
  | { Kind: "failed"; Message: string };

/** The file the right panel shows. Opening another replaces it, which stops its read. */
export interface IFilePanel extends IEntity {
  EnvironmentId: string;
  Source: IFileSource;
  RevealLine: number | null;
  /** Counts the opens that asked for `RevealLine`, so asking again scrolls back to it. */
  RevealId: number;
  /** Null until the first read lands; a reread keeps the last one shown. */
  Read: IFileRead | null;
}

export const attachmentSource = (attachment: IWireAttachment): IFileSource => ({
  Kind: "attachment",
  Id: attachment.id,
  Name: attachment.name,
  MimeType: attachment.mimeType,
  SizeBytes: attachment.sizeBytes,
});

export function needsRead(source: IFileSource): boolean {
  return (
    source.Kind === "workspace" ||
    attachmentNeedsText(filePreviewKind({ name: source.Name, mimeType: source.MimeType }))
  );
}

export function* loadFile(draft: IFilePanel): IActionGenerator {
  const source = draft.Source;
  if (!needsRead(source)) return;
  try {
    if (source.Kind === "workspace") {
      draft.Read = yield* readProjectFileEffect({
        EnvironmentId: draft.EnvironmentId,
        Cwd: source.Cwd,
        Path: source.Path,
      });
      return;
    }
    const text = yield* assetTextEffect({
      EnvironmentId: draft.EnvironmentId,
      Resource: {
        _tag: "attachment",
        attachmentId: source.Id,
        fileName: source.Name,
        mimeType: source.MimeType,
        disposition: "inline",
      },
      SizeBytes: source.SizeBytes,
    });
    draft.Read = { Kind: "attachment", Text: text.Text, Truncated: text.Truncated };
  } catch (error) {
    draft.Read = { Kind: "failed", Message: serverError(error).message };
  }
}
latest(loadFile);
