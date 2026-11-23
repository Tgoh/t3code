import { formatAttachmentSize } from "@t3tools/client-runtime/state/attachments";
import {
  type ActiveTurnComposerAction,
  alternateComposerDispatchAction,
  resolveComposerDispatchMode,
} from "@t3tools/client-runtime/state/composer-dispatch";
import { isPasteAsTextShortcut } from "@t3tools/client-runtime/text-paste";
import { useInFlight, useResource } from "treflex-solid";
import { createSignal, For, type JSX, onCleanup, onMount, Show } from "solid-js";

import {
  admitFiles,
  attachmentDetail,
  foldPastedText,
  isImageOnlyClipboardHtml,
  shouldHandleAttachmentPaste,
  splitTransferredFiles,
} from "./attachmentIntake";
import { ComposerCommandMenu, useComposerMenu } from "./ComposerCommandMenu";
import {
  FOCUS_COMPOSER_EVENT,
  type ITypedText,
  TOGGLE_DICTATION_EVENT,
  TYPE_INTO_COMPOSER_EVENT,
} from "./composerFocus";
import { formatContextTokens } from "./compaction";
import { CompactToggle, ModelPicker, PermissionsChip } from "./ComposerMenus";
import { applyMenuItem, type IMenuItem, MENU_PLACEHOLDER } from "./composerMenu";
import Dictation, { dictationBusy } from "./Dictation";
import { DictationPill, DictationPreview, MicButton, useVoiceOffered } from "./DictationControls";
import Environment from "./Environment";
import {
  ArrowUp,
  ChevronLeft,
  CornerUpRight,
  File as FileIcon,
  ListPlus,
  Paperclip,
  RefreshCw,
  X,
} from "./icons";
import type { IFileStatus } from "./Infrastructure/composerFiles";
import { arrowStep } from "./listNavigation";
import { useNavigation } from "./navigation";
import { useOverlays } from "./overlays";
import { cloneSendBlock, ProjectCloneBanner, useProjectClone } from "./ProjectClone";
import { caretOnEdge, type IPromptHistoryPosition, stepPromptHistory } from "./promptHistory";
import { advanceLabel, answerPlaceholder, type IAnswering } from "./questions";
import { StageArt } from "./StageArt";
import ThreadSession, {
  DEFAULT_RUNTIME_MODE,
  editFromHere,
  send as sendAction,
} from "./ThreadSession";
import { Button, buttonVariants } from "./ui/Button";
import { Spinner } from "./ui/Spinner";
import {
  COARSE_POINTER_QUERY,
  composerCollapses,
  composerRequiresModifier,
  createMediaQuery,
  enterIsAlternate,
  enterSends,
  nextFrame,
  PHONE_QUERY,
  SHORT_TOUCH_QUERY,
} from "./viewport";

const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD_LABEL = IS_MAC ? "⌘" : "Ctrl";

export const isAlternate = (event: MouseEvent | KeyboardEvent) =>
  IS_MAC ? event.metaKey : event.ctrlKey;

/** The strip at the foot of a thread that holds the composer, measured as --composer-height.
 * navigation.ts and ViewportDebug.tsx find it by `composer-lane`, which has no rule. */
export const COMPOSER_LANE =
  "composer-lane pointer-events-none absolute inset-x-0 bottom-0 z-20 mx-auto max-w-[calc(var(--chat-content-max-width)+2*var(--gutter))] px-(--gutter) pt-0 pb-[calc(var(--composer-gap,21px)+var(--safe-bottom))] *:pointer-events-auto in-[.chat-stage.with-details]:max-w-[calc(min(var(--chat-content-max-width),var(--details-lane,100vw))+2*var(--gutter))] in-[.chat-stage.with-details]:[translate:var(--details-shift)_0]";

const ROUND_BUTTON =
  "relative isolate inline-flex size-8 flex-none cursor-pointer items-center justify-center overflow-hidden rounded-full border-0 p-0 text-white shadow-[0_1px_2px_rgb(0_0_0/24%)] disabled:cursor-default disabled:opacity-64 disabled:shadow-none";
