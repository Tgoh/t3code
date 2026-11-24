import { filePreviewKind } from "@t3tools/shared/filePreview";
import { type IEntity, type IOpenGenerator, latest, open } from "treflex";

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
  /** Counts the workspace changes seen since the file opened, which media URLs key on. */
  Revision: number;
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

function* readFile(draft: IFilePanel, source: IFileSource): IOpenGenerator<IFileRead> {
  try {
    if (source.Kind === "workspace") {
      return yield* open(
        readProjectFileEffect({
          EnvironmentId: draft.EnvironmentId,
          Cwd: source.Cwd,
          Path: source.Path,
        }),
      );
    }
    const text = yield* open(
      assetTextEffect({
        EnvironmentId: draft.EnvironmentId,
        Resource: {
          _tag: "attachment",
          attachmentId: source.Id,
          fileName: source.Name,
          mimeType: source.MimeType,
          disposition: "inline",
        },
        SizeBytes: source.SizeBytes,
      }),
    );
    return { Kind: "attachment", Text: text.Text, Truncated: text.Truncated };
  } catch (error) {
    return { Kind: "failed", Message: serverError(error).message };
  }
}

function sameRead(held: IFileRead, next: IFileRead): boolean {
  if (held.Kind === "text" && next.Kind === "text") {
    return (
      held.Contents === next.Contents &&
      held.ByteLength === next.ByteLength &&
      held.Truncated === next.Truncated
    );
  }
  if (held.Kind === "attachment" && next.Kind === "attachment") {
    return held.Text === next.Text && held.Truncated === next.Truncated;
  }
  return false;
}

// Follows useProjectFileQuery in apps/web/src/components/files/projectFilesQueryState.ts and the
// branch order in FilePreviewPanel.tsx: a failed refresh keeps the last contents unless the path
// stopped being a file or turned binary.
export function keptRead(held: IFileRead | null, next: IFileRead): IFileRead | null {
  const shown = held?.Kind === "text" || held?.Kind === "attachment";
  if (held === null || !shown) return next;
  if (next.Kind === "failed") return held;
  if (next.Kind === "error") {
    return next.Failure === "path_not_file" || next.Failure === "binary_file" ? next : held;
  }
  return sameRead(held, next) ? held : next;
}

export function* loadFile(draft: IFilePanel): IOpenGenerator {
  if (!needsRead(draft.Source)) return;
  const read = yield* readFile(draft, draft.Source);
  const kept = keptRead(draft.Read, read);
  if (kept !== draft.Read) draft.Read = kept;
}
latest(loadFile);
