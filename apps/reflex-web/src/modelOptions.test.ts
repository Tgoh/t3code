import type { ProviderOptionDescriptor } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { IProviderOption, IWireModelSelection } from "./Infrastructure/commandEffects";
import {
  compatibleRuntimeMode,
  dispatchSelection,
  type ISelectDescriptor,
  modelChangeBlock,
  modelTraits,
  pickedSelection,
  pickerModels,
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
    expect(modelChangeBlock({ ...started, NextInstanceId: "codex" })).toMatch(/Start a new thread/);
    expect(
      modelChangeBlock({ ...started, SupportsHandoff: true, NextInstanceId: "codex" }),
    ).toBeNull();
    expect(modelChangeBlock({ ...started, Started: false, NextInstanceId: "codex" })).toBeNull();
  });

  it("lists one provider's models, or ranks a search across all of them", () => {
    const providers = [claude, codex];
    expect(pickerModels(providers, "codex", "").map((model) => model.Slug)).toEqual(["gpt-5.4"]);
    expect(pickerModels(providers, "codex", "haiku").map((model) => model.Slug)).toEqual([
      "claude-haiku-4-5",
    ]);
  });

  it("falls back to the first mode a provider supports", () => {
    expect(compatibleRuntimeMode("full-access", ["approval-required", "auto"])).toEqual({
      Modes: ["approval-required", "auto"],
      Mode: "approval-required",
    });
    expect(compatibleRuntimeMode("auto", undefined).Modes).toHaveLength(4);
  });
});
