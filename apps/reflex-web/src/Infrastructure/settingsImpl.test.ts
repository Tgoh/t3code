import { ClientSettingsSchema, DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { IWireClientSettings } from "./settings";
import { storeClientSettingsImpl, storedClientSettingsImpl } from "./settingsImpl";

vi.mock("./commandsImpl", () => ({ inEnvironment: vi.fn(), onceRegistered: vi.fn() }));

const encodeSaved = Schema.encodeSync(Schema.toCodecJson(ClientSettingsSchema));

const KEY = "t3code:client-settings:v1";

function stubStorage(entries: Record<string, string>) {
  const held = new Map(Object.entries(entries));
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => held.get(key) ?? null,
    setItem: (key: string, value: string) => void held.set(key, value),
  });
  return held;
}

const read = () =>
  storedClientSettingsImpl.fn({ Type: "storedClientSettings" }) as IWireClientSettings;

describe("client settings in localStorage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("loads a value the previous build saved, and saves it back unchanged", () => {
    const saved = JSON.stringify(
      encodeSaved({
        ...DEFAULT_CLIENT_SETTINGS,
        chatWidth: "wide",
        followUpBehavior: "steer",
      }),
    );
    const held = stubStorage({ [KEY]: saved, "reflex:follow-up-queue-default:v1": "1" });
    const loaded = read();
    expect(loaded).toMatchObject({ chatWidth: "wide", followUpBehavior: "steer" });

    storeClientSettingsImpl.fn({ Type: "storeClientSettings", Settings: loaded });
    expect(held.get(KEY)).toBe(saved);
  });

  it("fills the keys an older value lacks with their defaults", () => {
    stubStorage({ [KEY]: '{"chatWidth":"wide"}', "reflex:follow-up-queue-default:v1": "1" });
    expect(read()).toMatchObject({ chatWidth: "wide", confirmThreadDelete: true });
  });
});
