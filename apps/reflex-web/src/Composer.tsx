import { formatAttachmentSize } from "@t3tools/client-runtime/state/attachments";
import { resolveComposerDispatchMode } from "@t3tools/client-runtime/state/composer-dispatch";
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
import { ComposerCommandMenu, useComposerMenu } from "./ComposerCommandMenu";
import { ModelPicker, PermissionsChip } from "./ComposerMenus";
import { applyMenuItem, type IMenuItem, MENU_PLACEHOLDER } from "./composerMenu";
import Environment from "./Environment";
import {
  ArrowUp,
  ChevronLeft,
  CornerUpRight,
  File as FileIcon,
  ListPlus,
  Paperclip,
  X,
} from "./icons";
import { cloneSendBlock, ProjectCloneBanner, useProjectClone } from "./ProjectClone";
import { caretOnEdge, type IPromptHistoryPosition, stepPromptHistory } from "./promptHistory";
import { advanceLabel, answerPlaceholder, type IAnswering } from "./questions";
import { StageArt } from "./StageArt";
import ThreadSession, { DEFAULT_RUNTIME_MODE } from "./ThreadSession";
import { composerCollapses, createMediaQuery, PHONE_QUERY } from "./viewport";

const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);
const MOD_LABEL = IS_MAC ? "⌘" : "Ctrl";

const isAlternate = (event: MouseEvent | KeyboardEvent) => (IS_MAC ? event.metaKey : event.ctrlKey);

/** Holds whether ⌘ or Ctrl is down, so the send button can show what a click would do. */
function useAlternateHeld() {
  const [held, setHeld] = createSignal(false);
  onMount(() => {
    const update = (event: KeyboardEvent) => setHeld(isAlternate(event));
    const clear = () => setHeld(false);
    window.addEventListener("keydown", update);
    window.addEventListener("keyup", update);
    window.addEventListener("blur", clear);
    onCleanup(() => {
      window.removeEventListener("keydown", update);
      window.removeEventListener("keyup", update);
      window.removeEventListener("blur", clear);
    });
  });
  return held;
}

// Follows submitLabel and submitTooltip in apps/web/src/components/chat/ComposerPrimaryActions.tsx.
function SendButton(props: {
  running: boolean;
  alternate: boolean;
  sending: boolean;
  disabled: boolean;
  blocked: string | null;
  onSend: (alternate: boolean) => void;
}) {
  const mode = () =>
    resolveComposerDispatchMode({ running: props.running, alternateModifier: props.alternate });
  const label = () =>
    props.sending
      ? "Sending"
      : mode() === "queue"
        ? "Queue message"
        : mode() === "steer"
          ? "Steer message"
          : "Submit message";
  const tip = () =>
    props.blocked ??
    (props.running
      ? `Click to steer, ${MOD_LABEL}-click or ${MOD_LABEL}+Enter to queue`
      : undefined);
  return (
    <button
      type="submit"
      class="round-button send"
      aria-label={label()}
      data-tip={tip()}
      disabled={props.disabled}
      onPointerDown={(event) => event.preventDefault()}
      onClick={(event) => {
        event.preventDefault();
        props.onSend(isAlternate(event));
      }}
    >
      <span class="send-art">
        <StageArt compact />
      </span>
      <Show when={mode() !== "auto"} fallback={<ArrowUp />}>
        <Show when={mode() === "queue"} fallback={<CornerUpRight />}>
          <ListPlus />
        </Show>
      </Show>
    </button>
  );
}

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

function StopButton(props: { stopping: boolean; onStop: () => void }) {
  return (
    <button
      type="button"
      class="round-button stop"
      aria-label={props.stopping ? "Stopping" : "Stop generation"}
      data-tip={props.stopping ? "Stopping" : "Stop generation"}
      disabled={props.stopping}
      onPointerDown={(event) => event.preventDefault()}
      onClick={() => props.onStop()}
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
        <rect x="2" y="2" width="8" height="8" rx="1.5" />
      </svg>
    </button>
  );
}

// Follows the pending-question branch of ComposerPrimaryActions in apps/web/src/components/chat.
function AnswerActions(props: { question: IAnswering }) {
  const progress = () => props.question.progress();
  const responding = () => props.question.responding();
  return (
    <>
      <Show when={progress().QuestionIndex > 0}>
        <button
          type="button"
          class="button answer-previous"
          aria-label="Previous question"
          data-tip="Previous question"
          disabled={responding()}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => props.question.previous()}
        >
          <ChevronLeft />
        </button>
      </Show>
      <button
        type="submit"
        class="answer-submit"
        onPointerDown={(event) => event.preventDefault()}
        disabled={
          !props.question.canRespond() ||
          responding() ||
          (progress().IsLastQuestion ? progress().Answers === null : !progress().CanAdvance)
        }
      >
        {advanceLabel(progress(), responding())}
      </button>
    </>
  );
}