const HIDDEN_COLLAPSED = "in-data-collapsed:hidden";

// iOS can fire mousedown after a prevented pointerdown, and its default blurs the prompt.
const keepFocus = (event: MouseEvent) => event.preventDefault();
const NOTE = "mx-4 my-1 text-[12px]";
const ERROR = `${NOTE} text-error-foreground ${HIDDEN_COLLAPSED}`;

function useFocusRequests(focus: () => void) {
  onMount(() => {
    window.addEventListener(FOCUS_COMPOSER_EVENT, focus);
    onCleanup(() => window.removeEventListener(FOCUS_COMPOSER_EVENT, focus));
  });
}

function useTypedText(take: (event: Event, typed: ITypedText) => void) {
  onMount(() => {
    const onTyped = (event: Event) => take(event, (event as CustomEvent<ITypedText>).detail);
    window.addEventListener(TYPE_INTO_COMPOSER_EVENT, onTyped);
    onCleanup(() => window.removeEventListener(TYPE_INTO_COMPOSER_EVENT, onTyped));
  });
}

function useDictationKeys(toggle: () => void, escape: (event: KeyboardEvent) => void) {
  onMount(() => {
    window.addEventListener(TOGGLE_DICTATION_EVENT, toggle);
    window.addEventListener("keydown", escape, true);
    onCleanup(() => {
      window.removeEventListener(TOGGLE_DICTATION_EVENT, toggle);
      window.removeEventListener("keydown", escape, true);
    });
  });
}

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

function SendButton(props: {
  running: boolean;
  alternate: boolean;
  followUp: ActiveTurnComposerAction;
  sending: boolean;
  disabled: boolean;
  blocked: string | null;
  /** The tokens this send compacts first, already formatted. */
  compacts: string | null;
  /** The Send shortcut asks for a modifier, which moves the alternate send to Shift with it. */
  shiftAlternate: boolean;
  label?: string | undefined;
  class: string;
  onSend: (alternate: boolean) => void;
}) {
  const mode = () =>
    resolveComposerDispatchMode({
      running: props.running,
      alternateModifier: props.alternate,
      activeTurnDefault: props.followUp,
    });
  const alternateAction = () => alternateComposerDispatchAction(props.followUp);
  const label = () =>
    props.sending
      ? "Sending"
      : (props.label ??
        (props.compacts !== null
          ? "Compact and send"
          : mode() === "queue"
            ? "Queue message"
            : mode() === "steer"
              ? "Steer message"
              : "Submit message"));
  const tip = () =>
    props.blocked ??
    (props.compacts !== null
      ? `Summarize ${props.compacts} tokens of history, then send`
      : props.running
        ? `Click to ${props.followUp}, ${MOD_LABEL}-click or ${MOD_LABEL}+${props.shiftAlternate ? "Shift+" : ""}Enter to ${alternateAction()}`
        : undefined);
  return (
    <button
      type="submit"
      class={`${ROUND_BUTTON} bg-transparent hover:enabled:brightness-110 ${props.class}`}
      aria-label={label()}
      aria-busy={props.sending || undefined}
      data-tip={tip()}
      disabled={props.disabled}
      onPointerDown={keepFocus}
      onMouseDown={keepFocus}
      onClick={(event) => {
        event.preventDefault();
        props.onSend(isAlternate(event));
      }}
    >
      <span class="pointer-events-none absolute inset-0 -z-10" aria-hidden="true">
        <StageArt compact />
      </span>
      <Show when={!props.sending} fallback={<Spinner size="sm" aria-hidden="true" />}>
        <Show when={mode() !== "auto"} fallback={<ArrowUp />}>
          <Show when={mode() === "queue"} fallback={<CornerUpRight />}>
            <ListPlus />
          </Show>
        </Show>
      </Show>
    </button>
  );
}

