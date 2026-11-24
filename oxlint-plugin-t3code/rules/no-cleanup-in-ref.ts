import { defineRule, type ESTree } from "@oxlint/plugins";

type FunctionNode =
  | ESTree.ArrowFunctionExpression
  | ESTree.FunctionExpression
  | ESTree.FunctionDeclaration;

const MESSAGE =
  "Solid 2 throws `CLEANUP_IN_FORBIDDEN_SCOPE` for `onCleanup` inside a ref callback, which crashes the view. Wrap the ref in `cleanupRef` from `src/ui/cleanupRef.ts` and return the teardown instead.";

function isFunction(node: ESTree.Node): node is FunctionNode {
  return (
    node.type === "ArrowFunctionExpression" ||
    node.type === "FunctionExpression" ||
    node.type === "FunctionDeclaration"
  );
}

function enclosingFunction(node: ESTree.Node): FunctionNode | null {
  let current: ESTree.Node | null = node.parent;
  while (current !== null) {
    if (isFunction(current)) return current;
    current = current.parent;
  }
  return null;
}

function isRefAttribute(node: ESTree.Node | null): boolean {
  return (
    node?.type === "JSXAttribute" && node.name.type === "JSXIdentifier" && node.name.name === "ref"
  );
}

// The name a function is bound to: `const name = (el) => …` or `function name(el) {}`.
function boundName(fn: FunctionNode): string | null {
  if (fn.type === "FunctionDeclaration") return fn.id?.name ?? null;
  const parent = fn.parent;
  if (parent?.type === "VariableDeclarator" && parent.id.type === "Identifier")
    return parent.id.name;
  return null;
}

export default defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "Disallow `onCleanup` inside a ref callback, which Solid 2 refuses at runtime.",
    },
  },
  create(context) {
    const refNames = new Set<string>();
    const pending: { node: ESTree.CallExpression; name: string }[] = [];
    return {
      JSXAttribute(node) {
        if (!isRefAttribute(node)) return;
        const value = node.value;
        if (value?.type === "JSXExpressionContainer" && value.expression.type === "Identifier")
          refNames.add(value.expression.name);
      },
      CallExpression(node) {
        if (node.callee.type !== "Identifier" || node.callee.name !== "onCleanup") return;
        const fn = enclosingFunction(node);
        if (fn === null) return;
        if (fn.parent?.type === "JSXExpressionContainer" && isRefAttribute(fn.parent.parent)) {
          context.report({ node, message: MESSAGE });
          return;
        }
        const name = boundName(fn);
        if (name !== null) pending.push({ node, name });
      },
      "Program:exit"() {
        for (const { node, name } of pending)
          if (refNames.has(name)) context.report({ node, message: MESSAGE });
      },
    };
  },
});
