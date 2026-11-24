import { render } from "@solidjs/web";
import { createSignal, flush, For } from "solid-js";
import { describe, expect, it, vi } from "vite-plus/test";

import { Highlighted } from "./Highlighted";

vi.mock("@t3tools/shared/paletteSearch", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@t3tools/shared/paletteSearch")>();
  return {
    ...actual,
    splitSearchText: (text: string, ranges: Parameters<typeof actual.splitSearchText>[1]) => {
      if (text.startsWith("bad")) throw new Error(`can't split ${text}`);
      return actual.splitSearchText(text, ranges);
    },
  };
});

describe("Highlighted", () => {
  it("shows a line that fails to split as plain text, leaving its siblings marked", () => {
    const [lines, setLines] = createSignal(["good one", "bad two"]);
    const onError = vi.fn();
    const host = document.createElement("div");
    const dispose = render(
      () => (
        <>
          <p>header</p>
          <For each={lines()} keyed={false}>
            {(line) => (
              <div>
                <Highlighted text={line()} ranges={[{ start: 0, end: 4 }]} />
              </div>
            )}
          </For>
        </>
      ),
      host,
      undefined,
      { onError },
    );
    const rows = () => [...host.querySelectorAll("div")].map((row) => row.innerHTML);
    expect(host.querySelector("p")?.textContent).toBe("header");
    expect(rows()).toEqual(["<mark>good</mark> one", "bad two"]);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toEqual(new Error("can't split bad two"));

    setLines(["good one", "fine two"]);
    flush();
    expect(rows()).toEqual(["<mark>good</mark> one", "<mark>fine</mark> two"]);
    dispose();
  });
});
