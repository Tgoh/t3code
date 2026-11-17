import {
  EnvironmentRegistry,
  type EnvironmentSupervisor,
} from "@t3tools/client-runtime/connection";
import { request, subscribeDynamic } from "@t3tools/client-runtime/rpc";
import {
  EnvironmentId,
  type TerminalAttachStreamEvent,
  type TerminalSessionStatus,
  WS_METHODS,
} from "@t3tools/contracts";
import { projectScriptRuntimeEnv } from "@t3tools/shared/projectScripts";
import { TERMINAL_PALETTES } from "@t3tools/shared/terminalOutput";
import * as Effect from "effect/Effect";
import type { IResourceImplementation } from "treflex";

import type { IColorScheme } from "../colorScheme";
import { connectionRuntime } from "./connection";
import { failureText, followLive } from "./followItems";

export type ITerminalStatus = TerminalSessionStatus | "closed";

export interface ITerminalView {
  mount(element: HTMLElement, focus: boolean): () => void;
}

declare module "treflex" {
  interface IResourceTypeRegistry {
    terminalSession: {
      Params: {
        EnvironmentId: string;
        ThreadId: string;
        TerminalId: string;
        Cwd: string;
        WorktreePath: string | null;
        ProjectRoot: string;
      };
      Message: { Status: ITerminalStatus; Error: string | null };
      Methods: { setScheme(scheme: IColorScheme): void };
      Value: ITerminalView;
    };
  }
}

// terminal.write takes at most 65,536 characters.
const WRITE_CHUNK = 60_000;

function nextChunk(input: string): string {
  const end = Math.min(input.length, WRITE_CHUNK);
  const code = input.charCodeAt(end - 1);
  const splitsSurrogate = end < input.length && code >= 0xd800 && code <= 0xdbff;
  return input.slice(0, splitsSurrogate ? end - 1 : end);
}

// The tokens are var() chains, which getPropertyValue returns unresolved and xterm can't parse.
function terminalTheme(scheme: IColorScheme) {
  const probe = document.createElement("div");
  document.body.append(probe);
  const read = (token: string) => {
    probe.style.color = `var(${token})`;
    return getComputedStyle(probe).color;
  };
  const [
    black,
    red,
    green,
    yellow,
    blue,
    magenta,
    cyan,
    white,
    brightBlack,
    brightRed,
    brightGreen,
    brightYellow,
    brightBlue,
    brightMagenta,
    brightCyan,
    brightWhite,
  ] = TERMINAL_PALETTES[scheme];
  const theme = {
    background: read("--terminal-background"),
    foreground: read("--terminal-foreground"),
    cursor: read("--terminal-cursor"),
    selectionBackground: read("--terminal-selection-background"),
    black,
    red,
    green,
    yellow,
    blue,
    magenta,
    cyan,
    white,
    brightBlack,
    brightRed,
    brightGreen,
    brightYellow,
    brightBlue,
    brightMagenta,
    brightCyan,
    brightWhite,
  };
  probe.remove();
  return theme;
}