export function Composer(props: { active?: boolean; onSend?: () => void; question?: IAnswering }) {
  const environment = Environment.use();
  const session = ThreadSession.use();
  const held = () => session.state;
  const intake = useAttachmentIntake();
  const files = intake.files;
  const asked = () => {
    const question = props.question?.progress().Question;
    return question == null ? null : question;
  };
  const answering = () => (asked() === null ? undefined : props.question);
  const images = () =>
    answering() ? [] : held().Attachments.filter((file) => file.Kind === "image");
  const otherFiles = () =>
    answering() ? [] : held().Attachments.filter((file) => file.Kind === "file");
  const [pasteAsTextUntil, setPasteAsTextUntil] = createSignal(0);
  const noProvider = () => environment.state.Replica.Providers.length === 0;
  const placeholder = () => {
    const question = asked();
    if (question !== null) return answerPlaceholder(question);
    return noProvider() ? "Enable a provider in Settings to send a message" : MENU_PLACEHOLDER;
  };
  const text = () => answering()?.progress().CustomAnswer ?? held().Draft;
  const answerLocked = () => {
    const question = asked();
    return (
      question !== null && (question.allowCustomAnswer === false || !props.question!.canRespond())
    );
  };
  const isDraft = () => held().NewThreadProjectId !== null;
  const stopping = () => session.stopRequested() || session.stopping();
  const clone = useProjectClone(() => session.projectId());
  const blocked = () => cloneSendBlock(clone());
  const canSend = () =>
    blocked() === null &&
    !session.sending() &&
    (held().Draft.trim() !== "" || held().Attachments.length > 0);
  const phone = createMediaQuery(PHONE_QUERY);
  const [focused, setFocused] = createSignal(false);
  const collapsed = () =>
    !answering() &&
    composerCollapses({
      Phone: phone(),
      Focused: focused(),
      Draft: held().Draft,
      HasAttachments: held().Attachments.length > 0,
    });
  let form!: HTMLFormElement;
  let textarea!: HTMLTextAreaElement;
  // Focuses within the tap, since iOS raises the keyboard only for focus inside a user gesture.
  const expand = () => {
    setFocused(true);
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  };
  // A tap on a control would take focus from the prompt and drop the on-screen keyboard.
  const keepPromptFocus = (event: PointerEvent) => {
    if (phone() && event.target !== textarea) event.preventDefault();
  };
  const alternateHeld = useAlternateHeld();
  const running = () => props.active === true;
  const send = (alternate = false) => {
    const question = answering();
    if (question !== undefined) {
      question.advance();
      return;
    }
    if (blocked() !== null) return;
    if (canSend()) props.onSend?.();
    session.send(resolveComposerDispatchMode({ running: running(), alternateModifier: alternate }));
    if (phone()) textarea.blur();
  };

  const [cursor, setCursor] = createSignal(0);
  const trackCursor = () => setCursor(textarea.selectionStart);
  const menu = useComposerMenu(() => held().Draft, cursor);
  const replaceDraft = (text: string, caret: number) => {
    textarea.value = text;
    textarea.setSelectionRange(caret, caret);
    setCursor(caret);
    session.setDraft(text);
  };
  const pick = (item: IMenuItem) => {
    const trigger = menu.open();
    if (trigger === null) return;
    const next = applyMenuItem(held().Draft, trigger, item.Insert);
    replaceDraft(next.Text, next.Cursor);
    textarea.focus();
  };
  const onMenuKey = (event: KeyboardEvent): boolean => {
    if (!focused() || menu.open() === null || event.isComposing) return false;
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp":
        if (menu.items().length === 0) return false;
        menu.move(event.key === "ArrowDown" ? 1 : -1);
        return true;
      case "Enter":
      case "Tab": {
        if (event.shiftKey) return false;
        const item = menu.highlighted();
        if (item === undefined) return false;
        pick(item);
        return true;
      }
      case "Escape":
        menu.dismiss();
        return true;
    }
    return false;
  };
  // Follows navigatePromptHistory in apps/web/src/components/chat/composerCommandKey.ts.
  const [historyPosition, setHistoryPosition] = createSignal<IPromptHistoryPosition | null>(null);
  const onHistoryKey = (event: KeyboardEvent): boolean => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return false;
    if (event.shiftKey || event.altKey || event.metaKey || event.ctrlKey || event.isComposing)
      return false;
    if (held().Attachments.length > 0) return false;
    const current = held().Draft;
    if (historyPosition() === null && current.length > 0) return false;
    const direction = event.key === "ArrowUp" ? "backward" : "forward";
    if (!caretOnEdge(current, textarea.selectionStart, textarea.selectionEnd, direction))
      return false;
    const step = stepPromptHistory({
      Direction: direction,
      Entries: session.promptHistory(),
      Position: historyPosition(),
      Current: current,
    });
    if (step === null) return false;
    setHistoryPosition(step.Position);
    replaceDraft(step.Prompt, step.Prompt.length);
    return true;
  };

  const onPaste = (event: ClipboardEvent & { currentTarget: HTMLTextAreaElement }) => {
    const data = event.clipboardData;
    if (data === null || answering()) return;
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
        ref={form}
        class="composer"
        classList={{ collapsed: collapsed() }}
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
        onFocusIn={() => setFocused(true)}
        onFocusOut={(event) => {
          const next = event.relatedTarget;
          if (next instanceof Node && form.contains(next)) return;
          // Menus portal out of the form, and an open one still belongs to the composer.
          if (document.querySelector("[data-popup]") !== null) return;
          setFocused(false);
        }}
      >
        <Show when={collapsed()}>
          <div class="composer-collapsed">
            <button
              type="button"
              class="composer-preview"
              classList={{ placeholder: held().Draft.trim() === "" }}
              aria-label="Expand composer"
              onPointerDown={(event) => event.preventDefault()}
              onClick={expand}
            >
              {held().Draft.trim() || placeholder()}
            </button>
            <Show
              when={props.active && !canSend()}
              fallback={
                <SendButton
                  running={running()}
                  alternate={alternateHeld()}
                  sending={session.sending()}
                  disabled={!canSend()}
                  blocked={null}
                  onSend={send}
                />
              }
            >
              <StopButton stopping={stopping()} onStop={() => session.stopRun()} />
            </Show>
          </div>
        </Show>
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
        <Show when={focused() && !answering() && menu.open()}>
          {(trigger) => <ComposerCommandMenu menu={menu} trigger={trigger()} onPick={pick} />}
        </Show>
        <textarea
          ref={textarea}
          rows={2}
          placeholder={placeholder()}
          value={text()}
          disabled={answerLocked()}
          onInput={(event) => {
            setCursor(event.currentTarget.selectionStart);
            const question = answering();
            if (question === undefined) session.setDraft(event.currentTarget.value);
            else question.setCustomAnswer(event.currentTarget.value);
          }}
          onKeyUp={trackCursor}
          onClick={trackCursor}
          onSelect={trackCursor}
          onPaste={onPaste}
          onKeyDown={(event) => {
            if (isPasteAsTextShortcut(event, IS_MAC)) setPasteAsTextUntil(event.timeStamp + 1_000);
            if (!answering() && (onMenuKey(event) || onHistoryKey(event))) {
              event.preventDefault();
              return;
            }
            if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
            event.preventDefault();
            send(isAlternate(event));
          }}
        />
        <Show when={held().SendError}>
          <p class="composer-error">Couldn't send: {held().SendError}</p>
        </Show>
        <Show when={held().StopError}>
          <p class="composer-error">Couldn't stop: {held().StopError}</p>
        </Show>
        <Show when={held().QueueError}>
          <p class="composer-error">Couldn't change the queue: {held().QueueError}</p>
        </Show>
        <Show when={held().ModelError}>
          <p class="composer-error">{held().ModelError}</p>
        </Show>
        <div class="composer-bar" onPointerDown={keepPromptFocus}>
          <Show when={!answering()}>
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
          </Show>
          <span class="composer-spacer" />
          <ModelPicker />
          <Show when={!isDraft() && session.effectiveRuntimeMode() !== DEFAULT_RUNTIME_MODE}>
            <PermissionsChip />
          </Show>
          <Show when={answering()}>{(question) => <AnswerActions question={question()} />}</Show>
          <Show when={props.active}>
            <StopButton stopping={stopping()} onStop={() => session.stopRun()} />
          </Show>
          <Show when={!answering() && (!props.active || canSend())}>
            <SendButton
              running={running()}
              alternate={alternateHeld()}
              sending={session.sending()}
              disabled={!canSend()}
              blocked={blocked()}
              onSend={send}
            />
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
