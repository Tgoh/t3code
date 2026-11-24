import { defineRule, type ESTree } from "@oxlint/plugins";

function isFunction(node: ESTree.Node): boolean {
  return (
    node.type === "ArrowFunctionExpression" ||
    node.type === "FunctionExpression" ||
    node.type === "FunctionDeclaration"
  );
}

// The child nodes of `node`, leaving out property names (`x.name`, `{ name: x }`).
function children(node: ESTree.Node): unknown[] {
  if (node.type === "MemberExpression" && !node.computed) return [node.object];
  if (node.type === "Property" && !node.computed) return [node.value];
  return Object.entries(node)
    .filter(([key, value]) => key !== "parent" && value !== null && typeof value === "object")
    .map(([, value]) => value);
}

// `name` read anywhere under `node`, as `name()` or passed bare (`untrack(name)`).
function readsGetter(node: unknown, name: string): boolean {
  if (node === null || typeof node !== "object") return false;
  if (Array.isArray(node)) return node.some((child) => readsGetter(child, name));
  const n = node as ESTree.Node;
  if (n.type === "Identifier" && n.name === name) return true;
  return children(n).some((child) => readsGetter(child, name));
}

// Calls of `setter` in the apply phase itself. A write from a callback it registers (a timer,
// a subscription) lands later, as an event would.
function setterCalls(node: unknown, setter: string, out: ESTree.CallExpression[], depth = 0) {
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) setterCalls(child, setter, out, depth);
    return;
  }
  const n = node as ESTree.Node;
  if (isFunction(n)) {
    if (depth > 0) return;
    depth++;
  }
  if (n.type === "CallExpression" && n.callee.type === "Identifier" && n.callee.name === setter)
    out.push(n);
  for (const child of children(n)) setterCalls(child, setter, out, depth);
}

export default defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow a Solid 2 `createEffect` whose effect writes a signal its compute reads.",
    },
  },
  create(context) {
    const signals = new Map<string, string>();
    const effects: ESTree.CallExpression[] = [];
    return {
      VariableDeclarator(node) {
        if (node.id.type !== "ArrayPattern" || node.init?.type !== "CallExpression") return;
        const callee = node.init.callee;
        if (callee.type !== "Identifier" || callee.name !== "createSignal") return;
        const [getter, setter] = node.id.elements;
        if (getter?.type === "Identifier" && setter?.type === "Identifier")
          signals.set(setter.name, getter.name);
      },
      CallExpression(node) {
        if (node.callee.type === "Identifier" && node.callee.name === "createEffect")
          effects.push(node);
      },
      "Program:exit"() {
        for (const effect of effects) {
          const [compute, apply] = effect.arguments;
          if (compute === undefined || apply === undefined) continue;
          for (const [setter, getter] of signals) {
            if (!readsGetter(compute, getter)) continue;
            const calls: ESTree.CallExpression[] = [];
            setterCalls(apply, setter, calls);
            for (const call of calls)
              context.report({
                node: call,
                message: `This effect writes \`${getter}\`, which its compute reads, so every write reruns it. Derive the value instead: a writable derived signal, \`createSignal((prev) => …)\`, or a \`createMemo\`.`,
              });
          }
        }
      },
    };
  },
});
