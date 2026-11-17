import {
  type IOpenGenerator,
  type ISelectorGenerator,
  type IWithId,
  inFlight,
  leading,
  open,
  transient,
} from "treflex";
import { createEntityFeature } from "treflex-solid";

import { errorText } from "./errorText";
import {
  type IApprovalDecision,
  type IRespondRequest,
  respondRequestEffect,
  withCommandId,
} from "./Infrastructure/commandEffects";
import type { IWireProjection } from "./Infrastructure/wire";

export type IRuntimeRequest = IWithId<IWireProjection["runtimeRequests"][number]>;

const outcome = (draft: IRuntimeRequest) =>
  transient(draft, "Request/Answer", { Error: null as string | null });

// Follows usePendingThreadRequests in apps/web: a message-mode question outlives its provider
// turn, but an approval needs the live provider session.
export function canAnswer(request: IRuntimeRequest): boolean {
  const capability = request.responseCapability.type;
  return request.kind === "user_input" ? capability !== "not_resumable" : capability === "live";
}

function* respond(
  draft: IRuntimeRequest,
  environmentId: string,
  threadId: string,
  response: Pick<IRespondRequest, "Decision" | "Answers" | "Dismiss">,
): IOpenGenerator {
  (yield* outcome(draft)).Error = null;
  const requestId = draft.id;
  try {
    yield* open(
      withCommandId((commandId) =>
        respondRequestEffect({
          EnvironmentId: environmentId,
          ThreadId: threadId,
          CommandId: commandId,
          RequestId: requestId,
          ...response,
        }),
      ),
    );
  } catch (error) {
    (yield* outcome(draft)).Error = errorText(error);
  }
}

export function* answerRequest(
  draft: IRuntimeRequest,
  environmentId: string,
  threadId: string,
  decision: IApprovalDecision | null,
  answers: Record<string, string | ReadonlyArray<string>> | null,
): IOpenGenerator {
  if (!canAnswer(draft)) return;
  yield* respond(draft, environmentId, threadId, { Decision: decision, Answers: answers });
}
leading(answerRequest);

/** Closes a message-mode question without answering it. */
export function* dismissRequest(
  draft: IRuntimeRequest,
  environmentId: string,
  threadId: string,
): IOpenGenerator {
  yield* respond(draft, environmentId, threadId, { Decision: null, Answers: null, Dismiss: true });
}
leading(dismissRequest);

export function* answering(draft: IRuntimeRequest): ISelectorGenerator<boolean> {
  return yield* inFlight([answerRequest, dismissRequest], draft);
}

export function* answerError(draft: IRuntimeRequest): ISelectorGenerator<string | null> {
  return (yield* outcome(draft)).Error;
}

export default createEntityFeature<IRuntimeRequest>(import.meta.url)(
  { answerRequest, dismissRequest },
  { answering, answerError },
);
