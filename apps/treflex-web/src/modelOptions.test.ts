import type { ProviderOptionDescriptor } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { IProviderOption, IWireModelSelection } from "./Infrastructure/commandEffects";
import {
  applyModelPreferences,
  compatibleRuntimeMode,
  dispatchSelection,
  FAVORITES_TAB,
  initialPickerTab,
  type ISelectDescriptor,
  legacyStartsExpanded,
  modelChangeBlock,
  modelTraits,
  pickedSelection,
  pickerList,
  triggerSuffix,
  withBooleanValue,
  withSelectValue,
} from "./modelOptions";

const effort: ISelectDescriptor = {
  id: "effort",
  label: "Effort",
  type: "select",
  options: [
    { id: "low", label: "Low" },
    { id: "medium", label: "Medium" },
    { id: "high", label: "High", isDefault: true },
    { id: "ultrathink", label: "Ultrathink" },
  ],
  promptInjectedValues: ["ultrathink"],
};
const descriptors: ProviderOptionDescriptor[] = [
  effort,
  { id: "fastMode", label: "Fast", type: "boolean" },
  {
    id: "agent",
    label: "Agent",
    type: "select",
    options: [
      { id: "build", label: "Build", isDefault: true },
      { id: "plan", label: "Plan" },
    ],
  },
  { id: "ultracode", label: "Ultracode", type: "boolean" },
];
const claude: IProviderOption = {
  InstanceId: "claudeAgent",
  Driver: "claudeAgent",
  Name: "Claude",
  Models: [
    {
      Slug: "claude-opus-5-5",
      Name: "Claude Opus 5.5",
      IsDefault: true,
      Capabilities: { optionDescriptors: descriptors },
    },
    { Slug: "claude-haiku-4-5", Name: "Claude Haiku 4.5", IsDefault: false },
  ],
};
const codex: IProviderOption = {
  InstanceId: "codex",
  Driver: "codex",
  Name: "Codex",
  Models: [{ Slug: "gpt-5.4", Name: "GPT-5.4", IsDefault: true }],
};
const opus = { instanceId: "claudeAgent", model: "claude-opus-5-5" } as IWireModelSelection;

