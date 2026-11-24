import { render } from "@solidjs/web";
import { createSignal, Errored, flush, For } from "solid-js";
import { describe, expect, it, vi } from "vite-plus/test";

import type { IWireTurnItem } from "./Infrastructure/wire";
import { ToolInspector } from "./ToolInspector";

vi.mock("./Environment", () => ({ default: { use: () => ({ colorScheme: () => "dark" }) } }));
vi.mock("./ThreadSession", () => ({ default: {} }));
vi.mock("./Markdown", () => ({ ViewedImage: () => null }));
vi.mock("./workspaceRoot", () => ({ useWorkspaceRoot: () => () => undefined }));
vi.mock("./codeHighlight", () => ({
  cachedHighlight: (code: string) => {
    if (code.includes("bad")) throw new Error(`can't highlight ${code}`);
    return `<b>${code}</b>`;
  },
  highlight: async () => "",
}));

const command = (input: string, output: string) =>
  ({ type: "command_execution", input, output }) as unknown as IWireTurnItem;

describe("ToolInspector", () => {
  it("shows a command and output that fail to highlight as plain text, leaving the rest up", () => {
    const [items, setItems] = createSignal([
      command("echo ok", '{"ok":1}'),
      command("echo bad", '{"bad":1}'),
    ]);
    const onError = vi.fn();
    using logged = vi.spyOn(console, "error");
    const host = document.createElement("div");
    const dispose = render(
      () => (
        <Errored fallback="crashed">
          <p>header</p>
          <For each={items()}>
            {(item) => (
              <section>
                <ToolInspector id="row" item={item} detail={undefined} liveOutput={false} />
              </section>
            )}
          </For>
        </Errored>
      ),
      host,
      undefined,
      { onError },
    );
    const rows = () =>
      [...host.querySelectorAll("section")].map((row) => [
        row.querySelector(".text-foreground\\/85")?.innerHTML,
        row.querySelector("pre")?.innerHTML,
      ]);
    expect(host.querySelector("p")?.textContent).toBe("header");
    expect(rows()[1]).toEqual(["echo bad", '{"bad":1}']);
    expect(rows()[0]?.join("")).toContain("<b>echo ok</b>");
    expect(rows()[0]?.join("")).toContain('<b>{"ok":1}</b>');
    expect(onError).toHaveBeenCalledTimes(2);
    expect(logged).not.toHaveBeenCalled();

    setItems([command("echo ok", '{"ok":1}'), command("echo fine", '{"fine":1}')]);
    flush();
    expect(rows()[1]?.join("")).toContain("<b>echo fine</b>");
    expect(rows()[1]?.join("")).toContain('<b>{"fine":1}</b>');
    dispose();
  });
});
