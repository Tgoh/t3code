import { subscribe } from "@t3tools/client-runtime/rpc";
import { WS_METHODS } from "@t3tools/contracts";

/** The session's own config stream input, so `serverConfigEvents` shares its subscription. */
export const SERVER_CONFIG_OPT_INS = { usageLimitSources: true } as const;

// Not `currentSession().subscribeServerConfig()`: a session the supervisor replaces never ends
// its config stream.
export const serverConfigEvents = subscribe(
  WS_METHODS.subscribeServerConfig,
  SERVER_CONFIG_OPT_INS,
);
