import { useResource } from "treflex-solid";
import { type Component, For, Show } from "solid-js";
import { Dynamic } from "solid-js/web";

import { ProviderIcon } from "./brand";
import Environment from "./Environment";
import { ArrowUp, Lock, Paperclip, PenLine, ShieldOff, Sparkles, X } from "./icons";
import type { IWireModelSelection, IWireRuntimeMode } from "./Infrastructure/commandEffects";
import { cloneSendBlock, ProjectCloneBanner, useProjectClone } from "./ProjectClone";
import { StageArt } from "./StageArt";
import ThreadSession, { modelKey } from "./ThreadSession";

// Labels and icons copy apps/web/src/components/chat/runtimeModeConfig.ts.
const RUNTIME_MODES: Record<string, { Label: string; Icon: Component }> = {
  "approval-required": { Label: "Supervised", Icon: Lock },
  "auto-accept-edits": { Label: "Auto-accept edits", Icon: PenLine },
  auto: { Label: "Auto", Icon: Sparkles },
  "full-access": { Label: "Full access", Icon: ShieldOff },
};

export function Composer(props: { active?: boolean }) {
  const environment = Environment.use();
  const session = ThreadSession.use();
  const held = () => session.state;
  const files = useResource(held, "Composer/Files");
  const isDraft = () => held().NewThreadProjectId != null;
  const selection = () => session.effectiveModelKey();
  const mode = () => RUNTIME_MODES[session.effectiveRuntimeMode()];
  const stopping = () => session.stopRequested() || session.stopping();
  const clone = useProjectClone(() => session.projectId());
  const blocked = () => cloneSendBlock(clone());
  const canSend = () =>
    blocked() === null &&
    !session.sending() &&
    (held().Draft.trim() !== "" || held().Attachments.length > 0);
  const send = () => {
    if (blocked() === null) session.send();
  };

  const addFiles = async (picked: File[]) => {
    if (picked.length === 0) return;
    const supplied = await files.supply(picked);
    if (supplied) session.addAttachments(supplied);
  };

  const pickModel = (value: string) => {
    const [instanceId, model] = value.split("\n");
    session.setModelSelection({ instanceId, model } as IWireModelSelection);
  };

  return (
    <>
      <Show when={blocked() !== null && clone()}>
        {(shown) => <ProjectCloneBanner clone={shown()} />}
      </Show>
      <form
        class="composer"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <Show when={held().Attachments.length > 0}>
          <ul class="attachments">
            <For each={held().Attachments}>
              {(file) => (
                <li>
                  {file.Name}
                  <button
                    type="button"
                    aria-label={`Remove ${file.Name}`}
                    data-tip={`Remove ${file.Name}`}
                    onClick={() => session.removeAttachment(file.Id)}
                  >
                    <X />
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Show>
        <Show when={held().AttachmentError}>
          <p class="composer-error">{held().AttachmentError}</p>
        </Show>
        <textarea
          rows={2}
          placeholder="Ask anything."
          value={held().Draft}
          onInput={(event) => session.setDraft(event.currentTarget.value)}
          onPaste={(event) => {
            const pasted = Array.from(event.clipboardData?.files ?? []);
            if (pasted.length === 0) return;
            event.preventDefault();
            void addFiles(pasted);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
            event.preventDefault();
            send();
          }}
        />
        <Show when={held().SendError}>
          <p class="composer-error">Couldn't send: {held().SendError}</p>
        </Show>
        <Show when={held().StopError}>
          <p class="composer-error">Couldn't stop: {held().StopError}</p>
        </Show>
        <div class="composer-bar">
          <label class="icon-button attach" data-tip="Attach images">
            <Paperclip />
            <input
              type="file"
              aria-label="Attach images"
              accept="image/gif,image/jpeg,image/png,image/webp"
              multiple
              disabled={files.status().State !== "live"}
              onChange={(event) => {
                void addFiles(Array.from(event.currentTarget.files ?? []));
                event.currentTarget.value = "";
              }}
            />
          </label>
          <span class="composer-spacer" />
          <label class="composer-control picker-overlay">
            <ProviderIcon driver={session.effectiveModelDriver()} />
            <span class="control-label">{session.effectiveModelName() ?? "No model"}</span>
            <select
              aria-label="Model"
              value={selection()}
              onChange={(event) => pickModel(event.currentTarget.value)}
            >
              <For each={environment.state.Replica.Providers}>
                {(provider) => (
                  <optgroup label={provider.Name}>
                    <For each={provider.Models}>
                      {(model) => (
                        <option
                          value={modelKey(provider.InstanceId, model.Slug)}
                          selected={selection() === modelKey(provider.InstanceId, model.Slug)}
                        >
                          {model.Name}
                        </option>
                      )}
                    </For>
                  </optgroup>
                )}
              </For>
            </select>
          </label>
          <Show when={mode()}>
            {(shown) => (
              <Show
                when={isDraft()}
                fallback={
                  <span class="composer-control">
                    <Dynamic component={shown().Icon} />
                    <span class="control-label">{shown().Label}</span>
                  </span>
                }
              >
                <label class="composer-control picker-overlay">
                  <Dynamic component={shown().Icon} />
                  <span class="control-label">{shown().Label}</span>
                  <select
                    aria-label="Permissions"
                    value={held().RuntimeMode}
                    onChange={(event) =>
                      session.setRuntimeMode(event.currentTarget.value as IWireRuntimeMode)
                    }
                  >
                    <option value="full-access">Full access</option>
                    <option value="approval-required">Supervised</option>
                  </select>
                </label>
              </Show>
            )}
          </Show>
          <Show when={props.active}>
            <button
              type="button"
              class="round-button stop"
              aria-label={stopping() ? "Stopping" : "Stop generation"}
              data-tip={stopping() ? "Stopping" : "Stop generation"}
              disabled={stopping()}
              onClick={() => session.stopRun()}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                <rect x="2" y="2" width="8" height="8" rx="1.5" />
              </svg>
            </button>
          </Show>
          <Show when={!props.active || canSend()}>
            <button
              type="submit"
              class="round-button send"
              aria-label={session.sending() ? "Sending" : "Submit message"}
              data-tip={blocked() ?? undefined}
              disabled={!canSend()}
            >
              <span class="send-art">
                <StageArt compact />
              </span>
              <ArrowUp />
            </button>
          </Show>
        </div>
      </form>
    </>
  );
}
