import * as Cause from "effect/Cause";
import * as Exit from "effect/Exit";

import { errorText } from "../errorText";

const NAME = "ServerError";

/** A request the server refused or the network dropped, with text a user can read. */
export interface ServerError extends Error {
  readonly name: typeof NAME;
}

/**
 * A plain `Error` named `ServerError`, not a subclass: treflex hands an action a copy of what an
 * effect rejects with, which keeps the name but not an app class, so the name is the mark.
 */
export function serverFailure(message: string, options?: ErrorOptions): ServerError {
  const error = new Error(message, options);
  error.name = NAME;
  return error as ServerError;
}

export const isServerError = (error: unknown): error is ServerError =>
  error instanceof Error && error.name === NAME;

/**
 * For an action's `catch`: returns a server error, and rethrows anything else, a treflex refusal
 * or a bug, so it takes the failure route.
 */
export function serverError(error: unknown): ServerError {
  if (isServerError(error)) return error;
  throw error;
}

/** A typed failure is the server's answer; a defect or an interrupt is thrown as it is. */
export function thrownOf(cause: Cause.Cause<unknown>): unknown {
  const squashed = Cause.squash(cause);
  if (Cause.hasDies(cause) || !Cause.hasFails(cause)) return squashed;
  return serverFailure(errorText(squashed), { cause: squashed });
}

export async function settle<A, E>(exit: Promise<Exit.Exit<A, E>>): Promise<A> {
  const result = await exit;
  if (Exit.isSuccess(result)) return result.value;
  throw thrownOf(result.cause);
}

/** `fetch`, whose network failure is a `TypeError`, the class a bug throws. */
export async function serverFetch(input: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (error) {
    throw serverFailure(errorText(error), { cause: error });
  }
}
