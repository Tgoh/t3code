import { DEFAULT_TERMINAL_ID } from "@t3tools/contracts";
import { defineEffect, type IEffect, implementation } from "treflex";

import type { ITerminalLayout } from "../terminalLayout";

export interface ITerminalLaunch {
  Cwd: string;
  WorktreePath: string | null;
  ProjectRoot: string;
}

/** A thread's drawer as this device left it. */
export interface IRememberedTerminal {
  Open: boolean;
  Height: number;
  Layout: ITerminalLayout;
  Launches: Record<string, ITerminalLaunch>;
}

interface IRememberedTerminalEffect extends IEffect {
  Type: "rememberedTerminal";
  ThreadId: string;
}

interface IRememberTerminalEffect extends IEffect {
  Type: "rememberTerminal";
  ThreadId: string;
  Terminal: IRememberedTerminal | null;
}

export const DEFAULT_TERMINAL_HEIGHT = 280;

// Named before the client became treflex; renaming it would forget every open terminal.
const keyOf = (threadId: string) => `reflex-web:terminal:${threadId}`;

export const rememberedTerminalEffect = defineEffect<
  IRememberedTerminalEffect,
  IRememberedTerminal | null
>("rememberedTerminal", { settles: "sync" });

export const rememberTerminalEffect = defineEffect<IRememberTerminalEffect, void>(
  "rememberTerminal",
);

/** Before tabs, the key held one open shell's launch. */
export function readRememberedTerminal(held: unknown): IRememberedTerminal | null {
  if (typeof held !== "object" || held === null) return null;
  if ("Cwd" in held) {
    return {
      Open: true,
      Height: DEFAULT_TERMINAL_HEIGHT,
      Layout: {
        TerminalIds: [DEFAULT_TERMINAL_ID],
        Groups: [
          {
            Id: `group-${DEFAULT_TERMINAL_ID}`,
            TerminalIds: [DEFAULT_TERMINAL_ID],
            SplitDirection: "horizontal",
          },
        ],
        ActiveTerminalId: DEFAULT_TERMINAL_ID,
        ActiveGroupId: `group-${DEFAULT_TERMINAL_ID}`,
      },
      Launches: { [DEFAULT_TERMINAL_ID]: held as ITerminalLaunch },
    };
  }
  return "Layout" in held ? (held as IRememberedTerminal) : null;
}

export const rememberedTerminalImpl = implementation(rememberedTerminalEffect, (effect) => {
  const held = localStorage.getItem(keyOf(effect.ThreadId));
  if (held === null) return null;
  try {
    return readRememberedTerminal(JSON.parse(held));
  } catch {
    return null;
  }
});

export const rememberTerminalImpl = implementation(rememberTerminalEffect, (effect) => {
  if (effect.Terminal === null) localStorage.removeItem(keyOf(effect.ThreadId));
  else localStorage.setItem(keyOf(effect.ThreadId), JSON.stringify(effect.Terminal));
});
