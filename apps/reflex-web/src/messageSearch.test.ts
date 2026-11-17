import { createTestRuntime, settled } from "treflex";
import { describe, expect, it } from "vite-plus/test";

import { searchMessages } from "./messageSearch";
import { watchRuntime } from "./testing/watchRuntime";

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
    watchRuntime(runtime);
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
});
