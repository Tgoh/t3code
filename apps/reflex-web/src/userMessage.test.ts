import { describe, expect, it } from "vite-plus/test";

import {
  contextThreadTarget,
  displayText,
  type ISentMessage,
  messageFold,
  steerLabel,
  threadLinkTarget,
} from "./userMessage";

const ENV = "env-here";
const titles: Record<string, string> = { sender: "Delegate: fix sidebar", other: "Other thread" };
const title = (threadId: string) => titles[threadId];

const message = (fields: Partial<ISentMessage>): ISentMessage =>
  ({ text: "hello", createdBy: "user", creationSource: "web", ...fields }) as ISentMessage;

describe("messageFold", () => {
  it("leaves the user's own and T3 Code's messages open", () => {
    expect(messageFold(message({}), ENV, title)).toBeNull();
    expect(
      messageFold(message({ createdBy: "agent", creationSource: "server" }), ENV, title),
    ).toBeNull();
  });

  it("folds another thread's message under its title and first non-empty line", () => {
    const fold = messageFold(
      message({
        createdBy: "agent",
        creationSource: "mcp",
        senderThreadId: "sender",
        text: "\n  Done: [notes.md](t3-context://v1/file/notes) merged  \nmore",
      } as never),
      ENV,
      title,
    );
    expect(fold).toEqual({
      Kind: "agent",
      Label: "Delegate: fix sidebar",
      Summary: "Done: notes.md merged",
      Sender: {
        Ref: { environmentId: ENV, threadId: "sender" },
        Title: "Delegate: fix sidebar",
        Openable: true,
      },
    });
  });

  it("names an unknown sender Agent, and a linked machine's sender by its sent title", () => {
    const agent = { createdBy: "agent", creationSource: "mcp" } as const;
    expect(
      messageFold(message({ ...agent, senderThreadId: "gone" } as never), ENV, title)?.Label,
    ).toBe("Agent");
    expect(messageFold(message(agent as never), ENV, title)?.Sender).toBeNull();
    expect(
      messageFold(
        message({
          ...agent,
          linkedSender: { environmentId: "env-far", threadId: "t", title: "Far thread" },
        } as never),
        ENV,
        title,
      )?.Sender,
    ).toMatchObject({ Title: "Far thread", Openable: false });
  });

  it("folds an automation to its first line", () => {
    expect(
      messageFold(
        message({ scheduledTaskId: "task", text: "Run the sync\nsteps" } as never),
        ENV,
        title,
      ),
    ).toMatchObject({ Kind: "automation", Label: "Automation", Summary: "Run the sync" });
  });

  it("shows a guest's own words", () => {
    expect(
      displayText(
        message({
          text: "Sam says: hi",
          context: {
            version: 1,
            records: [],
            guest: { guestMessageId: "g", name: "Sam", text: "hi" },
          },
        } as never),
      ),
    ).toBe("hi");
  });
});

describe("steerLabel", () => {
  it("labels steers only, and an unread one as waiting", () => {
    expect(steerLabel("turn_start", "completed")).toBeNull();
    expect(steerLabel("queued_turn", "completed")).toBeNull();
    expect(steerLabel("steer", "completed")?.Text).toBe("Steer");
    expect(steerLabel("steer", "pending")?.Text).toBe("Steer · waiting to be read");
    expect(steerLabel("promoted_queued_to_steer", "completed")?.Tip).toMatch(/Originally queued/);
  });
});

describe("threadLinkTarget", () => {
  it("ignores other links", () => {
    expect(threadLinkTarget("https://example.com", null, ENV, title)).toBeNull();
  });

  it("opens v1, v2 and hosted links to this environment with the current title", () => {
    for (const href of [
      "t3-thread://v1/other",
      `t3-thread://v2/${ENV}/other`,
      `https://app.t3.codes/threads/${ENV}/other`,
    ]) {
      expect(threadLinkTarget(href, "written", ENV, title)).toEqual({
        Ref: { environmentId: ENV, threadId: "other" },
        Title: "Other thread",
        Openable: true,
      });
    }
  });

  it("keeps the written label for a thread the shell doesn't hold", () => {
    expect(threadLinkTarget("t3-thread://v1/old", "Old work", ENV, title)).toMatchObject({
      Title: "Old work",
      Openable: true,
    });
    expect(threadLinkTarget("t3-thread://v1/old", null, ENV, title)).toMatchObject({
      Title: "Thread",
    });
  });

  it("names another machine's thread without opening it", () => {
    expect(threadLinkTarget("t3-thread://v2/env-far/x", null, ENV, title)).toEqual({
      Unknown: "Thread on another machine",
    });
  });
});

describe("contextThreadTarget", () => {
  const record = {
    version: 1,
    kind: "thread",
    contextId: "thread_other",
    label: "Old title",
    environmentId: ENV,
    threadId: "other",
    title: "Old title",
  };
  const held = { context: { version: 1, records: [record] } } as never;

  it("resolves a thread chip through the message's records", () => {
    expect(contextThreadTarget("t3-context://v1/thread/thread_other", held, ENV, title)).toEqual({
      Ref: { environmentId: ENV, threadId: "other" },
      Title: "Other thread",
      Openable: true,
    });
    expect(contextThreadTarget("t3-context://v1/thread/missing", held, ENV, title)).toBeNull();
    expect(contextThreadTarget("t3-context://v1/file/thread_other", held, ENV, title)).toBeNull();
  });
});
