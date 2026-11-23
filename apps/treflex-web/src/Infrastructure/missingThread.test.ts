import { describe, expect, it } from "vite-plus/test";

import { reportsMissingThread } from "./missingThread";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("reportsMissingThread", () => {
  it.each([
    ["the server's not-found error", json(404, { _tag: "EnvironmentResourceNotFoundError" }), true],
    ["a 404 from something else", json(404, { _tag: "RouteNotFound" }), false],
    ["a 404 without JSON", new Response("Not Found", { status: 404 }), false],
    ["a found thread", json(200, { snapshotSequence: 1 }), false],
    ["a server failure", json(500, { _tag: "EnvironmentInternalError" }), false],
  ])("%s", async (_name, response, expected) => {
    expect(await reportsMissingThread(response)).toBe(expected);
  });
});
