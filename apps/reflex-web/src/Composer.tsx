import { formatAttachmentSize } from "@t3tools/client-runtime/state/attachments";
import { isPasteAsTextShortcut } from "@t3tools/client-runtime/text-paste";
import { useResource } from "treflex-solid";
import { createSignal, For, type JSX, onCleanup, onMount, Show } from "solid-js";

import {
  admitFiles,
  attachmentDetail,
  foldPastedText,
  shouldHandleAttachmentPaste,
  splitTransferredFiles,
} from "./attachmentIntake";
import { ModelPicker, PermissionsChip } from "./ComposerMenus";
import Environment from "./Environment";
import { ArrowUp, File as FileIcon, Paperclip, X } from "./icons";
import { cloneSendBlock, ProjectCloneBanner, useProjectClone } from "./ProjectClone";
import { StageArt } from "./StageArt";
import ThreadSession, { DEFAULT_RUNTIME_MODE } from "./ThreadSession";

const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);

function useAttachmentIntake() {
  const environment = Environment.use();
  const session = ThreadSession.use();
  const files = useResource(() => session.state, "Composer/Files");
  const addFiles = async (picked: File[], pastedText = false) => {
    if (picked.length === 0) return;
    const admitted = admitFiles(picked, {
      Reserved: session.state.Attachments.length,
      FileLimit: environment.state.FileAttachmentLimit,
      PastedText: pastedText,
    });
    const supplied = admitted.Accepted.length === 0 ? [] : await files.supply(admitted.Accepted);
    if (supplied === undefined) {
      session.addAttachments([], "Attachments aren't available right now. Try again.");
      return;
    }
    const pasted = pastedText ? supplied[0] : undefined;
    session.addAttachments(
      supplied,
      admitted.Error,
      pasted === undefined
        ? null
        : `Large paste attached as ${pasted.Name} (${formatAttachmentSize(pasted.SizeBytes)}). Use ${
            IS_MAC ? "⌘⇧V" : "Ctrl+Shift+V"
          } to keep a large paste inline.`,
    );
  };
  const addFolders = (folders: File[]) => {
    const folder = folders.at(-1);
    if (folder !== undefined) {
      session.addAttachments(
        [],
        `Couldn't get the path of "${folder.name}". Type its path instead.`,
      );
    }
  };
  return { files, addFiles, addFolders };
}

/** The thread's drop target for files, with stock's "Drop files to attach" overlay. */
export function FileDropSection(props: { children: JSX.Element }) {
  const intake = useAttachmentIntake();
  const [dragActive, setDragActive] = createSignal(false);
  const isFileDrag = (event: DragEvent) => event.dataTransfer?.types.includes("Files") === true;
  const movedWithin = (event: DragEvent & { currentTarget: HTMLElement }) =>
    event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget);
  onMount(() => {
    // Escape can cancel a drag without a dragleave.
    const clear = () => setDragActive(false);
    window.addEventListener("dragend", clear);
    window.addEventListener("drop", clear);
    onCleanup(() => {
      window.removeEventListener("dragend", clear);
      window.removeEventListener("drop", clear);
    });
  });
  return (
    <section
      class="thread"
      onDragEnter={(event) => {
        if (!isFileDrag(event)) return;
        event.preventDefault();
        if (!movedWithin(event)) setDragActive(true);
      }}
      onDragOver={(event) => {
        if (!isFileDrag(event)) return;
        event.preventDefault();
        event.dataTransfer!.dropEffect = "copy";
        setDragActive(true);
      }}
      onDragLeave={(event) => {
        if (!isFileDrag(event)) return;
        event.preventDefault();
        if (!movedWithin(event)) setDragActive(false);
      }}
      onDrop={(event) => {
        if (!isFileDrag(event)) return;
        event.preventDefault();
        setDragActive(false);
        const { files, folders } = splitTransferredFiles(event.dataTransfer!);
        intake.addFolders(folders);
        void intake.addFiles(files);
      }}
    >
      <Show when={dragActive()}>
        <div class="drop-overlay">
          <div role="status">
            <Paperclip />
            Drop files to attach
          </div>
        </div>
      </Show>
      {props.children}
    </section>
  );
}

