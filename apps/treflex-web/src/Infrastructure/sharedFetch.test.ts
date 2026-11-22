import { describe, expect, it } from "vite-plus/test";

import { shareResponses } from "./sharedFetch";

const PATH = "/.well-known/t3/environment";
const URL_ = `http://host${PATH}`;

function rig(answers: Array<() => Promise<Response>> = []) {
  const calls: string[] = [];
  const pending: Array<(response: Response) => void> = [];
  let clock = 0;
  const fetch = (input: RequestInfo | URL) => {
    calls.push(String(input));
    const next = answers.shift();
    if (next !== undefined) return next();
    return new Promise<Response>((resolve) => pending.push(resolve));
  };
  const shared = shareResponses(fetch, PATH, 5_000, () => clock);
  return {
    calls,
    shared,
    answer: (body: string, status = 200) => pending.shift()!(new Response(body, { status })),
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe("shareResponses", () => {
  it("answers serial and concurrent reads of the path from one request, each with its own body", async () => {
    const { calls, shared, answer } = rig();
    const first = shared(URL_);
    const second = shared(new URL(URL_), { method: "GET" });
    answer('{"environmentId":"e"}');
    expect(await (await first).json()).toEqual({ environmentId: "e" });
    expect(await (await second).json()).toEqual({ environmentId: "e" });
    expect(await (await shared(URL_)).text()).toBe('{"environmentId":"e"}');
    expect(calls).toEqual([URL_]);
  });

  it("reads again once the answer is older than the hold", async () => {
    const { calls, shared, answer, advance } = rig();
    const first = shared(URL_);
    answer("one");
    await first;
    advance(5_001);
    const second = shared(URL_);
    answer("two");
    expect(await (await second).text()).toBe("two");
    expect(calls).toHaveLength(2);
  });

  it("holds neither an error status nor a network failure", async () => {
    const { calls, shared } = rig([
      async () => new Response("down", { status: 502 }),
      () => Promise.reject(new TypeError("offline")),
      async () => new Response("up"),
    ]);
    expect((await shared(URL_)).status).toBe(502);
    await expect(shared(URL_)).rejects.toThrow("offline");
    expect(await (await shared(URL_)).text()).toBe("up");
    expect(calls).toHaveLength(3);
  });

  it("sends a no-store read, another path, or another method to the network", async () => {
    const { calls, shared } = rig([
      async () => new Response("a"),
      async () => new Response("b"),
      async () => new Response("c"),
      async () => new Response("d"),
    ]);
    await shared(URL_);
    await shared(URL_, { cache: "no-store" });
    await shared("http://host/api/auth/session");
    await shared(URL_, { method: "POST" });
    expect(calls).toHaveLength(4);
  });

  it("ends only the aborted caller's wait", async () => {
    const { calls, shared, answer } = rig();
    const controller = new AbortController();
    const aborted = shared(URL_, { signal: controller.signal });
    const kept = shared(URL_);
    controller.abort(new Error("timed out"));
    await expect(aborted).rejects.toThrow("timed out");
    answer("ok");
    expect(await (await kept).text()).toBe("ok");
    expect(calls).toHaveLength(1);
  });
});