export const terminalSession: IResourceImplementation<"terminalSession"> = async (params, r) => {
  // Methods register only before the first await, so a scheme that arrives while xterm loads waits here.
  let scheme: IColorScheme = "light";
  let applyScheme = () => {};
  r.methods({
    setScheme: (_ctx, next) => {
      scheme = next;
      applyScheme();
    },
  });
  const [{ Terminal }, { FitAddon }] = await Promise.all([
    import("@xterm/xterm"),
    import("@xterm/addon-fit"),
    import("@xterm/xterm/css/xterm.css"),
  ]);
  const terminal = new Terminal({
    cursorBlink: false,
    disableStdin: true,
    fontFamily: getComputedStyle(document.documentElement).getPropertyValue("--font-mono"),
    fontSize: 12,
    scrollback: 10_000,
    theme: terminalTheme(scheme),
  });
  const fit = new FitAddon();
  terminal.loadAddon(fit);
  applyScheme = () => {
    terminal.options.theme = terminalTheme(scheme);
  };

  const ids = { threadId: params.ThreadId, terminalId: params.TerminalId };
  const environmentId = EnvironmentId.make(params.EnvironmentId);
  let status: ITerminalStatus = "starting";
  const accepting = () => status === "starting" || status === "running";
  const setStatus = (next: ITerminalStatus) => {
    status = next;
    terminal.options.disableStdin = !accepting();
    void r.emit({ Status: next, Error: null });
  };

  let input = "";
  let grid: { cols: number; rows: number } | null = null;
  let pumping = false;
  const rpc = <A, E>(effect: Effect.Effect<A, E, EnvironmentSupervisor.EnvironmentSupervisor>) =>
    connectionRuntime.runPromise(
      EnvironmentRegistry.EnvironmentRegistry.pipe(
        Effect.flatMap((registry) => registry.run(environmentId, effect)),
      ),
    );
  const sendNext = (): Promise<unknown> => {
    if (grid !== null) {
      const size = grid;
      grid = null;
      return rpc(request(WS_METHODS.terminalResize, { ...ids, ...size }));
    }
    const data = nextChunk(input);
    input = input.slice(data.length);
    return rpc(request(WS_METHODS.terminalWrite, { ...ids, data }));
  };
  // One request at a time keeps keystrokes in order and coalesces what arrives during a round trip.
  const pump = async () => {
    if (pumping) return;
    pumping = true;
    while (!r.signal.aborted && (grid !== null || input !== "")) {
      await sendNext().catch((error: unknown) => {
        void r.emit({
          Status: status,
          Error: error instanceof Error ? error.message : String(error),
        });
      });
    }
    pumping = false;
  };

  // History can hold the shell's own queries (ConPTY asks for the cursor position). Replaying them
  // makes the emulator answer, which would type the answers into the live shell.
  let replays = 0;
  terminal.onData((data) => {
    if (replays > 0) return;
    input += data;
    void pump();
  });
  let replied = false;
  // The attach carries the grid, and a resize ahead of it fails on a shell that doesn't exist yet.
  terminal.onResize(({ cols, rows }) => {
    if (!replied || !accepting()) return;
    grid = { cols, rows };
    void pump();
  });
  terminal.attachCustomKeyEventHandler((event) => {
    if (event.type !== "keydown" || !(event.ctrlKey || event.metaKey) || event.shiftKey)
      return true;
    const key = event.key.toLowerCase();
    // False hands the key to the browser, whose copy and paste events the emulator listens for.
    // Otherwise Ctrl+V sends ^V and Ctrl+C can't copy a selection.
    return !(key === "v" || (key === "c" && terminal.hasSelection()));
  });

  let markMounted!: () => void;
  const mounted = new Promise<void>((resolve) => {
    markMounted = resolve;
  });
  r.expose(
    {
      mount(element, focus) {
        if (terminal.element === undefined) terminal.open(element);
        else element.append(terminal.element);
        fit.fit();
        const observer = new ResizeObserver(() => fit.fit());
        observer.observe(element);
        if (focus) terminal.focus();
        markMounted();
        return () => observer.disconnect();
      },
    },
    () => terminal.dispose(),
  );
  await mounted;

  const replay = (
    snapshot: Extract<TerminalAttachStreamEvent, { type: "snapshot" }>["snapshot"],
  ) => {
    replays += 1;
    terminal.reset();
    terminal.write(snapshot.history, () => {
      replays -= 1;
    });
    setStatus(snapshot.status);
    if (accepting() && (snapshot.cols !== terminal.cols || snapshot.rows !== terminal.rows)) {
      grid = { cols: terminal.cols, rows: terminal.rows };
      void pump();
    }
  };

  const events = subscribeDynamic(
    WS_METHODS.terminalAttach,
    () =>
      Effect.sync(() => ({
        ...ids,
        cwd: params.Cwd,
        worktreePath: params.WorktreePath,
        cols: terminal.cols,
        rows: terminal.rows,
        env: projectScriptRuntimeEnv({
          project: { cwd: params.ProjectRoot },
          worktreePath: params.WorktreePath,
        }),
        ...(replied ? { resume: true } : { restartIfNotRunning: true }),
      })),
    {
      onExpectedFailure: (cause) =>
        Effect.sync(() => {
          status = "error";
          terminal.options.disableStdin = true;
          void r.emit({ Status: "error", Error: failureText(cause) });
        }),
    },
  );
  return followLive(r, params.EnvironmentId, events, (event) =>
    Effect.sync(() => {
      replied = true;
      switch (event.type) {
        case "snapshot":
        case "restarted":
          replay(event.snapshot);
          return;
        case "output":
          terminal.write(event.data);
          if (status === "starting") setStatus("running");
          return;
        case "cleared":
          terminal.reset();
          return;
        case "exited":
          terminal.write("\r\n[process exited]\r\n");
          setStatus("exited");
          return;
        case "closed":
          setStatus("closed");
          return;
        case "error":
          void r.emit({ Status: status, Error: event.message });
          return;
        case "activity":
          return;
        default:
          event satisfies never;
      }
    }),
  );
};
