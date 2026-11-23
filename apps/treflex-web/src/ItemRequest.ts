import { linkRequestAnswerInput } from "@t3tools/client-runtime/link-request";
import {
  secretRequestAnswerInput,
  type SecretRequestItem,
  type SecretRequestReply,
} from "@t3tools/client-runtime/secret-request";
import { ThreadId, TurnItemId } from "@t3tools/contracts";
import {
  type IActionGenerator,
  type IOpenGenerator,
  type ISelectorGenerator,
  type IWithId,
  leading,
  open,
  redactArgs,
  transient,
} from "treflex";
import { createEntityFeature } from "treflex-solid";

import { answerLinkEffect, answerSecretEffect } from "./Infrastructure/commandEffects";
import { serverError } from "./Infrastructure/serverError";

/** A secret or link card: a turn item the server answers by its id, with no runtime request row. */
export type IItemRequest = IWithId<{ id: string }>;

export const ANSWERED_ITEM_TYPES: ReadonlySet<string> = new Set(["secret_request", "link_request"]);

export type ISecretReply = Extract<SecretRequestReply, { type: "save" | "decline" }>;
export type ISecretAsk = Pick<SecretRequestItem, "label" | "placeholder" | "fields">;
export type ILinkReply = Parameters<typeof linkRequestAnswerInput>[1];

const outcome = (draft: IItemRequest) =>
  transient(draft, "ItemRequest/Answer", { Error: null as string | null });

const itemOf = (draft: IItemRequest, threadId: string) => ({
  id: TurnItemId.make(draft.id),
  threadId: ThreadId.make(threadId),
});

function* answer(draft: IItemRequest, send: () => IActionGenerator): IOpenGenerator<boolean> {
  (yield* outcome(draft)).Error = null;
  try {
    yield* open(send());
    return true;
  } catch (error) {
    (yield* outcome(draft)).Error = serverError(error).message;
    return false;
  }
}

/** True once the server took the answer; the stream then ends the card. */
export function* answerSecret(
  draft: IItemRequest,
  environmentId: string,
  threadId: string,
  ask: ISecretAsk,
  reply: ISecretReply,
): IOpenGenerator<boolean> {
  const input = secretRequestAnswerInput({ ...ask, ...itemOf(draft, threadId) }, reply);
  if (input === null) return false;
  return yield* answer(draft, () =>
    answerSecretEffect({ EnvironmentId: environmentId, Input: input }),
  );
}
leading(answerSecret);
redactArgs(answerSecret);

export function* answerLink(
  draft: IItemRequest,
  environmentId: string,
  threadId: string,
  reply: ILinkReply,
): IOpenGenerator<boolean> {
  const input = linkRequestAnswerInput(itemOf(draft, threadId), reply);
  if (input === null) return false;
  return yield* answer(draft, () =>
    answerLinkEffect({ EnvironmentId: environmentId, Input: input }),
  );
}
leading(answerLink);
redactArgs(answerLink);

export function* itemAnswerError(draft: IItemRequest): ISelectorGenerator<string | null> {
  return (yield* outcome(draft)).Error;
}

export default createEntityFeature<IItemRequest>("ItemRequest")(
  { answerSecret, answerLink },
  { itemAnswerError },
);
