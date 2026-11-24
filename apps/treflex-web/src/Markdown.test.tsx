import { render } from "@solidjs/web";
import { createSignal, Errored, flush, For } from "solid-js";
import { describe, expect, it, vi } from "vite-plus/test";

import { Markdown } from "./Markdown";

vi.mock("./Environment", () => ({
  default: {
    use: () => ({
      colorScheme: () => "dark",
      wordWrap: () => false,
      state: { EnvironmentId: "env", Replica: { Shell: { Threads: {}, Projects: {} } } },
    }),
  },
}));
vi.mock("./workspaceRoot", () => ({ useWorkspaceRoot: () => () => undefined }));
vi.mock("./markdownTokens", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./markdownTokens")>();
  return {
    ...actual,
    createMarkdownLexer: (fromUser: boolean) => {
      const lex = actual.createMarkdownLexer(fromUser);
      return (text: string) => {
        if (text.startsWith("bad")) throw new Error(`can't lex ${text}`);
        return lex(text);
      };
    },
  };
});

describe("Markdown", () => {
  it("shows a message that fails to render as its source, leaving the rest up", () => {
    const [texts, setTexts] = createSignal(["**good** one", "bad **two**\nnext"]);
    const onError = vi.fn();
    using logged = vi.spyOn(console, "error");
    const host = document.createElement("div");
    const dispose = render(
      () => (
        <Errored fallback="crashed">
          <p>header</p>
          <For each={texts()} keyed={false}>
            {(text) => (
              <section>
                <Markdown text={text()} fromUser={false} />
              </section>
            )}
          </For>
        </Errored>
      ),
      host,
      undefined,
      { onError },
    );
    const rows = () => [...host.querySelectorAll("section")].map((row) => row.innerHTML);
    expect(host.querySelector("p")?.textContent).toBe("header");
    expect(rows()[0]).toContain("<strong>good</strong>");
    expect(rows()[1]).toBe(
      '<div class="chat-markdown whitespace-pre-wrap">bad **two**\nnext</div>',
    );
    expect(onError).toHaveBeenCalledTimes(1);
    expect(logged).not.toHaveBeenCalled();

    setTexts(["**good** one", "fine **two**"]);
    flush();
    expect(rows()[1]).toContain("<strong>two</strong>");
    dispose();
  });
});
