import { type AtomCommand, runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import { createSourceControlEnvironmentAtoms } from "@t3tools/client-runtime/state/source-control";
import * as Layer from "effect/Layer";
import { Atom, AtomRegistry } from "effect/reactivity";

import { connectionRuntime } from "./connection";
import { thrownOf } from "./serverError";

// Reuses the connection runtime's services, so no second connection is built.
export const atomRuntime = Atom.runtime(Layer.effectContext(connectionRuntime.contextEffect));
const registry = AtomRegistry.make();

export const sourceControl = createSourceControlEnvironmentAtoms(atomRuntime);

export async function runCommand<W, A, E>(command: AtomCommand<W, A, E>, input: W): Promise<A> {
  const result = await runAtomCommand(registry, command, input, { reportFailure: false });
  if (result._tag === "Failure") throw thrownOf(result.cause);
  return result.value;
}
