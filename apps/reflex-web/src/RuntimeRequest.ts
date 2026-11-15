import {
  type IActionGenerator,
  type ISelectorGenerator,
  type IWithId,
  inFlight,
  leading,
  transient,
} from "treflex";
import { createEntityFeature } from "treflex-solid";

import {
  type IApprovalDecision,
  respondRequestEffect,
  withCommandId,
} from "./Infrastructure/commandEffects";
import type { IWireProjection } from "./Infrastructure/wire";

export type IRuntimeRequest = IWithId<IWireProjection["runtimeRequests"][number]>;

const outcome = (draft: IRuntimeRequest) =>
  transient(draft, "Request/Answer", { Error: null as string | null });

export const answerRequest = leading(function* answer(
  draft: IRuntimeRequest,
  environmentId: string,
  threadId: string,
  decision: IApprovalDecision | null,
  answers: Record<string, string | ReadonlyArray<string>> | null,
): IActionGenerator {
  (yield* outcome(draft)).Error = null;
  const requestId = draft.id;
  try {
    yield* withCommandId((commandId) =>
      respondRequestEffect({
        EnvironmentId: environmentId,
        ThreadId: threadId,
        CommandId: commandId,
        RequestId: requestId,
        Decision: decision,
        Answers: answers,
      }),
    );
  } catch (error) {
    (yield* outcome(draft)).Error = error instanceof Error ? error.message : String(error);
  }
});

export function* answering(draft: IRuntimeRequest): ISelectorGenerator<boolean> {
  return yield* inFlight(answerRequest, draft);
}

export function* answerError(draft: IRuntimeRequest): ISelectorGenerator<string | null> {
  return (yield* outcome(draft)).Error;
}

export default createEntityFeature<IRuntimeRequest>(import.meta.url)(
  { answerRequest },
  { answering, answerError },
);
