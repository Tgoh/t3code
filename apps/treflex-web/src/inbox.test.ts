import { describe, expect, it } from "vite-plus/test";

import {
  expireInbox,
  type IInbox,
  type IInboxFacts,
  inboxDeadline,
  isWorkingIn,
  observeInbox,
} from "./inbox";

const facts = (overrides: Partial<IInboxFacts> = {}): IInboxFacts => ({
  Id: "t-1",
  Working: true,
  Actionable: false,
  Excluded: false,
  Placement: "p",
  EndedAt: null,
  ...overrides,
});

const empty = (): IInbox => ({ Entries: {}, Returns: {} });

describe("the Working shelf's exit grace", () => {
  it("holds a thread that stopped working for two seconds, then returns it to the inbox", () => {
    const inbox = empty();
    observeInbox(inbox, [facts()], 1_000);
    expect(isWorkingIn(inbox, "t-1", false)).toBe(true);
    observeInbox(inbox, [facts({ Working: false, EndedAt: 1_000 })], 1_500);
    expect(isWorkingIn(inbox, "t-1", false)).toBe(true);
    expect(inboxDeadline(inbox)).toBe(3_500);
    expireInbox(inbox, 3_499);
    expect(isWorkingIn(inbox, "t-1", false)).toBe(true);
    expireInbox(inbox, 3_500);
    expect(isWorkingIn(inbox, "t-1", false)).toBe(false);
    expect(inbox.Returns["t-1"]).toBe(3_500);
    expect(inboxDeadline(inbox)).toBeNull();
  });

  it("keeps the first deadline while the thread stays stopped", () => {
    const inbox = empty();
    observeInbox(inbox, [facts()], 1_000);
    observeInbox(inbox, [facts({ Working: false })], 1_500);
    observeInbox(inbox, [facts({ Working: false })], 2_500);
    expect(inboxDeadline(inbox)).toBe(3_500);
  });

  it.each([
    ["needs the user", { Actionable: true }],
    ["moved to another section", { Placement: "pinned" }],
    ["is pinned, settled or snoozed", { Excluded: true }],
    ["ended long ago", { EndedAt: 1_500 - 60_000 }],
  ])("returns a thread at once when it %s", (_label, change) => {
    const inbox = empty();
    observeInbox(inbox, [facts()], 1_000);
    observeInbox(inbox, [facts({ Working: false, ...change })], 1_500);
    expect(isWorkingIn(inbox, "t-1", false)).toBe(false);
    expect(inbox.Returns["t-1"]).toBe(1_500);
  });

  it("starts working again without a return", () => {
    const inbox = empty();
    observeInbox(inbox, [facts()], 1_000);
    observeInbox(inbox, [facts({ Working: false })], 1_500);
    observeInbox(inbox, [facts()], 2_000);
    expect(isWorkingIn(inbox, "t-1", false)).toBe(true);
    expect(inbox.Returns["t-1"]).toBeUndefined();
    expect(inboxDeadline(inbox)).toBeNull();
  });

  it("forgets threads that leave the shell, and reads unseen ones by their own state", () => {
    const inbox = empty();
    observeInbox(inbox, [facts()], 1_000);
    observeInbox(inbox, [facts({ Working: false, Actionable: true })], 1_500);
    observeInbox(inbox, [], 2_000);
    expect(inbox).toEqual(empty());
    expect(isWorkingIn(inbox, "t-1", true)).toBe(true);
  });
});
