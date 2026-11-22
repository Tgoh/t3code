import { createTestRuntime, settled } from "treflex";
import { describe, expect, it } from "vite-plus/test";

import { serverFailure } from "./Infrastructure/serverError";
import { searchMessages } from "./messageSearch";

describe("searchMessages", () => {
  it("sends only the query typed last, and nothing for the query it already holds", async () => {
    const waits: Array<() => void> = [];
    const sent: string[] = [];
    const runtime = createTestRuntime(
      { $Id: "Search", Query: "", Matches: [] },
      {
        delay: () => new Promise<void>((resolve) => waits.push(resolve)),
        searchThreads: (effect: { Query: string }) => {
          sent.push(effect.Query);
          return { Matches: [] };
        },
      },
    );
    void runtime.dispatch(searchMessages, "Search", "env-1", "foo");
    void runtime.dispatch(searchMessages, "Search", "env-1", "foob");
    await settled();
    for (const wake of waits) wake();
    await settled();
    expect(sent).toEqual(["foob"]);
    expect(runtime.state.Query).toBe("foob");

    void runtime.dispatch(searchMessages, "Search", "env-1", "fooba");
    void runtime.dispatch(searchMessages, "Search", "env-1", "foob");
    await settled();
    for (const wake of waits) wake();
    await settled();
    expect(sent).toEqual(["foob"]);
    expect(runtime.state.Query).toBe("foob");
  });

  it("marks a search the server failed, and clears the mark on the next one that works", async () => {
    let fail = true;
    const runtime = createTestRuntime(
      { $Id: "Search", Query: "", Matches: [], Failed: false },
      {
        delay: () => Promise.resolve(),
        searchThreads: () => {
          if (fail) throw serverFailure("down");
          return { Matches: [] };
        },
      },
    );
    await runtime.dispatch(searchMessages, "Search", "env-1", "foo");
    expect(runtime.state).toMatchObject({ Query: "foo", Matches: [], Failed: true });
    fail = false;
    await runtime.dispatch(searchMessages, "Search", "env-1", "foob");
    expect(runtime.state).toMatchObject({ Query: "foob", Failed: false });
  });
});
