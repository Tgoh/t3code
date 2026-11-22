import { createOxlintRuleHarness } from "../test/utils.ts";

const rule = createOxlintRuleHarness("t3code/no-session-bound-subscription", {
  filename: "fixture.ts",
});

rule.invalid(
  "blocks the stale config stream's shape",
  `import { currentSession } from "@t3tools/client-runtime/rpc";
const events = Stream.unwrap(
  currentSession().pipe(
    Effect.retry(Schedule.spaced("1 second")),
    Effect.map((session) => session.subscribeServerConfig()),
  ),
);`,
);
rule.invalid(
  "blocks currentSession through a namespace import",
  'import * as Rpc from "@t3tools/client-runtime/rpc"; const session = Rpc.currentSession();',
);
rule.invalid(
  "blocks a subscribe method on a held session",
  "const events = session.subscribeServerConfig(input);",
);
rule.invalid(
  "blocks a subscribe method reached through optional chaining",
  "const events = session?.subscribeServerConfig();",
);
rule.invalid(
  "blocks a subscription through the session's raw client",
  "const events = session.client[WS_METHODS.subscribeVcsStatus]({ cwd });",
);
rule.invalid(
  "blocks any call on the session's raw client",
  "const events = session.client[tag](input);",
);
rule.invalid(
  "blocks destructuring a subscribe method off a session",
  "const { subscribeServerConfig } = session; subscribeServerConfig();",
);

rule.valid(
  "allows session-following subscriptions",
  `import { subscribe, subscribeDynamic, subscribeVcsBranch } from "@t3tools/client-runtime/rpc";
const config = subscribe(WS_METHODS.subscribeServerConfig, {});
const shell = subscribeDynamic(ORCHESTRATION_V2_WS_METHODS.subscribeShell, (session) => session.initialConfig);
const branch = subscribeVcsBranch({ cwd });`,
);
rule.valid(
  "allows session-following subscriptions through a namespace import",
  'import * as Rpc from "@t3tools/client-runtime/rpc"; Rpc.subscribeDynamic(tag, makeInput);',
);
rule.valid(
  "allows plain listener subscriptions",
  "onCleanup(value.subscribe(draw)); const subscription = yield* PubSub.subscribe(updates);",
);
rule.valid("allows single requests", "request(WS_METHODS.terminalWrite, { data });");
