import { defineRule, type ESTree } from "@oxlint/plugins";
import * as Option from "effect/Option";
import { getPropertyName, unwrapExpression } from "../utils.ts";

const SUBSCRIBE_METHOD = /^subscribe[A-Z]/;
// client-runtime's rpc exports that switch to each new session the supervisor opens.
const SESSION_FOLLOWING = new Set([
  "subscribeDynamic",
  "subscribeDynamicWithSession",
  "subscribeVcsBranch",
]);
const FOLLOW =
  "Use `subscribe(WS_METHODS.…)` or `subscribeDynamic` from `@t3tools/client-runtime/rpc`, which follow the supervisor onto each new session";

// `x.name`, `x["name"]`, or `x[WS_METHODS.name]`, whose tag constant carries the method's name.
function memberName(node: ESTree.MemberExpression): Option.Option<string> {
  if (!node.computed) return getPropertyName(node.property);
  const property = Option.getOrNull(unwrapExpression(node.property));
  if (property?.type === "Literal") return getPropertyName(property);
  if (property?.type === "MemberExpression") return memberName(property);
  return Option.none();
}

function isSessionClient(node: ESTree.Node): boolean {
  const object = Option.getOrNull(unwrapExpression(node));
  return object?.type === "MemberExpression" && Option.getOrNull(memberName(object)) === "client";
}

export default defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow subscribing through one RPC session, which goes silent when the supervisor replaces it.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = Option.getOrNull(unwrapExpression(node.callee));
        if (callee === null) return;
        const name =
          callee.type === "Identifier"
            ? callee.name
            : callee.type === "MemberExpression"
              ? Option.getOrNull(memberName(callee))
              : null;
        if (name === "currentSession") {
          context.report({
            node,
            message: `\`currentSession()\` pins the session that is current now, and a stream taken from it neither emits, ends nor fails once the supervisor replaces that session. ${FOLLOW}, or \`request\` for a single call.`,
          });
          return;
        }
        if (callee.type !== "MemberExpression") return;
        if (isSessionClient(callee.object)) {
          context.report({
            node,
            message: `A call on a session's \`client\` is bound to that session. ${FOLLOW}, or \`request\` for a single call.`,
          });
          return;
        }
        if (name !== null && SUBSCRIBE_METHOD.test(name) && !SESSION_FOLLOWING.has(name)) {
          context.report({
            node,
            message: `\`.${name}()\` on a session or RPC client is bound to that session, and goes silent when the supervisor replaces it. ${FOLLOW}.`,
          });
        }
      },
      VariableDeclarator(node) {
        if (node.id.type !== "ObjectPattern") return;
        for (const property of node.id.properties) {
          if (property.type !== "Property") continue;
          const name = Option.getOrNull(getPropertyName(property.key));
          if (name !== null && SUBSCRIBE_METHOD.test(name) && !SESSION_FOLLOWING.has(name))
            context.report({
              node: property,
              message: `\`${name}\` taken from a session or RPC client is bound to that session. ${FOLLOW}.`,
            });
        }
      },
    };
  },
});
