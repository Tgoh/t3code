import { useInFlight } from "treflex-solid";
import { createMemo, createSignal, For, type JSX, onCleanup, onMount, Show } from "solid-js";

import { Check, ChevronDown, ShieldQuestion, X } from "./icons";
import type { IApprovalDecision } from "./Infrastructure/commandEffects";
import { Markdown } from "./Markdown";
import OpenThread, { pendingRequest } from "./OpenThread";
import { type IAnswering, type IQuestion, questionProgress } from "./questions";
import RuntimeRequest, { answerRequest, canAnswer, dismissRequest } from "./RuntimeRequest";
import ThreadSession from "./ThreadSession";
import { RowIcon, workLine } from "./TimelineRows";
import { viewOf } from "./turnItemView";
import { BANNER, BANNER_BODY, BANNER_FRAME, BANNER_TITLE, ERROR_TEXT } from "./ui/notice";

const APPROVAL_STATE = "inline-flex items-center gap-1 text-warning-foreground [&>svg]:size-3.5";

const RESPONSES = [answerRequest, dismissRequest];
const QUESTION_MARK = "flex h-5 flex-none items-center justify-center";
const OPTION_MARK =
  "inline-flex size-4 items-center justify-center border border-[color-mix(in_srgb,var(--foreground)_55%,transparent)] bg-background data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground";
const QUESTION_NOTE = "mx-0 mt-1.5 mb-0 text-[12px]";

