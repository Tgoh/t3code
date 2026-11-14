import { defineEffect, type IEffect, implementation } from "treflex";

export interface ITerminalLaunch {
  Cwd: string;
  WorktreePath: string | null;
  ProjectRoot: string;
}

interface IRememberedTerminalEffect extends IEffect {
  Type: "rememberedTerminal";
  ThreadId: string;
}

interface IRememberTerminalEffect extends IEffect {
  Type: "rememberTerminal";
  ThreadId: string;
  Launch: ITerminalLaunch | null;
}

const keyOf = (threadId: string) => `reflex-web:terminal:${threadId}`;

export const rememberedTerminalEffect = defineEffect<
  IRememberedTerminalEffect,
  ITerminalLaunch | null
>("rememberedTerminal");

export const rememberTerminalEffect = defineEffect<IRememberTerminalEffect, void>(
  "rememberTerminal",
);

export const rememberedTerminalImpl = implementation(rememberedTerminalEffect, (effect) => {
  const held = localStorage.getItem(keyOf(effect.ThreadId));
  return held === null ? null : (JSON.parse(held) as ITerminalLaunch);
});

export const rememberTerminalImpl = implementation(rememberTerminalEffect, (effect) => {
  if (effect.Launch === null) localStorage.removeItem(keyOf(effect.ThreadId));
  else localStorage.setItem(keyOf(effect.ThreadId), JSON.stringify(effect.Launch));
});