// Follows the upload overlays in apps/web/src/components/chat/ComposerAttachmentStrip.tsx.
function UploadStatus(props: {
  status: IFileStatus | undefined;
  name: string;
  tile?: boolean;
  onRetry: () => void;
}) {
  const progress = () => {
    const status = props.status;
    return status?.Phase === "uploading" ? `${Math.floor(status.Progress * 100)}%` : null;
  };
  const failure = () => {
    const status = props.status;
    return status?.Phase === "failed" ? status.Error : null;
  };
  return (
    <>
      <Show when={progress()}>
        {(label) => (
          <span
            class={
              props.tile
                ? "pointer-events-none absolute inset-x-0 bottom-0 bg-background/85 px-1 text-center text-3xs text-foreground"
                : "flex-none text-[12px] text-secondary-label tabular-nums"
            }
          >
            {label()}
          </span>
        )}
      </Show>
      <Show when={failure()}>
        {(error) => (
          <span class={props.tile ? "absolute bottom-1 left-1 flex" : "flex flex-none"}>
            <Button
              variant={props.tile ? "overlay" : "ghost"}
              size="icon-xs"
              aria-label={`Retry upload for ${props.name}`}
              data-tip={error()}
              onClick={() => props.onRetry()}
            >
              <RefreshCw />
            </Button>
          </span>
        )}
      </Show>
    </>
  );
}

function useAttachmentIntake() {
  const environment = Environment.use();
  const session = ThreadSession.use();
  const files = useResource(() => session.state, "Composer/Files");
  const addFiles = async (picked: File[], pastedText = false) => {
    if (picked.length === 0) return;
    const admitted = admitFiles(picked, {
      Reserved: session.state.Attachments.length + (files.value()?.Preparing.length ?? 0),
      FileLimit: environment.state.FileAttachmentLimit,
      PastedText: pastedText,
    });
    const others = admitted.Accepted.filter((file) => file.Kind === "file");
    const images = admitted.Accepted.filter((file) => file.Kind === "image");
    // Images prepare for seconds, so other files are supplied first and show at once.
    for (const group of [others, images]) {
      if (group.length === 0) continue;
      const supplied = await files.supply(group);
      if (supplied === undefined) {
        session.addAttachments([], "Attachments aren't available right now. Try again.");
        return;
      }
      const pasted = pastedText ? supplied.Picked[0] : undefined;
      session.addAttachments(
        supplied.Picked,
        supplied.Error ?? admitted.Error,
        pasted === undefined
          ? null
          : `Large paste attached as ${pasted.Name} (${formatAttachmentSize(pasted.SizeBytes)}). Use ${
              IS_MAC ? "⌘⇧V" : "Ctrl+Shift+V"
            } to keep a large paste inline.`,
      );
    }
    if (admitted.Accepted.length === 0) session.addAttachments([], admitted.Error);
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
      class="relative flex h-full min-w-0 flex-1 flex-col"
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
        <div class="pointer-events-none absolute inset-2 z-40 flex items-center justify-center rounded-2xl border-2 border-dashed border-primary/60 bg-primary/[0.035]">
          <div
            role="status"
            class="flex items-center gap-2 rounded-full border border-primary/25 bg-background/95 px-4 py-2.5 text-[14px] font-medium text-foreground shadow-[0_10px_15px_-3px_rgb(0_0_0/10%)] [&_svg]:text-primary"
          >
            <Paperclip />
            Drop files to attach
          </div>
        </div>
      </Show>
      {props.children}
    </section>
  );
}

function StopButton(props: { stopping: boolean; class: string; onStop: () => void }) {
  return (
    <button
      type="button"
      class={`${ROUND_BUTTON} bg-destructive/90 hover:enabled:bg-destructive ${props.class}`}
      aria-label={props.stopping ? "Stopping" : "Stop generation"}
      data-tip={props.stopping ? "Stopping" : "Stop generation"}
      disabled={props.stopping}
      onPointerDown={keepFocus}
      onMouseDown={keepFocus}
      onClick={() => props.onStop()}
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
        <rect x="2" y="2" width="8" height="8" rx="1.5" />
      </svg>
    </button>
  );
}

