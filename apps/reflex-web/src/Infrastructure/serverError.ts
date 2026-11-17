import * as Cause from "effect/Cause";
import * as Exit from "effect/Exit";

import { errorText } from "../errorText";

/** A request the server refused or the network dropped, with text a user can read. */
// @effect-diagnostics-next-line extendsNativeError:off -- thrown to treflex actions, never on an Effect channel.
export class ServerError extends Error {
  override readonly name = "ServerError";
}

/**
 * For an action's `catch`: returns a server error, and rethrows anything else, a treflex refusal
 * or a bug, so it takes the failure route.
 */
export function serverError(error: unknown): ServerError {
  if (error instanceof ServerError) return error;
  throw error;
}

/** A typed failure is the server's answer; a defect or an interrupt is thrown as it is. */
export function thrownOf(cause: Cause.Cause<unknown>): unknown {
  const squashed = Cause.squash(cause);
  if (Cause.hasDies(cause) || !Cause.hasFails(cause)) return squashed;
  return new ServerError(errorText(squashed), { cause: squashed });
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
    throw new ServerError(errorText(error), { cause: error });
  }
}
