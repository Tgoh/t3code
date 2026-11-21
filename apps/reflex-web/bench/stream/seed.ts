// @effect-diagnostics nodeBuiltinImport:off -- A Node script that drives the server CLI, outside any Effect runtime.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";

import { defaultBaseDir, sendTurn, startReplayThread } from "./t3.ts";

const { values } = NodeUtil.parseArgs({
  options: {
    "base-dir": { type: "string", default: defaultBaseDir },
    project: { type: "string", default: "G:/Sorted/Test" },
    turns: { type: "string", default: "300" },
  },
});
const baseDir = values["base-dir"];
const turns = Number(values.turns);
const out = NodePath.join(import.meta.dirname, "results", "long-thread.json");

const threadId = startReplayThread(baseDir, values.project, "bench long thread");
console.log(`long thread ${threadId}`);
for (let turn = 2; turn <= turns; turn++) {
  await sendTurn(baseDir, threadId);
  if (turn % 25 === 0) console.log(`turn ${turn}/${turns}`);
}
NodeFS.mkdirSync(NodePath.dirname(out), { recursive: true });
NodeFS.writeFileSync(out, `${JSON.stringify({ threadId, turns }, null, 2)}\n`);
console.log(`wrote ${out}`);