export function Composer(props: { active?: boolean }) {
  const environment = Environment.use();
  const session = ThreadSession.use();
  const held = () => session.state;
  const intake = useAttachmentIntake();
  const files = intake.files;
  const images = () => held().Attachments.filter((file) => file.Kind === "image");
  const otherFiles = () => held().Attachments.filter((file) => file.Kind === "file");
  const [pasteAsTextUntil, setPasteAsTextUntil] = createSignal(0);
  const noProvider = () => environment.state.Replica.Providers.length === 0;
  const isDraft = () => held().NewThreadProjectId !== null;
  const stopping = () => session.stopRequested() || session.stopping();
  const clone = useProjectClone(() => session.projectId());
  const blocked = () => cloneSendBlock(clone());
  const canSend = () =>
    blocked() === null &&
    !session.sending() &&
    (held().Draft.trim() !== "" || held().Attachments.length > 0);
  const send = () => {
    if (blocked() === null) session.send();
  };

  const onPaste = (event: ClipboardEvent & { currentTarget: HTMLTextAreaElement }) => {
    const data = event.clipboardData;
    if (data === null) return;
    const bypass = event.timeStamp <= pasteAsTextUntil();
    setPasteAsTextUntil(0);
    const { files: pasted, folders } = splitTransferredFiles(data);
    const plainText = data.getData("text/plain");
    if (
      folders.length > 0 ||
      (pasted.length > 0 && shouldHandleAttachmentPaste({ files: pasted, plainText }))
    ) {
      event.preventDefault();
      intake.addFolders(folders);
      void intake.addFiles(pasted);
      return;
    }
    const textarea = event.currentTarget;
    const decision = foldPastedText({
      Text: plainText,
      Bypass: bypass,
      DraftLength: textarea.value.length,
      Selection: { start: textarea.selectionStart, end: textarea.selectionEnd },
      AttachedNames: held().Attachments.map((file) => file.Name),
      Reserved: held().Attachments.length,
      FileLimit: environment.state.FileAttachmentLimit,
    });
    if (decision.Kind === "inline") return;
    event.preventDefault();
    if (decision.Kind === "refuse") session.addAttachments([], decision.Error);
    else void intake.addFiles([decision.File], true);
  };

  return (
    <>
      <Show when={blocked() !== null && clone()}>
        {(shown) => <ProjectCloneBanner clone={shown()} />}
      </Show>
      <form
        class="composer"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <Show when={images().length > 0}>
          <ul class="attachment-thumbs">
            <For each={images()}>
              {(file) => (
                <li>
                  <Show when={file.PreviewUrl}>{(url) => <img src={url()} alt={file.Name} />}</Show>
                  <button
                    type="button"
                    aria-label={`Remove ${file.Name}`}
                    data-tip={`Remove ${file.Name}`}
                    onClick={() => session.removeAttachment(file.Id)}
                  >
                    <X />
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Show>
        <Show when={otherFiles().length > 0}>
          <ul class="attachment-files">
            <For each={otherFiles()}>
              {(file) => (
                <li>
                  <FileIcon />
                  <span class="attachment-file-name">
                    {file.PastedText ? "Pasted text" : file.Name}
                  </span>
                  <span class="attachment-file-detail">
                    {attachmentDetail(file.Name, file.SizeBytes, file.PastedText)}
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove ${file.Name}`}
                    data-tip={`Remove ${file.Name}`}
                    onClick={() => session.removeAttachment(file.Id)}
                  >
                    <X />
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Show>
        <Show when={held().AttachmentError}>
          <p class="composer-error">{held().AttachmentError}</p>
        </Show>
        <Show when={held().AttachmentNotice}>
          <p class="composer-notice">{held().AttachmentNotice}</p>
        </Show>
        <textarea
          rows={2}
          placeholder={
            noProvider() ? "Enable a provider in Settings to send a message" : "Ask anything."
          }
          value={held().Draft}
          onInput={(event) => session.setDraft(event.currentTarget.value)}
          onPaste={onPaste}
          onKeyDown={(event) => {
            if (isPasteAsTextShortcut(event, IS_MAC)) setPasteAsTextUntil(event.timeStamp + 1_000);
            if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
            event.preventDefault();
            send();
          }}
        />
        <Show when={held().SendError}>
          <p class="composer-error">Couldn't send: {held().SendError}</p>
        </Show>
        <Show when={held().StopError}>
          <p class="composer-error">Couldn't stop: {held().StopError}</p>
        </Show>
        <Show when={held().ModelError}>
          <p class="composer-error">{held().ModelError}</p>
        </Show>
        <div class="composer-bar">
          <label class="icon-button attach" data-tip="Attach files">
            <Paperclip />
            <input
              type="file"
              aria-label="Attach files"
              multiple
              disabled={files.status().State !== "live"}
              onChange={(event) => {
                void intake.addFiles(Array.from(event.currentTarget.files ?? []));
                event.currentTarget.value = "";
              }}
            />
          </label>
          <span class="composer-spacer" />
          <ModelPicker />
          <Show when={!isDraft() && session.effectiveRuntimeMode() !== DEFAULT_RUNTIME_MODE}>
            <PermissionsChip />
          </Show>
          <Show when={props.active}>
            <button
              type="button"
              class="round-button stop"
              aria-label={stopping() ? "Stopping" : "Stop generation"}
              data-tip={stopping() ? "Stopping" : "Stop generation"}
              disabled={stopping()}
              onClick={() => session.stopRun()}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                <rect x="2" y="2" width="8" height="8" rx="1.5" />
              </svg>
            </button>
          </Show>
          <Show when={!props.active || canSend()}>
            <button
              type="submit"
              class="round-button send"
              aria-label={session.sending() ? "Sending" : "Submit message"}
              data-tip={blocked() ?? undefined}
              disabled={!canSend()}
            >
              <span class="send-art">
                <StageArt compact />
              </span>
              <ArrowUp />
            </button>
          </Show>
        </div>
      </form>
      <Show when={isDraft()}>
        <div class="composer-context">
          <PermissionsChip context />
        </div>
      </Show>
    </>
  );
}
