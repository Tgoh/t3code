import { subscribe } from "@t3tools/client-runtime/rpc";
import { WS_METHODS } from "@t3tools/contracts";

// Not `currentSession().subscribeServerConfig()`: a session the supervisor replaces never ends
// its config stream. `{}` equals the session's default input, so this shares its subscription.
export const serverConfigEvents = subscribe(WS_METHODS.subscribeServerConfig, {});
