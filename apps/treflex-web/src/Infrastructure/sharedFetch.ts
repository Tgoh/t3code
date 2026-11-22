type IFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface ICaptured {
  status: number;
  statusText: string;
  headers: [string, string][];
  body: string;
}

const urlOf = (input: RequestInfo | URL) =>
  typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

const methodOf = (input: RequestInfo | URL, init: RequestInit | undefined) =>
  (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();

function withAbort<T>(answer: Promise<T>, signal: AbortSignal | null | undefined): Promise<T> {
  if (signal == null) return answer;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    answer.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

/**
 * Answers GETs of `path` from one request while it's in flight, and from its successful answer
 * for `holdMs` after. A `cache: "no-store"` read, which a route check makes to prove the host
 * answers now, always goes to the network.
 */
export function shareResponses(fetch: IFetch, path: string, holdMs: number, now: () => number) {
  let held: { answer: Promise<ICaptured>; settledAt: number | null } | null = null;
  return (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = urlOf(input);
    if (
      new URL(url, "http://base.invalid").pathname !== path ||
      methodOf(input, init) !== "GET" ||
      init?.cache === "no-store"
    ) {
      return fetch(input, init);
    }
    if (held?.settledAt != null && now() - held.settledAt > holdMs) held = null;
    if (held === null) {
      // A caller's abort or timeout ends only its own wait, never the request the others share.
      const { signal: _signal, ...shared } = init ?? {};
      const answer = fetch(url, shared).then(async (response): Promise<ICaptured> => ({
        status: response.status,
        statusText: response.statusText,
        headers: [...response.headers],
        body: await response.text(),
      }));
      const entry: { answer: Promise<ICaptured>; settledAt: number | null } = {
        answer,
        settledAt: null,
      };
      held = entry;
      answer.then(
        (captured) => {
          if (held !== entry) return;
          if (captured.status >= 200 && captured.status < 300) entry.settledAt = now();
          else held = null;
        },
        () => {
          if (held === entry) held = null;
        },
      );
    }
    const response = held.answer.then(
      (captured) =>
        new Response(captured.body, {
          status: captured.status,
          statusText: captured.statusText,
          headers: captured.headers,
        }),
    );
    return withAbort(response, init?.signal);
  };
}