describe("model options", () => {
  it("puts reasoning in the column, speed and Ultracode in the footer, and drops the plan agent", () => {
    const traits = modelTraits(claude, opus);
    expect(traits.Effort?.Descriptor.id).toBe("effort");
    expect(traits.Fast?.id).toBe("fastMode");
    expect(traits.Ultracode?.id).toBe("ultracode");
    const agent = traits.Others.map((control) => control.Descriptor);
    expect(agent.map((held) => held.id)).toEqual(["agent"]);
    expect(agent[0]!.type === "select" && agent[0]!.options.map((option) => option.id)).toEqual([
      "build",
    ]);
  });

  it("sends a picked effort and the implicit Fast default, as stock dispatches them", () => {
    expect(dispatchSelection(claude, opus)).toEqual({
      instanceId: "claudeAgent",
      model: "claude-opus-5-5",
      options: [{ id: "fastMode", value: false }],
    });
    const medium = withSelectValue(modelTraits(claude, opus), opus, effort, "medium")!;
    const fast = withBooleanValue(modelTraits(claude, medium), medium, "fastMode", true);
    const sent = dispatchSelection(claude, fast) as { options?: unknown[] };
    expect(sent.options).toEqual(
      expect.arrayContaining([
        { id: "effort", value: "medium" },
        { id: "fastMode", value: true },
      ]),
    );
    expect(withSelectValue(modelTraits(claude, opus), opus, effort, "ultrathink")).toBeNull();
  });

  it("names the effort and speed on the trigger", () => {
    const medium = withSelectValue(modelTraits(claude, opus), opus, effort, "medium")!;
    const fast = withBooleanValue(modelTraits(claude, medium), medium, "fastMode", true);
    const suffix = triggerSuffix(modelTraits(claude, fast), fast);
    expect([suffix.Word, suffix.Speed, suffix.Ultracode]).toEqual(["Medium", "Fast", false]);
    expect(triggerSuffix(modelTraits(claude, opus), opus).Word).toBe("High");
  });

  it("passes an off-catalog model's options through untouched", () => {
    const opencode: IProviderOption = {
      InstanceId: "opencode",
      Driver: "opencode",
      Name: "OpenCode",
      Models: [],
    };
    const selection = {
      instanceId: "opencode",
      model: "custom/model",
      options: [
        { id: "variant", value: "deep" },
        { id: "agent", value: "plan" },
      ],
    } as unknown as IWireModelSelection;
    expect(dispatchSelection(opencode, selection)).toEqual({
      instanceId: "opencode",
      model: "custom/model",
      options: [{ id: "variant", value: "deep" }],
    });
    expect(modelTraits(opencode, selection).Effort).toBeNull();
    for (const driver of ["pi", "acpRegistry"]) {
      const runtime: IProviderOption = {
        InstanceId: driver,
        Driver: driver,
        Name: driver,
        Models: [],
      };
      const picked = { ...selection, instanceId: driver } as IWireModelSelection;
      expect(dispatchSelection(runtime, picked)).toEqual({
        instanceId: driver,
        model: "custom/model",
        options: [{ id: "variant", value: "deep" }],
      });
    }
    const acp: IProviderOption = {
      InstanceId: "acp",
      Driver: "acpRegistry",
      Name: "ACP",
      Models: [],
    };
    const aliased = { ...selection, instanceId: "acp", model: "default" } as IWireModelSelection;
    expect(dispatchSelection(acp, aliased).options).toBeUndefined();
  });

  it("carries remembered options to a picked model, else the thread's own for its model", () => {
    const remembered = [{ id: "effort", value: "low" }];
    const thread = {
      ...opus,
      options: [{ id: "effort", value: "medium" }],
    } as unknown as IWireModelSelection;
    expect(pickedSelection("claudeAgent", "claude-opus-5-5", remembered, thread)).toEqual({
      ...opus,
      options: remembered,
    });
    expect(pickedSelection("claudeAgent", "claude-opus-5-5", undefined, thread)).toEqual(thread);
    expect(pickedSelection("claudeAgent", "claude-haiku-4-5", undefined, thread)).toEqual({
      instanceId: "claudeAgent",
      model: "claude-haiku-4-5",
    });
  });

  it("blocks another provider on a started thread unless it can hand off", () => {
    const started = { Started: true, SupportsHandoff: false, CurrentInstanceId: "claudeAgent" };
    expect(modelChangeBlock({ ...started, NextInstanceId: "claudeAgent" })).toBeNull();
    expect(modelChangeBlock({ ...started, NextInstanceId: "codex" })).toMatch(
      /does not support switching/,
    );
    expect(
      modelChangeBlock({ ...started, SupportsHandoff: true, NextInstanceId: "codex" }),
    ).toBeNull();
    expect(modelChangeBlock({ ...started, Started: false, NextInstanceId: "codex" })).toBeNull();
  });

  it("falls back to the first mode a provider supports", () => {
    expect(compatibleRuntimeMode("full-access", ["approval-required", "auto"])).toEqual({
      Modes: ["approval-required", "auto"],
      Mode: "approval-required",
    });
    expect(compatibleRuntimeMode("auto", undefined).Modes).toHaveLength(4);
  });
});

