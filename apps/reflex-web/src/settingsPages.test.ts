import {
  ClientServerSettingsPatch,
  ClientSettingsSchema,
  DEFAULT_SERVER_SETTINGS,
  ProviderInstanceMutation,
  ServerSettings,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import type {
  IWireClientSettings,
  IWireServerConfig,
  IWireServerSettings,
} from "./Infrastructure/settings";
import { keybindingGroups } from "./keybindingRows";
import {
  modelFavoritePatch,
  modelHiddenPatch,
  modelMovePatch,
  providerEnabledWrite,
  providerRows,
} from "./providerSettings";
import {
  builtSettingsPage,
  type ISettingRow,
  type ISettingsHeld,
  SETTINGS_SECTIONS,
  settingRows,
} from "./settingsPages";

const encodeServerSettings = Schema.encodeSync(Schema.toCodecJson(ServerSettings));
const encodeClientSettings = Schema.encodeSync(Schema.toCodecJson(ClientSettingsSchema));
const decodeClientDefaults = Schema.decodeUnknownSync(ClientSettingsSchema);
const decodeMutation = Schema.decodeUnknownSync(Schema.toCodecJson(ProviderInstanceMutation));

const serverSettings = (patch: Record<string, unknown> = {}): IWireServerSettings =>
  ({
    ...(encodeServerSettings(DEFAULT_SERVER_SETTINGS) as object),
    ...patch,
  }) as IWireServerSettings;
const clientSettings = (patch: Record<string, unknown> = {}): IWireClientSettings =>
  encodeClientSettings(decodeClientDefaults(patch)) as IWireClientSettings;
const held = (server = serverSettings(), client = clientSettings()): ISettingsHeld => ({
  Server: server,
  Client: client,
});

const decodePatch = Schema.decodeUnknownSync(Schema.toCodecJson(ClientServerSettingsPatch));
const decodeClient = Schema.decodeUnknownSync(Schema.toCodecJson(ClientSettingsSchema));

const row = (id: string): ISettingRow => settingRows().find((entry) => entry.Id === id)!;

describe("settings rows", () => {
  it("read stock's defaults and write a patch its schema accepts, to the store stock writes", () => {
    const serverKeys = new Set(Object.keys(ServerSettings.fields));
    for (const entry of settingRows()) {
      const value = entry.Read(held());
      expect(value, entry.Id).not.toBeNull();
      const write = entry.Write(value!);
      if (write.Store === "server") {
        expect(() => decodePatch(write.Patch), entry.Id).not.toThrow();
        for (const key of Object.keys(write.Patch)) expect(serverKeys.has(key), key).toBe(true);
      } else {
        const next = { ...clientSettings(), ...write.Patch };
        expect(() => decodeClient(next), entry.Id).not.toThrow();
        for (const key of Object.keys(write.Patch)) expect(serverKeys.has(key), key).toBe(false);
      }
    }
  });

  it("offer only values the schema accepts in each select", () => {
    for (const entry of settingRows()) {
      if (entry.Control.Kind !== "select") continue;
      for (const option of entry.Control.Options) {
        const write = entry.Write(option.Value);
        if (write.Store === "server")
          expect(() => decodePatch(write.Patch), entry.Id).not.toThrow();
        else
          expect(
            () => decodeClient({ ...clientSettings(), ...write.Patch }),
            entry.Id,
          ).not.toThrow();
      }
    }
  });

  it("map the auto-settle switch to seven days or null, and clamp the day count", () => {
    expect(row("sidebarAutoSettleEnabled").Write(false)).toEqual({
      Store: "server",
      Patch: { sidebarAutoSettleAfterDays: null },
    });
    expect(row("sidebarAutoSettleEnabled").Write(true)).toEqual({
      Store: "server",
      Patch: { sidebarAutoSettleAfterDays: 7 },
    });
    expect(row("sidebarAutoSettleAfterDays").Write(400)).toEqual({
      Store: "server",
      Patch: { sidebarAutoSettleAfterDays: 90 },
    });
    const off = held(serverSettings({ sidebarAutoSettleAfterDays: null }));
    expect(row("sidebarAutoSettleEnabled").Read(off)).toBe(false);
    expect(row("sidebarAutoSettleAfterDays").Visible?.(off)).toBe(false);
  });

  it("read a null workspace mode as Default and write Default back as null", () => {
    const workspace = row("defaultThreadEnvMode");
    expect(workspace.Read(held(serverSettings({ defaultThreadEnvMode: null })))).toBe("");
    expect(workspace.Read(held(serverSettings({ defaultThreadEnvMode: "worktree" })))).toBe(
      "worktree",
    );
    expect(workspace.Write("")).toEqual({ Store: "server", Patch: { defaultThreadEnvMode: null } });
  });

  it("map project grouping's switch to stock's modes", () => {
    const grouping = row("sidebarProjectGroupingMode");
    expect(
      grouping.Read(held(undefined, clientSettings({ sidebarProjectGroupingMode: "separate" }))),
    ).toBe(false);
    expect(grouping.Write(true)).toEqual({
      Store: "client",
      Patch: { sidebarProjectGroupingMode: "repository" },
    });
  });

  it("put tool-call visibility on the Chat page and time format on General, as client settings", () => {
    const ids = (page: keyof typeof SETTINGS_SECTIONS) =>
      SETTINGS_SECTIONS[page].flatMap((section) => section.Rows.map((entry) => entry.Id));
    expect(ids("chat")).toContain("toolCallVisibility");
    expect(ids("general")).toContain("timestampFormat");
    expect(row("toolCallVisibility").Write("zen")).toEqual({
      Store: "client",
      Patch: { toolCallVisibility: "zen" },
    });
  });

  it("show the server rows as unavailable before the config arrives", () => {
    expect(row("ghqCloneLayout").Read({ Server: null, Client: clientSettings() })).toBeNull();
  });

  it("fall back to General for pages this client hasn't built", () => {
    expect(builtSettingsPage("providers")).toBe("providers");
    expect(builtSettingsPage("voice")).toBe("general");
    expect(builtSettingsPage("nonsense")).toBe("general");
    expect(builtSettingsPage(null)).toBe("general");
  });
});

const config = (settings: Record<string, unknown> = {}): IWireServerConfig =>
  ({
    settings: serverSettings(settings),
    providers: [
      {
        instanceId: "claudeAgent",
        driver: "claudeAgent",
        displayName: "Claude",
        enabled: true,
        status: "ready",
        version: "2.1.0",
        models: [
          { slug: "opus", name: "Opus" },
          { slug: "sonnet", name: "Sonnet" },
          { slug: "haiku", name: "Haiku" },
          { slug: "mine", name: "Mine", isCustom: true },
        ],
      },
    ],
    keybindings: [],
  }) as unknown as IWireServerConfig;

describe("provider settings", () => {
  it("list every model in the stored order, marking hidden ones and favorites", () => {
    const [claude] = providerRows(
      config({
        favorites: [{ provider: "claudeAgent", model: "haiku" }],
        providerModelPreferences: {
          claudeAgent: { hiddenModels: ["sonnet", "mine"], modelOrder: ["haiku", "opus"] },
        },
      }),
    );
    expect(claude!.Models.map((model) => [model.Slug, model.Hidden, model.Favorite])).toEqual([
      ["haiku", false, true],
      ["opus", false, false],
      ["sonnet", true, false],
      ["mine", false, false],
    ]);
  });

  it("write hidden, favorite and order changes as stock's patch fields", () => {
    const [claude] = providerRows(config());
    for (const patch of [
      modelHiddenPatch("claudeAgent", "opus", true),
      modelFavoritePatch("claudeAgent", "opus", true),
      modelMovePatch(claude!, "sonnet", -1)!,
    ]) {
      expect(() => decodePatch(patch)).not.toThrow();
    }
    expect(modelMovePatch(claude!, "sonnet", -1)).toEqual({
      setProviderModelOrder: {
        provider: "claudeAgent",
        modelOrder: ["sonnet", "opus", "haiku", "mine"],
      },
    });
    expect(modelMovePatch(claude!, "opus", -1)).toBeNull();
    expect(modelHiddenPatch("claudeAgent", "opus", true)).toEqual({
      setModelsHidden: [{ provider: "claudeAgent", model: "opus", hidden: true }],
    });
  });

  it("disable a provider as an upsert of its stored instance, resetting text generation it served", () => {
    const settings = serverSettings({
      providerInstances: {
        claudeAgent: { driver: "claudeAgent", displayName: "Claude", enabled: true },
      },
      textGenerationModelSelection: { instanceId: "claudeAgent", model: "haiku" },
    });
    const write = providerEnabledWrite(
      settings,
      { InstanceId: "claudeAgent", Driver: "claudeAgent" },
      false,
    );
    expect(write.Mutation).toEqual({
      operation: "upsert",
      instanceId: "claudeAgent",
      instance: { driver: "claudeAgent", displayName: "Claude", enabled: false },
    });
    expect(write.Patch.textGenerationModelSelection?.instanceId).toBe(
      DEFAULT_SERVER_SETTINGS.textGenerationModelSelection.instanceId,
    );
    expect(() => decodePatch(write.Patch)).not.toThrow();
    expect(() => decodeMutation(write.Mutation)).not.toThrow();
    const enable = providerEnabledWrite(
      serverSettings(),
      { InstanceId: "codex", Driver: "codex" },
      true,
    );
    expect(enable).toEqual({
      Patch: {},
      Mutation: {
        operation: "upsert",
        instanceId: "codex",
        instance: { driver: "codex", enabled: true },
      },
    });
  });
});

describe("keybinding rows", () => {
  it("group stock's defaults with stock's labels, and mark custom bindings", () => {
    const groups = keybindingGroups([
      {
        command: "usage.open",
        shortcut: {
          key: "y",
          metaKey: false,
          ctrlKey: false,
          shiftKey: false,
          altKey: false,
          modKey: true,
        },
      },
    ] as never);
    const titles = groups.map((group) => group.Title);
    expect(titles[0]).toBe("Navigation");
    const usage = groups
      .flatMap((group) => group.Rows)
      .filter((entry) => entry.Command === "usage.open");
    expect(usage.map((entry) => [entry.Key, entry.Source])).toEqual([["mod+y", "Custom"]]);
    const all = groups.flatMap((group) => group.Rows);
    expect(all.find((entry) => entry.Command === "usage.cost")?.Label).toBe("Usage: Cost");
    expect(all.some((entry) => entry.Source === "Default")).toBe(true);
  });
});
