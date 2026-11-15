import { createMemo, For, Show } from "solid-js";

import { ShieldQuestion } from "./icons";
import type { IApprovalDecision } from "./Infrastructure/commandEffects";
import OpenThread, { pendingRequest } from "./OpenThread";
import RuntimeRequest, { canAnswer } from "./RuntimeRequest";
import ThreadSession, { questionAnswers } from "./ThreadSession";
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

export const RequestBanner = RuntimeRequest.provider(() => {
  const thread = OpenThread.use();
  const session = ThreadSession.use();
  const request = RuntimeRequest.use();
  const item = createMemo(() => pendingRequest(thread.state, request.state.id)?.Item ?? null);
  const view = () => {
    const held = item();
    return held === null ? null : viewOf(held);
  };
  const questions = () => {
    const held = item();
    return held?.type === "user_input_request" ? held.questions : null;
  };
  const answers = () => {
    const asked = questions();
    return asked === null ? null : questionAnswers(session.state, request.state.id, asked);
  };
  return (
    <div class="composer-banner warning">
      <div class="banner-title">
        <ShieldQuestion />
        <strong>{view()?.Label ?? `Request: ${request.state.kind}`}</strong>
      </div>
      <Show when={view()?.Body?.replace(/\n?Status: \w+$/, "")}>
        {(body) => <pre class="banner-body">{body()}</pre>}
      </Show>
      <Show when={questions()}>
        {(asked) => (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const given = answers();
              if (given !== null)
                request.answerRequest(
                  thread.state.EnvironmentId,
                  thread.state.ThreadId,
                  null,
                  given,
                );
            }}
          >
            <For each={asked()}>
              {(question) => (
                <label class="question">
                  {question.header}
                  <input
                    disabled={!canAnswer(request.state)}
                    list={`options-${question.id}`}
                    value={session.state.QuestionAnswers[request.state.id]?.[question.id] ?? ""}
                    onInput={(event) =>
                      session.setQuestionAnswer(
                        request.state.id,
                        question.id,
                        event.currentTarget.value,
                      )
                    }
                  />
                  <datalist id={`options-${question.id}`}>
                    <For each={question.options}>{(option) => <option value={option.label} />}</For>
                  </datalist>
                </label>
              )}
            </For>
            <div class="request-actions">
              <button
                class="button primary"
                disabled={!canAnswer(request.state) || request.answering() || answers() === null}
              >
                Answer
              </button>
            </div>
          </form>
        )}
      </Show>
      <Show when={questions() === null}>
        <p class="banner-body">Answer this one in the stock client.</p>
      </Show>
      <Show when={request.answerError()}>
        {(error) => <p class="composer-error">Couldn't answer: {error()}</p>}
      </Show>
    </div>
  );
});
