import { render } from "@solidjs/web";
import { createSignal, Errored, flush, For } from "solid-js";
import { describe, expect, it, vi } from "vite-plus/test";

import { CommandOutput } from "./CommandOutput";

const output = (Text: string) => ({ Text, Truncated: false, Running: false, Error: null });
const [outputs, setOutputs] = createSignal<Record<string, ReturnType<typeof output>>>({});

vi.mock("./Environment", () => ({ default: { use: () => ({ colorScheme: () => "dark" }) } }));
vi.mock("./ThreadSession", () => ({
  default: {
    use: () => ({
      state: {
        get CommandOutputs() {
          return outputs();
        },
      },
    }),
  },
}));
vi.mock("treflex-solid", () => ({
  useResource: (read: () => unknown) => ({ value: read }),
}));
vi.mock("@t3tools/shared/terminalOutput", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@t3tools/shared/terminalOutput")>();
  return {
    ...actual,
    terminalOutputSpans: (...args: Parameters<typeof actual.terminalOutputSpans>) => {
      if (args[0].startsWith("bad")) throw new Error(`can't parse ${args[0]}`);
      return actual.terminalOutputSpans(...args);
    },
  };
});

describe("CommandOutput", () => {
  it("shows output that fails to parse as plain text in its own pre, leaving the rest up", () => {
    setOutputs({ a: output("\u001b[31mred\u001b[0m"), b: output("bad \u001b[31mraw") });
    const onError = vi.fn();
    using logged = vi.spyOn(console, "error");
    const host = document.createElement("div");
    const dispose = render(
      () => (
        <Errored fallback="crashed">
          <p>header</p>
          <For each={["a", "b"]}>{(id) => <CommandOutput itemId={id} />}</For>
        </Errored>
      ),
      host,
      undefined,
      { onError },
    );
    const pres = () => [...host.querySelectorAll("pre")];
    expect(host.querySelector("p")?.textContent).toBe("header");
    expect(pres()[0]?.querySelector("span")?.textContent).toBe("red");
    expect(pres()[1]?.innerHTML).toBe("bad \u001b[31mraw");
    expect(onError).toHaveBeenCalledTimes(1);
    expect(logged).not.toHaveBeenCalled();

    const fallback = pres()[1];
    setOutputs({ a: output("\u001b[31mred\u001b[0m"), b: output("fine \u001b[32mgreen") });
    flush();
    expect(pres()[1]).toBe(fallback);
    expect(pres()[1]?.querySelector("span")?.textContent).toBe("green");
    dispose();
  });
});