function AnswerActions(props: { question: IAnswering }) {
  const progress = () => props.question.progress();
  const responding = () => props.question.responding();
  return (
    <>
      <Show when={progress().QuestionIndex > 0}>
        <Button
          variant="outline"
          size="icon-sm"
          class="ml-[5px]"
          aria-label="Previous question"
          data-tip="Previous question"
          disabled={responding()}
          onPointerDown={keepFocus}
          onMouseDown={keepFocus}
          onClick={() => props.question.previous()}
        >
          <ChevronLeft class="size-3.5" />
        </Button>
      </Show>
      <button
        type="submit"
        class="ml-2 h-7 flex-none cursor-pointer whitespace-nowrap rounded-full border-0 bg-primary px-3 py-0 text-[14px] font-medium text-primary-foreground shadow-[0_1px_2px_color-mix(in_srgb,var(--primary)_24%,transparent)] hover:enabled:bg-[color-mix(in_srgb,var(--primary)_90%,var(--background))] disabled:cursor-default disabled:opacity-64 disabled:shadow-none"
        onPointerDown={keepFocus}
        onMouseDown={keepFocus}
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
  const sending = useInFlight(sendAction, () => session.state);
  const rewinding = useInFlight(editFromHere, () => session.state);
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
  const preparing = () => (answering() ? [] : (files.value()?.Preparing ?? []));
  const fileStatus = (id: string) => files.value()?.Status[id];
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
  const stopping = () => session.stoppingRun();
  const clone = useProjectClone(() => session.projectId());
  const blocked = () =>
    cloneSendBlock(clone()) ??
    ((files.value()?.Preparing.length ?? 0) > 0 ? "Waiting for images to finish preparing" : null);
  const canSend = () =>
    blocked() === null &&
    !sending() &&
    (held().Draft.trim() !== "" || held().Attachments.length > 0);
  const phone = createMediaQuery(`${PHONE_QUERY}, ${SHORT_TOUCH_QUERY}`);
  const [focused, setFocused] = createSignal(false);
  const overlays = useOverlays();
  const navigation = useNavigation();
  const voiceOffered = useVoiceOffered();
  const dictation = Dictation.use();
  const voice = () => dictation.recording();
  const ownsVoice = () => voice().ThreadId === held().ThreadId && voice().Phase !== "idle";
  const dictating = () => ownsVoice() && dictationBusy(voice().Phase);
  const voiceElsewhere = () => !ownsVoice() && dictationBusy(voice().Phase);
  const collapsed = () =>
    !answering() &&
    !ownsVoice() &&
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
  useFocusRequests(expand);
  // A tap on a control would take focus from the prompt and drop the on-screen keyboard.
  const keepPromptFocus = (event: MouseEvent) => {
    if (phone() && event.target !== textarea) event.preventDefault();
  };
  const collapseFrame = nextFrame();
  const collapseIfLeft = () => {
    if (form.contains(document.activeElement)) return;
    // Menus portal out of the form, and an open one still belongs to the composer.
    if (overlays.open()) return;
    setFocused(false);
  };
  const coarsePointer = createMediaQuery(COARSE_POINTER_QUERY);
  const alternateHeld = useAlternateHeld();
  const running = () => props.active === true;
  const requiresModifier = () => composerRequiresModifier(environment.sendShortcut(), held().Draft);
  const compactTokens = () => (answering() ? null : session.compactionOffer());
  const compacts = () => {
    const tokens = compactTokens();
    return tokens === null || held().KeepFullHistory ? null : formatContextTokens(tokens);
  };
  const send = (alternate = false) => {
    const question = answering();
    if (question !== undefined) {
      question.advance();
      return;
    }
    if (blocked() !== null) return;
    const mode = resolveComposerDispatchMode({
      running: running(),
      alternateModifier: alternate,
      activeTurnDefault: session.followUpBehavior(),
    });
    if (dictating()) {
      props.onSend?.();
      void dictation.sendAfterDictation(held().ThreadId, mode);
      return;
    }
    if (canSend()) props.onSend?.();
    session.send(mode);
    if (phone()) textarea.blur();
  };
  const startDictation = () => {
    const atCaret = document.activeElement === textarea;
    const text = held().Draft;
    void environment.startDictation(held().ThreadId, {
      Text: text,
      Start: atCaret ? textarea.selectionStart : text.length,
      End: atCaret ? textarea.selectionEnd : text.length,
    });
  };
  useDictationKeys(
    () => {
      if (answering() || !voiceOffered()) return;
      if (dictating()) {
        if (voice().Phase === "recording") void dictation.stopDictation();
      } else if (!voiceElsewhere()) startDictation();
    },
    (event) => {
      if (event.key !== "Escape" || !dictating() || event.defaultPrevented) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void dictation.cancelDictation();
    },
  );

  const [cursor, setCursor] = createSignal(0);
  const menu = useComposerMenu(() => held().Draft, cursor);
  const moveCaret = (text: string, caret: number) => {
    setCursor(caret);
    if (!answering()) menu.search(text, caret);
  };
  const trackCursor = () => moveCaret(textarea.value, textarea.selectionStart);
  const replaceDraft = (text: string, caret: number) => {
    textarea.value = text;
    textarea.setSelectionRange(caret, caret);
    moveCaret(text, caret);
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
        menu.move(arrowStep(event.key)!);
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
      (pasted.length > 0 &&
        shouldHandleAttachmentPaste({
          files: pasted,
          plainText,
          bypassAutoAttachment: bypass,
          htmlIsOnlyImage:
            plainText.length > 0 && isImageOnlyClipboardHtml(data.getData("text/html")),
        }))
    ) {
      event.preventDefault();
      intake.addFolders(folders);
      void intake.addFiles(pasted);
      return;
    }
    const textarea = event.currentTarget;
    const selection = { start: textarea.selectionStart, end: textarea.selectionEnd };
    if (foldPaste(plainText, bypass, selection)) event.preventDefault();
  };
  /** Turns a long paste into an attachment, and says whether it did instead of leaving it inline. */
  const foldPaste = (
    plainText: string,
    bypass: boolean,
    selection: { start: number; end: number },
  ): boolean => {
    const decision = foldPastedText({
      Text: plainText,
      Bypass: bypass,
      DraftLength: textarea.value.length,
      Selection: selection,
      AttachedNames: held().Attachments.map((file) => file.Name),
      Reserved: held().Attachments.length,
      FileLimit: environment.state.FileAttachmentLimit,
    });
    if (decision.Kind === "inline") return false;
    if (decision.Kind === "refuse") session.addAttachments([], decision.Error);
    else void intake.addFiles([decision.File], true);
    return true;
  };
  useTypedText((event, typed) => {
    if (rewinding() || textarea.disabled || textarea.readOnly) return;
    event.preventDefault();
    expand();
    const end = textarea.value.length;
    if (typed.Paste && !answering() && foldPaste(typed.Text, typed.Bypass, { start: end, end }))
      return;
    textarea.setRangeText(typed.Text, end, end, "end");
    textarea.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        inputType: typed.Paste ? "insertFromPaste" : "insertText",
        data: typed.Text,
      }),
    );
  });

  return (
    <>
      <Show when={cloneSendBlock(clone()) !== null && clone()}>
        {(shown) => <ProjectCloneBanner clone={shown()} />}
      </Show>
      <form
        ref={form}
        class="relative z-1 rounded-2xl border border-(--composer-outline) bg-[color-mix(in_srgb,var(--composer-surface)_var(--glass-opacity),transparent)] shadow-(--composer-shadow) backdrop-blur-(--glass-blur) backdrop-saturate-(--glass-saturation)"
        data-collapsed={collapsed() ? "" : undefined}
        inert={rewinding()}
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
        onFocusIn={() => setFocused(true)}
        onFocusOut={() => collapseFrame(collapseIfLeft)}
      >
        <Show when={collapsed()}>
          <div class="flex items-center gap-2 pt-2 pr-2 pl-3">
            <button
              type="button"
              class="min-w-0 flex-1 truncate border-0 bg-transparent p-0 text-left text-[14px] data-placeholder:text-muted-foreground"
              data-placeholder={held().Draft.trim() === "" ? "" : undefined}
              aria-label="Expand composer"
              onPointerDown={keepFocus}
              onMouseDown={keepFocus}
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
                  followUp={session.followUpBehavior()}
                  sending={sending()}
                  disabled={!canSend()}
                  blocked={null}
                  compacts={compacts()}
                  shiftAlternate={requiresModifier()}
                  // The collapsed composer hides the compact toggle, so it opens rather than sends.
                  label={compacts() === null ? undefined : "Open composer to compact and send"}
                  class="ml-0"
                  onSend={(alternate) => (compacts() === null ? send(alternate) : expand())}
                />
              }
            >
              <StopButton stopping={stopping()} class="ml-0" onStop={() => session.stopRun()} />
            </Show>
          </div>
        </Show>
        <Show when={images().length > 0 || preparing().length > 0}>
          <ul class={`m-0 flex list-none flex-wrap gap-2 px-3 pt-3 pb-0 ${HIDDEN_COLLAPSED}`}>
            <For each={images()}>
              {(file) => (
                <li class="relative size-14 overflow-hidden rounded-xl">
                  <Show when={file.PreviewUrl}>
                    {(url) => (
                      <img
                        src={url()}
                        alt={file.Name}
                        class="block size-full object-cover outline -outline-offset-1 outline-(--media-ring)"
                      />
                    )}
                  </Show>
                  <UploadStatus
                    status={fileStatus(file.Id)}
                    name={file.Name}
                    tile
                    onRetry={() => session.retryAttachment(file.Id)}
                  />
                  <span class="absolute right-1 top-1 flex">
                    <Button
                      variant="media-close"
                      size="icon-xs"
                      aria-label={`Remove ${file.Name}`}
                      data-tip={`Remove ${file.Name}`}
                      onClick={() => session.removeAttachment(file.Id)}
                    >
                      <X />
                    </Button>
                  </span>
                </li>
              )}
            </For>
            <For each={preparing()}>
              {(image) => (
                <li class="relative size-14 overflow-hidden rounded-xl bg-muted outline -outline-offset-1 outline-(--media-ring)">
                  <span class="pointer-events-none absolute inset-x-0 bottom-0 bg-background/85 px-1 text-center text-3xs text-foreground">
                    Preparing
                  </span>
                  <span class="absolute right-1 top-1 flex">
                    <Button
                      variant="media-close"
                      size="icon-xs"
                      aria-label={`Remove ${image.Name}`}
                      data-tip={`Remove ${image.Name}`}
                      onClick={() => session.removeAttachment(image.Id)}
                    >
                      <X />
                    </Button>
                  </span>
                </li>
              )}
            </For>
          </ul>
        </Show>
        <Show when={otherFiles().length > 0}>
          <ul
            class={`m-0 flex list-none flex-col gap-0.5 pt-2.5 pr-3 pb-0 pl-3.5 [&_svg]:size-3.5 ${HIDDEN_COLLAPSED}`}
          >
            <For each={otherFiles()}>
              {(file) => (
                <li class="flex min-w-0 items-center gap-2 text-[14px]">
                  <FileIcon />
                  <span class="min-w-0 flex-1 truncate">
                    {file.PastedText ? "Pasted text" : file.Name}
                  </span>
                  <span class="flex-none text-[12px] text-secondary-label">
                    {attachmentDetail(file.Name, file.SizeBytes, file.PastedText)}
                  </span>
                  <UploadStatus
                    status={fileStatus(file.Id)}
                    name={file.Name}
                    onRetry={() => session.retryAttachment(file.Id)}
                  />
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Remove ${file.Name}`}
                    data-tip={`Remove ${file.Name}`}
                    onClick={() => session.removeAttachment(file.Id)}
                  >
                    <X />
                  </Button>
                </li>
              )}
            </For>
          </ul>
        </Show>
        <Show when={held().AttachmentError}>
          <p class={ERROR}>{held().AttachmentError}</p>
        </Show>
        <Show when={held().AttachmentNotice}>
          <p class={`${NOTE} text-muted-foreground ${HIDDEN_COLLAPSED}`}>
            {held().AttachmentNotice}
          </p>
        </Show>
        <Show when={focused() && !answering() && menu.open()}>
          {(trigger) => <ComposerCommandMenu menu={menu} trigger={trigger()} onPick={pick} />}
        </Show>
        <textarea
          ref={textarea}
          rows={2}
          class={`block max-h-52 min-h-[69px] w-full resize-none border-0 bg-transparent px-4 pt-4 pb-2 text-[14px] leading-relaxed outline-none [field-sizing:content] placeholder:text-muted-foreground placeholder:opacity-100 ${HIDDEN_COLLAPSED}`}
          placeholder={placeholder()}
          value={text()}
          disabled={answerLocked()}
          readOnly={dictating()}
          onInput={(event) => {
            moveCaret(event.currentTarget.value, event.currentTarget.selectionStart);
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
            const modifier = composerRequiresModifier(
              environment.sendShortcut(),
              event.currentTarget.value,
            );
            if (!enterSends(event, coarsePointer(), modifier, running())) return;
            event.preventDefault();
            send(enterIsAlternate(event, modifier, IS_MAC));
          }}
        />
        <Show when={held().SendError}>
          <p class={ERROR}>Couldn't send: {held().SendError}</p>
        </Show>
        <Show when={held().StopError}>
          <p class={ERROR}>Couldn't stop: {held().StopError}</p>
        </Show>
        <Show when={held().QueueError}>
          <p class={ERROR}>Couldn't change the queue: {held().QueueError}</p>
        </Show>
        <Show when={held().ModelError}>
          <p class={ERROR}>{held().ModelError}</p>
        </Show>
        <Show when={held().RewindError}>
          <p class={ERROR}>{held().RewindError}</p>
        </Show>
        <Show when={held().ForkError}>
          <p class={ERROR}>Couldn't fork this response: {held().ForkError}</p>
        </Show>
        <Show when={ownsVoice()}>
          <DictationPreview />
        </Show>
        <div
          class="flex min-h-8 items-center gap-1 px-2 pt-px pb-[7px] in-data-collapsed:pt-0 in-data-collapsed:[&>:not(.model-trigger)]:hidden"
          onPointerDown={keepPromptFocus}
          onMouseDown={keepPromptFocus}
        >
          <Show when={!answering() && !(phone() && ownsVoice())}>
            <label
              class={buttonVariants({ variant: "ghost", size: "icon-sm" })}
              data-tip="Attach files"
            >
              <Paperclip class="translate-y-px" />
              <input
                type="file"
                class="hidden"
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
          <span class="flex-1" />
          <Show when={!(phone() && ownsVoice())}>
            <ModelPicker />
            <Show when={compactTokens()}>{(tokens) => <CompactToggle tokens={tokens()} />}</Show>
            <Show when={!isDraft() && session.effectiveRuntimeMode() !== DEFAULT_RUNTIME_MODE}>
              <PermissionsChip />
            </Show>
          </Show>
          <Show when={!answering() && voiceOffered()}>
            <Show
              when={ownsVoice()}
              fallback={
                <MicButton
                  shortcut={navigation.shortcut("composer.dictation")}
                  disabled={voiceElsewhere()}
                  onStart={startDictation}
                />
              }
            >
              <DictationPill dictation={voice()} onRetry={startDictation} />
            </Show>
          </Show>
          <Show when={answering()}>{(question) => <AnswerActions question={question()} />}</Show>
          <Show when={props.active}>
            <StopButton stopping={stopping()} class="ml-[5px]" onStop={() => session.stopRun()} />
          </Show>
          <Show when={!answering() && (!props.active || canSend() || dictating())}>
            <SendButton
              running={running()}
              alternate={alternateHeld()}
              followUp={session.followUpBehavior()}
              sending={sending()}
              disabled={!canSend() && !(dictating() && voice().Phase !== "preparing")}
              blocked={blocked()}
              compacts={compacts()}
              shiftAlternate={requiresModifier()}
              class="ml-[5px]"
              onSend={send}
            />
          </Show>
        </div>
      </form>
      <Show when={isDraft()}>
        <div class="flex justify-end px-2 pt-2 pb-0">
          <PermissionsChip context />
        </div>
      </Show>
    </>
  );
}