export const PendingApproval = RuntimeRequest.provider(() => {
  const thread = OpenThread.use();
  const request = RuntimeRequest.use();
  const responding = useInFlight(RESPONSES, () => request.state);
  const item = createMemo(() => {
    const held = pendingRequest(thread.state, request.state.id)?.Item;
    return held?.type === "approval_request" ? held : null;
  });
  const options = () => {
    const given = item()?.options;
    return given?.length
      ? given
      : ([
          { decision: "decline", label: "Decline" },
          { decision: "accept", label: "Approve" },
        ] as const);
  };
  return (
    <div class="p-0.5">
      <div class={workLine()}>
        <RowIcon type="command_execution" />
        <code class="min-w-0 text-[12px] font-medium wrap-anywhere text-foreground">
          {item()?.prompt ?? item()?.requestKind}
        </code>
      </div>
      <div class="ml-[30px] flex flex-wrap items-center gap-1.5 text-[12px] leading-4 text-muted-foreground">
        <Show
          when={canAnswer(request.state)}
          fallback={
            <span class={APPROVAL_STATE}>
              Provider process is gone. Interrupt or restart the run to respond.
            </span>
          }
        >
          <span class={APPROVAL_STATE}>
            <ShieldQuestion />
            Waiting for approval
          </span>
          <For each={options()}>
            {(option) => (
              <>
                <span>·</span>
                <button
                  class="cursor-pointer border-0 bg-transparent p-0 text-[12px] text-muted-foreground hover:text-foreground disabled:cursor-default disabled:opacity-64 data-strong:font-medium data-strong:text-foreground"
                  data-strong={option.decision === "accept" || undefined}
                  disabled={responding()}
                  onClick={() =>
                    request.answerRequest(
                      thread.state.EnvironmentId,
                      thread.state.ThreadId,
                      option.decision as IApprovalDecision,
                      null,
                    )
                  }
                >
                  {option.label}
                </button>
              </>
            )}
          </For>
        </Show>
      </div>
      <Show when={request.answerError()}>
        {(error) => <p class={ERROR_TEXT}>Couldn't answer: {error()}</p>}
      </Show>
    </div>
  );
});

export const UnansweredRequest = RuntimeRequest.provider(() => {
  const thread = OpenThread.use();
  const request = RuntimeRequest.use();
  const view = createMemo(() => {
    const held = pendingRequest(thread.state, request.state.id)?.Item;
    return held == null ? null : viewOf(held);
  });
  return (
    <div class={BANNER} data-tone="warning">
      <div class={BANNER_TITLE}>
        <ShieldQuestion />
        <strong>{view()?.Label ?? `Request: ${request.state.kind}`}</strong>
      </div>
      <Show when={view()?.Body?.replace(/\n?Status: \w+$/, "")}>
        {(body) => <pre class={BANNER_BODY}>{body()}</pre>}
      </Show>
      <p class={BANNER_BODY}>Answer this one in the stock client.</p>
    </div>
  );
});

const SHORTCUT_BLOCKERS =
  'select, [contenteditable]:not([contenteditable="false"]), [role="dialog"], [aria-modal="true"], [role="menu"], [role="combobox"]';

// Follows ComposerPendingUserInputCard in apps/web/src/components/chat/ComposerPendingUserInputPanel.tsx
// and the question callbacks in apps/web/src/components/chat/usePendingThreadRequests.ts.
export const PendingQuestion = RuntimeRequest.provider<{
  composer: (answering: IAnswering) => JSX.Element;
}>((props) => {
  const thread = OpenThread.use();
  const session = ThreadSession.use();
  const request = RuntimeRequest.use();
  const responding = useInFlight(RESPONSES, () => request.state);
  const requestId = request.state.id;
  const item = createMemo(() => {
    const held = pendingRequest(thread.state, requestId)?.Item;
    return held?.type === "user_input_request" ? held : null;
  });
  const questions = () => item()?.questions ?? [];
  const progress = createMemo(() =>
    questionProgress(
      questions(),
      session.state.QuestionAnswers[requestId],
      session.state.QuestionIndex[requestId] ?? 0,
    ),
  );
  const canRespond = () => canAnswer(request.state);
  const locked = () => !canRespond() || responding();
  const dismissible = () =>
    item()?.responseMode === "message" || request.state.responseCapability.type === "message";
  const [collapsedId, setCollapsedId] = createSignal<string | null>(null);
  const collapsed = () => {
    const id = collapsedId();
    return id !== null && id === progress().Question?.id;
  };

  const advance = () => {
    const current = progress();
    if (!canRespond() || responding()) return;
    if (current.IsLastQuestion) {
      if (current.Answers !== null)
        request.answerRequest(
          thread.state.EnvironmentId,
          thread.state.ThreadId,
          null,
          current.Answers,
        );
      return;
    }
    if (current.CanAdvance) session.setQuestionIndex(requestId, current.QuestionIndex + 1);
  };
  const answering: IAnswering = {
    progress,
    responding,
    canRespond,
    setCustomAnswer: (text) => {
      const question = progress().Question;
      if (question !== null) session.setQuestionCustomAnswer(requestId, question, text);
    },
    advance,
    previous: () => session.setQuestionIndex(requestId, Math.max(progress().QuestionIndex - 1, 0)),
  };

  let autoAdvance: number | undefined;
  const clearAutoAdvance = () => {
    if (autoAdvance !== undefined) window.clearTimeout(autoAdvance);
    autoAdvance = undefined;
  };
  onCleanup(clearAutoAdvance);
  const choose = (question: IQuestion, optionValue: string) => {
    if (locked()) return;
    void session.toggleQuestionOption(requestId, questions(), question.id, optionValue);
    if (question.multiSelect) return;
    clearAutoAdvance();
    autoAdvance = window.setTimeout(() => {
      autoAdvance = undefined;
      if (progress().Question?.id === question.id) advance();
    }, 200);
  };
  const selected = (optionValue: string) =>
    progress().CustomAnswer.trim() === "" && progress().SelectedOptionValues.includes(optionValue);

  onMount(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const question = progress().Question;
      if (question === null || locked() || collapsed()) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      if (target instanceof HTMLElement && target.closest(SHORTCUT_BLOCKERS)) return;
      const digit = Number.parseInt(event.key, 10);
      if (Number.isNaN(digit) || digit < 1 || digit > 9) return;
      const option = question.options[digit - 1];
      if (option === undefined) return;
      event.preventDefault();
      choose(question, option.value ?? option.label);
    };
    document.addEventListener("keydown", onKeyDown);
    onCleanup(() => document.removeEventListener("keydown", onKeyDown));
  });

  return (
    <>
      <Show when={progress().Question}>
        {(question) => (
          <div class={`${BANNER_FRAME} pb-4`}>
            <button
              type="button"
              class="group/head flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent py-1.5 pr-3 pl-4 text-start [font-family:inherit] text-[length:inherit] leading-6 text-inherit"
              aria-expanded={!collapsed()}
              data-tip={
                collapsed()
                  ? "Show the question and its options"
                  : "Hide the question and its options"
              }
              onClick={() => setCollapsedId(collapsed() ? null : question().id)}
            >
              <span class="max-w-[50%] flex-none truncate text-muted-foreground group-aria-expanded/head:max-w-none group-aria-expanded/head:flex-1">
                {question().header}
              </span>
              <Show when={collapsed()}>
                <span class="text-muted-foreground">·</span>
                <span class="min-w-0 flex-1 truncate text-secondary-label">
                  {question().question}
                </span>
              </Show>
              <span class="ml-auto flex flex-none items-center gap-1 text-muted-foreground [&_svg]:size-4 [&_svg]:[transition:transform_150ms]">
                <Show when={questions().length > 1}>
                  <span class="px-1 text-[12px] tabular-nums">
                    {progress().QuestionIndex + 1}/{questions().length}
                  </span>
                </Show>
                <ChevronDown class="group-aria-[expanded=false]/head:[transform:rotate(180deg)]" />
                <Show when={dismissible()}>
                  <span
                    role="button"
                    tabIndex={0}
                    class="inline-flex size-6 items-center justify-center rounded-[6px] hover:bg-accent hover:text-foreground"
                    aria-label="Dismiss question without answering"
                    data-tip="Dismiss question without answering"
                    aria-disabled={responding()}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (!responding())
                        request.dismissRequest(thread.state.EnvironmentId, thread.state.ThreadId);
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      event.stopPropagation();
                      if (!responding())
                        request.dismissRequest(thread.state.EnvironmentId, thread.state.ThreadId);
                    }}
                  >
                    <X />
                  </span>
                </Show>
              </span>
            </button>
            <Show when={!collapsed()}>
              <div class="max-h-[min(50vh,28rem)] overflow-auto pt-0 pr-4 pb-1 pl-[22px] wrap-anywhere">
                <div class="pt-0.5 text-[color-mix(in_srgb,var(--foreground)_85%,transparent)]">
                  <Markdown text={question().question} fromUser />
                </div>
                <div class="mt-1.5 -ml-1.5">
                  <For each={question().options}>
                    {(option, index) => {
                      const value = () => option.value ?? option.label;
                      return (
                        <div>
                          <button
                            type="button"
                            class="flex w-full cursor-pointer items-start gap-2.5 rounded-[6px] border-0 bg-transparent py-1.5 pr-0 pl-1.5 text-start [font:inherit] text-[color-mix(in_srgb,var(--foreground)_70%,transparent)] hover:enabled:not-aria-pressed:bg-[color-mix(in_srgb,var(--muted)_30%,transparent)] focus-visible:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--primary)_25%,transparent)] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 aria-pressed:text-foreground"
                            aria-pressed={selected(value())}
                            disabled={locked()}
                            onClick={() => choose(question(), value())}
                          >
                            <span class={`${QUESTION_MARK} min-w-0`}>
                              <span
                                class={
                                  question().multiSelect
                                    ? `${OPTION_MARK} rounded-[4px] [&>svg]:size-3 [&>svg]:[stroke-width:3]`
                                    : `${OPTION_MARK} rounded-full data-checked:before:size-1.5 data-checked:before:rounded-full data-checked:before:bg-primary-foreground data-checked:before:content-['']`
                                }
                                data-checked={selected(value()) || undefined}
                              >
                                <Show when={question().multiSelect && selected(value())}>
                                  <Check />
                                </Show>
                              </span>
                            </span>
                            <span class="flex min-w-0 flex-1 flex-col gap-0.5">
                              <span class="text-[14px] leading-5 font-medium">{option.label}</span>
                              <Show when={option.description !== option.label}>
                                <span class="text-[12px] text-secondary-label">
                                  {option.description}
                                </span>
                              </Show>
                            </span>
                            <Show when={index() < 9}>
                              <span class={`${QUESTION_MARK} min-w-6`}>
                                <kbd class="min-w-[18px] rounded-[4px] border border-border bg-muted px-1 py-0 text-center [font-family:inherit] text-[11px] leading-4 text-muted-foreground">
                                  {index() + 1}
                                </kbd>
                              </span>
                            </Show>
                          </button>
                          <Show when={option.preview}>
                            {(preview) => (
                              <div class="pt-0 pr-2 pb-1.5 pl-8 text-[12px] text-[color-mix(in_srgb,var(--foreground)_70%,transparent)]">
                                <Markdown text={preview()} fromUser />
                              </div>
                            )}
                          </Show>
                        </div>
                      );
                    }}
                  </For>
                </div>
                <Show when={session.state.QuestionNotice}>
                  {(notice) => <p class={`${QUESTION_NOTE} text-muted-foreground`}>{notice()}</p>}
                </Show>
                <Show when={request.answerError()}>
                  {(error) => (
                    <p class={`${QUESTION_NOTE} text-error-foreground`}>
                      Couldn't answer: {error()}
                    </p>
                  )}
                </Show>
              </div>
            </Show>
          </div>
        )}
      </Show>
      {props.composer(answering)}
    </>
  );
});
