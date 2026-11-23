import { ORCHESTRATION_V2_WS_METHODS, WS_METHODS } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  ENVIRONMENT_ID,
  type IFakeResource,
  sessionSwap,
  startResource,
} from "../testing/sessionSwap";
import { reportActivityImpl } from "./clientActivityImpl";
import { commandOutput } from "./commandOutput";
import { projectClones } from "./projectClones";
import { serverConfigStream } from "./serverConfigStream";
import { shellStream } from "./shellStream";
import { terminalSession } from "./terminalSession";
import { threadStream } from "./threadStream";
import { vcsStatus } from "./vcsStatus";

vi.mock("./connection", async () => (await import("../testing/sessionSwap")).connectionMock);

const xterm = vi.hoisted(() => ({ writes: [] as string[], onWrite: () => {} }));
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit() {}
  },
}));
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    options: Record<string, unknown> = {};
    cols = 80;
    rows = 24;
    element: unknown = undefined;
    loadAddon() {}
    onData() {}
    onResize() {}
    attachCustomKeyEventHandler() {}
    open(element: unknown) {
      this.element = element;
    }
    focus() {}
    reset() {}
    hasSelection() {
      return false;
    }
    dispose() {}
    write(data: string, done?: () => void) {
      xterm.writes.push(data);
      done?.();
      xterm.onWrite();
    }
  },
}));

interface ICase {
  name: string;
  tag: string;
  start: (context: never) => unknown;
  event: (marker: string) => unknown;
  input?: unknown;
  /** What the resource has passed on so far, one entry per event. */
  delivered: (resource: IFakeResource) => unknown[];
}

const items = (resource: IFakeResource) =>
  resource.messages.filter((message) => typeof message === "object" && "Item" in message!);
const values = (resource: IFakeResource) => resource.values;

const keybindingsUpdated = (marker: string) => ({
  version: 1,
  type: "keybindingsUpdated",
  payload: { keybindings: [], issues: [{ kind: "keybindings.malformed-config", message: marker }] },
});

const CASES: ICase[] = [
  {
    name: "shellStream",
    tag: ORCHESTRATION_V2_WS_METHODS.subscribeShell,
    start: (r) => shellStream({ Type: "shellStream", EnvironmentId: ENVIRONMENT_ID }, r),
    event: () => ({ kind: "synchronized" }),
    delivered: items,
  },
  {
    name: "threadStream",
    tag: ORCHESTRATION_V2_WS_METHODS.subscribeThread,
    start: (r) =>
      threadStream(
        { Type: "threadStream", EnvironmentId: ENVIRONMENT_ID, ThreadId: "thread-1" },
        r,
      ),
    event: () => ({ kind: "synchronized" }),
    delivered: items,
  },
  {
    name: "serverConfigStream",
    tag: WS_METHODS.subscribeServerConfig,
    start: (r) =>
      serverConfigStream({ Type: "serverConfigStream", EnvironmentId: ENVIRONMENT_ID }, r),
    event: keybindingsUpdated,
    input: { usageLimitSources: true },
    delivered: items,
  },
  {
    name: "vcsStatus",
    tag: WS_METHODS.subscribeVcsStatus,
    start: (r) => vcsStatus({ Type: "vcsStatus", EnvironmentId: ENVIRONMENT_ID, Cwd: "/repo" }, r),
    event: (marker) => ({
      _tag: "snapshot",
      local: { isRepo: true, refName: marker },
      remote: null,
    }),
    delivered: values,
  },
  {
    name: "projectClones",
    tag: WS_METHODS.subscribeProjectClones,
    start: (r) => projectClones({ Type: "projectClones", EnvironmentId: ENVIRONMENT_ID }, r),
    event: (marker) => [{ id: marker }],
    delivered: values,
  },
  {
    name: "commandOutput",
    tag: ORCHESTRATION_V2_WS_METHODS.subscribeCommandOutput,
    start: (r) =>
      commandOutput(
        {
          Type: "commandOutput",
          EnvironmentId: ENVIRONMENT_ID,
          ThreadId: "thread-1",
          ItemId: "item-1",
        },
        r,
      ),
    event: (marker) => ({ kind: "replace", text: marker, truncated: false, running: true }),
    delivered: values,
  },
];

describe("a session swap", () => {
  it.each(CASES)("moves $name onto the new session", async (test) => {
    const sessions = sessionSwap();
    const resource = startResource(test.start);
    const delivered = () => test.delivered(resource).length;
    try {
      const first = sessions.current;
      const input = await first.opened(test.tag);
      if (test.input !== undefined) expect(input).toEqual(test.input);
      first.push(test.tag, test.event("first"));
      await resource.until(() => delivered() === 1);

      const second = sessions.swap();
      const reopened = await second.opened(test.tag);
      if (test.input !== undefined) expect(reopened).toEqual(test.input);
      await first.ended(test.tag);
      second.push(test.tag, test.event("second"));
      await resource.until(() => delivered() === 2);
      expect(JSON.stringify(test.delivered(resource)[1])).not.toContain("first");
    } finally {
      resource.close();
    }
  });

  it("reattaches the terminal to the new session, resuming the same shell", async () => {
    vi.stubGlobal("document", {
      createElement: () => ({ style: {}, remove() {} }),
      body: { append() {} },
      documentElement: {},
    });
    vi.stubGlobal("getComputedStyle", () => ({ color: "", getPropertyValue: () => "" }));
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    xterm.writes.length = 0;
    const sessions = sessionSwap();
    const resource = startResource((r) =>
      terminalSession(
        {
          Type: "terminalSession",
          EnvironmentId: ENVIRONMENT_ID,
          ThreadId: "thread-1",
          TerminalId: "default",
          Cwd: "/repo",
          WorktreePath: null,
          ProjectRoot: "/repo",
        },
        r,
      ),
    );
    xterm.onWrite = resource.changed;
    try {
      await resource.until(() => resource.values.length > 0);
      (resource.values[0] as { mount(element: unknown, focus: boolean): void }).mount({}, false);
      const first = sessions.current;
      expect(await first.opened(WS_METHODS.terminalAttach)).toMatchObject({
        restartIfNotRunning: true,
      });
      first.push(WS_METHODS.terminalAttach, { type: "output", data: "first" });
      await resource.until(() => xterm.writes.includes("first"));

      const second = sessions.swap();
      expect(await second.opened(WS_METHODS.terminalAttach)).toMatchObject({ resume: true });
      await first.ended(WS_METHODS.terminalAttach);
      second.push(WS_METHODS.terminalAttach, { type: "output", data: "second" });
      await resource.until(() => xterm.writes.includes("second"));
    } finally {
      resource.close();
      vi.unstubAllGlobals();
    }
  });

  it("sends the next activity report on the new session", async () => {
    const sessions = sessionSwap();
    const report = () =>
      reportActivityImpl.fn({
        Type: "reportActivity",
        EnvironmentId: ENVIRONMENT_ID,
        Visible: true,
        Focused: true,
        RecentlyInteracted: false,
        Scopes: [{ type: "provider-status" }],
      });
    const first = sessions.current;
    await report();
    const second = sessions.swap();
    await report();
    expect(first.requests(WS_METHODS.serverReportClientActivity)).toHaveLength(1);
    expect(second.requests(WS_METHODS.serverReportClientActivity)).toHaveLength(1);
  });
});
