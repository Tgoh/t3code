import { createMemo, createSignal, For, type JSX, onCleanup, onMount, Show } from "solid-js";

import { Check, ChevronDown, ShieldQuestion, X } from "./icons";
import type { IApprovalDecision } from "./Infrastructure/commandEffects";
import { Markdown } from "./Markdown";
import OpenThread, { pendingRequest } from "./OpenThread";
import { type IAnswering, type IQuestion, questionProgress } from "./questions";
import RuntimeRequest, { canAnswer } from "./RuntimeRequest";
import ThreadSession from "./ThreadSession";
import { RowIcon } from "./TimelineRows";
import { viewOf } from "./turnItemView";

export const PendingApproval = RuntimeRequest.provider(() => {
  const thread = OpenThread.use();
  const request = RuntimeRequest.use();
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
    <div class="pending-approval">
      <div class="work-line">
        <RowIcon type="command_execution" />
        <code class="approval-subject">{item()?.prompt ?? item()?.requestKind}</code>
      </div>
      <div class="approval-actions">
        <Show
          when={canAnswer(request.state)}
          fallback={
            <span class="approval-state">
              Provider process is gone. Interrupt or restart the run to respond.
            </span>
          }
        >
          <span class="approval-state">
            <ShieldQuestion />
            Waiting for approval
          </span>
          <For each={options()}>
            {(option) => (
              <>
                <span class="approval-dot">·</span>
                <button
                  classList={{ strong: option.decision === "accept" }}
                  disabled={request.answering()}
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
        {(error) => <p class="composer-error">Couldn't answer: {error()}</p>}
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
    <div class="composer-banner warning">
      <div class="banner-title">
        <ShieldQuestion />
        <strong>{view()?.Label ?? `Request: ${request.state.kind}`}</strong>
      </div>
      <Show when={view()?.Body?.replace(/\n?Status: \w+$/, "")}>
        {(body) => <pre class="banner-body">{body()}</pre>}
      </Show>
      <p class="banner-body">Answer this one in the stock client.</p>
    </div>
  );
});

const SHORTCUT_BLOCKERS =
  'select, [contenteditable]:not([contenteditable="false"]), [role="dialog"], [aria-modal="true"], [role="menu"], [role="combobox"], [data-popup]';

// Follows ComposerPendingUserInputCard in apps/web/src/components/chat/ComposerPendingUserInputPanel.tsx
// and the question callbacks in apps/web/src/components/chat/usePendingThreadRequests.ts.
export const PendingQuestion = RuntimeRequest.provider<{
  composer: (answering: IAnswering) => JSX.Element;
}>((props) => {
  const thread = OpenThread.use();
  const session = ThreadSession.use();
  const request = RuntimeRequest.use();
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
  const locked = () => !canRespond() || request.answering();
  const dismissible = () =>
    item()?.responseMode === "message" || request.state.responseCapability.type === "message";
  const [collapsedId, setCollapsedId] = createSignal<string | null>(null);
  const collapsed = () => {
    const id = collapsedId();
    return id !== null && id === progress().Question?.id;
  };

  const advance = () => {
    const current = progress();
    if (!canRespond() || request.answering()) return;
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
    responding: () => request.answering(),
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
          <div class="composer-banner question-card">
            <button
              type="button"
              class="question-head"
              aria-expanded={!collapsed()}
              data-tip={
                collapsed()
                  ? "Show the question and its options"
                  : "Hide the question and its options"
              }
              onClick={() => setCollapsedId(collapsed() ? null : question().id)}
            >
              <span class="question-header">{question().header}</span>
              <Show when={collapsed()}>
                <span class="question-dot">·</span>
                <span class="question-summary">{question().question}</span>
              </Show>
              <span class="question-head-actions">
                <Show when={questions().length > 1}>
                  <span class="question-count">
                    {progress().QuestionIndex + 1}/{questions().length}
                  </span>
                </Show>
                <ChevronDown classList={{ flipped: collapsed() }} />
                <Show when={dismissible()}>
                  <span
                    role="button"
                    tabIndex={0}
                    class="question-dismiss"
                    aria-label="Dismiss question without answering"
                    data-tip="Dismiss question without answering"
                    aria-disabled={request.answering()}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (!request.answering())
                        request.dismissRequest(thread.state.EnvironmentId, thread.state.ThreadId);
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      event.stopPropagation();
                      if (!request.answering())
                        request.dismissRequest(thread.state.EnvironmentId, thread.state.ThreadId);
                    }}
                  >
                    <X />
                  </span>
                </Show>
              </span>
            </button>
            <Show when={!collapsed()}>
              <div class="question-body">
                <div class="question-text">
                  <Markdown text={question().question} fromUser />
                </div>
                <div class="question-options">
                  <For each={question().options}>
                    {(option, index) => {
                      const value = () => option.value ?? option.label;
                      return (
                        <div>
                          <button
                            type="button"
                            class="question-option"
                            classList={{ selected: selected(value()) }}
                            aria-pressed={selected(value())}
                            disabled={locked()}
                            onClick={() => choose(question(), value())}
                          >
                            <span class="question-mark">
                              <span
                                class={question().multiSelect ? "option-checkbox" : "option-radio"}
                                classList={{ checked: selected(value()) }}
                              >
                                <Show when={question().multiSelect && selected(value())}>
                                  <Check />
                                </Show>
                              </span>
                            </span>
                            <span class="question-option-text">
                              <span class="question-option-label">{option.label}</span>
                              <Show when={option.description !== option.label}>
                                <span class="question-option-description">
                                  {option.description}
                                </span>
                              </Show>
                            </span>
                            <Show when={index() < 9}>
                              <span class="question-mark">
                                <kbd>{index() + 1}</kbd>
                              </span>
                            </Show>
                          </button>
                          <Show when={option.preview}>
                            {(preview) => (
                              <div class="question-preview">
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
                  {(notice) => <p class="question-notice">{notice()}</p>}
                </Show>
                <Show when={request.answerError()}>
                  {(error) => <p class="question-error">Couldn't answer: {error()}</p>}
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