describe("the model list", () => {
  const model = (slug: string, isLegacy = false) => ({
    Slug: slug,
    Name: slug,
    IsDefault: false,
    ...(isLegacy ? { IsLegacy: true } : {}),
  });
  const anthropic: IProviderOption = {
    InstanceId: "claudeAgent",
    Driver: "claudeAgent",
    Name: "Claude",
    Models: [
      model("opus-5-5"),
      model("sonnet-5-5"),
      model("fable-5-2"),
      model("fable-5-1", true),
      model("opus-4-8", true),
      model("haiku-5-5"),
    ],
  };
  const providers = [anthropic, codex];
  const slugs = (list: ReturnType<typeof pickerList>) => list.Models.map((held) => held.Slug);
  const list = (input: Partial<Parameters<typeof pickerList>[0]>) =>
    pickerList({
      Providers: providers,
      Favorites: [],
      Tab: "claudeAgent",
      Query: "",
      LegacyExpanded: false,
      Active: null,
      ...input,
    });

  it("keeps a runtime-catalog driver's active model listed, as unavailable, when its catalog drops it", () => {
    const runtime = (driver: string): IProviderOption => ({
      InstanceId: driver,
      Driver: driver,
      Name: driver,
      Models: [model("listed")],
    });
    const catalog = [anthropic, runtime("pi"), runtime("acpRegistry")];
    const active = (instanceId: string, slug: string) => ({
      Providers: catalog,
      Tab: instanceId,
      Active: { instanceId, model: slug } as IWireModelSelection,
    });
    const pi = list(active("pi", "gone"));
    expect(slugs(pi)).toEqual(["listed", "gone"]);
    expect(pi.Models.map((held) => held.IsUnavailable === true)).toEqual([false, true]);
    expect(slugs(list({ ...active("pi", "gone"), Tab: "acpRegistry" }))).toEqual(["listed"]);
    expect(slugs(list(active("pi", "listed")))).toEqual(["listed"]);
    expect(slugs(list(active("claudeAgent", "gone")))).not.toContain("gone");
    expect(slugs(list(active("acpRegistry", "default")))).toEqual(["listed"]);
    const hidden = { ...runtime("pi"), HiddenModels: ["gone"] };
    expect(slugs(list({ ...active("pi", "gone"), Providers: [hidden] }))).toEqual(["listed"]);
  });

  it("puts a provider's older models behind Show more, after its current ones", () => {
    const collapsed = list({});
    expect(slugs(collapsed)).toEqual(["opus-5-5", "sonnet-5-5", "fable-5-2", "haiku-5-5"]);
    expect(collapsed.Legacy).toEqual({ Count: 2, Expanded: false });
    expect(slugs(list({ LegacyExpanded: true }))).toEqual([
      "opus-5-5",
      "sonnet-5-5",
      "fable-5-2",
      "haiku-5-5",
      "fable-5-1",
      "opus-4-8",
    ]);
    expect(list({ Tab: "codex" }).Legacy).toBeNull();
  });

  it("lists favorites first on their tab and keeps a favorite older model out of Show more", () => {
    const favorites = [
      { Provider: "codex", Model: "gpt-5.4" },
      { Provider: "claudeAgent", Model: "opus-4-8" },
    ];
    const tab = list({ Favorites: favorites });
    expect(slugs(tab)).toEqual(["opus-4-8", "opus-5-5", "sonnet-5-5", "fable-5-2", "haiku-5-5"]);
    expect(tab.Legacy).toEqual({ Count: 1, Expanded: false });
    expect(tab.Models[0]!.IsFavorite).toBe(true);
    const starred = list({ Favorites: favorites, Tab: FAVORITES_TAB });
    expect(slugs(starred)).toEqual(["opus-4-8", "gpt-5.4"]);
    expect(starred.Legacy).toBeNull();
  });

  it("ranks a search across every provider, older models included", () => {
    const found = list({ Query: "fable", Tab: "codex" });
    expect(slugs(found)).toEqual(["fable-5-2", "fable-5-1"]);
    expect(found.Legacy).toBeNull();
  });

  it("opens on Favorites when one is offered, but a started thread opens on its provider", () => {
    const favorites = [{ Provider: "codex", Model: "gpt-5.4" }];
    const opening = { Providers: providers, Favorites: favorites, ActiveInstanceId: "claudeAgent" };
    expect(initialPickerTab({ ...opening, Started: false })).toBe(FAVORITES_TAB);
    expect(initialPickerTab({ ...opening, Started: true })).toBe("claudeAgent");
    expect(
      initialPickerTab({
        ...opening,
        Favorites: [{ Provider: "codex", Model: "gone" }],
        Started: false,
      }),
    ).toBe("claudeAgent");
  });

  it("opens Show more only when the active model is an older one that isn't a favorite", () => {
    const active = { instanceId: "claudeAgent", model: "opus-4-8" } as IWireModelSelection;
    expect(legacyStartsExpanded(providers, [], active)).toBe(true);
    expect(
      legacyStartsExpanded(providers, [{ Provider: "claudeAgent", Model: "opus-4-8" }], active),
    ).toBe(false);
    expect(
      legacyStartsExpanded(providers, [], { ...active, model: "opus-5-5" } as IWireModelSelection),
    ).toBe(false);
  });

  it("hides the models a user hid and applies their order, keeping custom models", () => {
    const models = [{ slug: "a" }, { slug: "b" }, { slug: "c" }, { slug: "d", isCustom: true }];
    const preferences = { hiddenModels: ["b", "d"], modelOrder: ["c"] };
    expect(applyModelPreferences(models, preferences).map((held) => held.slug)).toEqual([
      "c",
      "a",
      "d",
    ]);
    expect(applyModelPreferences(models, undefined)).toEqual(models);
  });
});
