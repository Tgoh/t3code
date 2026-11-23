import {
  ANOTHER_ADDRESS,
  linkDestination,
  linkRequestDefaultAccess,
  linkRequestDisplay,
  linkRequestTarget,
  linkRequestTargetName,
} from "@t3tools/client-runtime/link-request";
import {
  secretRequestDisplay,
  secretRequestInputs,
  type SecretRequestInput,
  secretRequestLink,
  secretRequestPrivacyNote,
} from "@t3tools/client-runtime/secret-request";
import { AuthMcpClientAccess } from "@t3tools/contracts";
import { useInFlight } from "treflex-solid";
import { type Component, createSignal, createUniqueId, For, type JSX, Show } from "solid-js";
import { Dynamic } from "solid-js/web";

import { RUNTIME_MODE_CONFIG } from "./ComposerMenus";
import { Check, ExternalLink, Eye, EyeOff, Link, Lock, Minus, ShieldCheck, X } from "./icons";
import type { IWireTurnItem } from "./Infrastructure/wire";
import ItemRequest, {
  answerLink,
  answerSecret,
  type IItemRequest,
  type ISecretReply,
} from "./ItemRequest";
import OpenThread from "./OpenThread";
import { Alert, AlertDescription, AlertTitle } from "./ui/Alert";
import { Button, buttonVariants } from "./ui/Button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "./ui/Select";
import { Input } from "./ui/Input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "./ui/InputGroup";
import { Dialog } from "./ui/Dialog";
import { Presence } from "./ui/Presence";
import { WizardFooter, WizardHeader, WizardPanel, WizardPopup, WizardSteps } from "./ui/Wizard";

type IVisibility = "local" | "inherited" | "synthetic";
type SecretRequestItem = Extract<IWireTurnItem, { type: "secret_request" }>;
type LinkRequestItem = Extract<IWireTurnItem, { type: "link_request" }>;

const CARD = "flex min-w-0 flex-col gap-3 rounded-xl border border-border/60 bg-card p-4";
const ERROR = "text-xs text-destructive";
const NOTE = "m-0 text-[12px] text-muted-foreground";
const FIELD_LABEL = "block text-[12px] font-medium text-foreground";

const ACCESS: Record<AuthMcpClientAccess, { Label: string; Description: string }> = {
  "read-only": {
    Label: "Read only",
    Description: "Read projects and threads. Cannot start, message or change anything.",
  },
  ...RUNTIME_MODE_CONFIG,
};
const accessLabel = (access: AuthMcpClientAccess) => ACCESS[access].Label;

// Follows WorkLogRow in apps/web/src/components/chat/WorkLog.tsx.
function OutcomeRow(props: { icon: Component; label: string; type: string }) {
  return (
    <div
      class="flex min-h-6 min-w-0 items-center gap-1.5 p-0.5 text-[14px] leading-6 text-secondary-label"
      data-item-type={props.type}
    >
      <span class="inline-flex size-6 flex-none items-center justify-center text-muted-foreground [&_svg]:size-3.5">
        <Dynamic component={props.icon} />
      </span>
      <span class="min-w-0 truncate">{props.label}</span>
    </div>
  );
}

/** A secret or link card in the timeline, by its turn item. */
export function ItemRequestRow(props: { id: string; item: IWireTurnItem }) {
  const thread = OpenThread.use();
  const visibility = (): IVisibility => thread.state.Rows[props.id]?.visibility ?? "local";
  const entity = () => thread.state.ItemRequests[props.id];
  return (
    <Show
      when={props.item.type === "secret_request" ? props.item : null}
      fallback={
        <Show when={props.item.type === "link_request" ? props.item : null}>
          {(item) => <LinkCard item={item()} visibility={visibility()} entity={entity()} />}
        </Show>
      }
    >
      {(item) => <SecretCard item={item()} visibility={visibility()} entity={entity()} />}
    </Show>
  );
}

// Follows SecretRequestCard in apps/web/src/components/chat/SecretRequestCard.tsx.
function SecretCard(props: {
  item: SecretRequestItem;
  visibility: IVisibility;
  entity: IItemRequest | undefined;
}) {
  const display = () => secretRequestDisplay(props.item, props.visibility);
  const pending = () => {
    const shown = display();
    return shown.kind === "pending" ? props.entity : undefined;
  };
  return (
    <Show
      when={pending()}
      fallback={
        <OutcomeRow
          type={props.item.type}
          icon={(() => {
            const shown = display();
            if (shown.kind !== "answered") return Lock;
            return shown.outcome === "saved" ? Check : Minus;
          })()}
          label={(() => {
            const shown = display();
            return shown.kind === "pending"
              ? props.item.label
              : `${props.item.label} · ${shown.label}`;
          })()}
        />
      }
    >
      {(entity) => <SecretForm state={entity()} item={props.item} />}
    </Show>
  );
}

const SecretForm = ItemRequest.provider<{ item: SecretRequestItem }>((props) => {
  const thread = OpenThread.use();
  const request = ItemRequest.use();
  const busy = useInFlight([answerSecret], () => request.state);
  const formId = createUniqueId();
  const errorId = createUniqueId();
  const privacyId = createUniqueId();
  const inputs = () => secretRequestInputs(props.item);
  const multiple = () => props.item.fields !== undefined;
  const inputId = (index: number) => `${formId}-${index}`;
  // Typed values stay in the inputs, outside state; only whether every one is filled is tracked.
  const elements = new Map<string, HTMLInputElement>();
  const [complete, setComplete] = createSignal(false);
  const typedValues = () =>
    Object.fromEntries(inputs().map((input) => [input.key, elements.get(input.key)?.value ?? ""]));
  const refreshComplete = () =>
    setComplete(
      inputs().every((input) => (elements.get(input.key)?.value.trim() ?? "").length > 0),
    );
  const link = () => secretRequestLink(props.item);
  const describedBy = () =>
    request.itemAnswerError() === null ? privacyId : `${privacyId} ${errorId}`;

  const send = async (reply: ISecretReply) => {
    // A password field that leaves the page with text in it can prompt to save a login, so the
    // inputs are emptied before the card closes; a failed answer puts the values back.
    const typed = typedValues();
    for (const element of elements.values()) element.value = "";
    setComplete(false);
    const sent = await request.answerSecret(
      thread.state.EnvironmentId,
      thread.state.ThreadId,
      props.item,
      reply,
    );
    if (sent === true) return;
    for (const [key, element] of elements) element.value = typed[key] ?? "";
    refreshComplete();
  };

  const field = (input: SecretRequestInput, index: number) => {
    const [revealed, setRevealed] = createSignal(false);
    const control = (
      <InputGroup class="min-w-0 flex-1">
        <InputGroupInput
          ref={(element: HTMLInputElement) => elements.set(input.key, element)}
          id={inputId(index)}
          // A CSS-masked text field still exposes its value to screen readers.
          type={input.secret && !revealed() ? "password" : "text"}
          autocomplete="off"
          autocorrect="off"
          autocapitalize="off"
          spellcheck={false}
          data-1p-ignore=""
          data-lpignore="true"
          data-bwignore=""
          placeholder={input.placeholder}
          disabled={busy()}
          aria-invalid={request.itemAnswerError() !== null || undefined}
          aria-describedby={describedBy()}
          onInput={refreshComplete}
        />
        <Show when={input.secret}>
          <InputGroupAddon align="inline-end">
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              aria-label={`Show ${input.label}`}
              aria-pressed={revealed()}
              disabled={busy()}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setRevealed((current) => !current)}
            >
              <Show when={revealed()} fallback={<Eye aria-hidden="true" />}>
                <EyeOff aria-hidden="true" />
              </Show>
            </Button>
          </InputGroupAddon>
        </Show>
      </InputGroup>
    );
    if (!multiple()) return control;
    return (
      <div class="flex min-w-0 flex-col gap-1">
        <label for={inputId(index)} class={FIELD_LABEL}>
          {input.label}
        </label>
        {control}
      </div>
    );
  };
  const saveButton = () => (
    <Button type="submit" disabled={busy() || !complete()}>
      Save securely
    </Button>
  );

  return (
    <form
      class={CARD}
      data-item-type={props.item.type}
      autocomplete="off"
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy()) void send({ type: "save", values: typedValues() });
      }}
      // On click, not pointerdown, so the click that follows doesn't take focus back; a click
      // that ends a text selection leaves it, so the reason can still be copied.
      onClick={(event) => {
        if (!(event.target instanceof Element)) return;
        if (event.target.closest("input, button, a")) return;
        if (window.getSelection()?.isCollapsed === false) return;
        const empty = inputs().findIndex((input) => !elements.get(input.key)?.value.trim());
        document.getElementById(inputId(Math.max(empty, 0)))?.focus();
      }}
    >
      <div class="flex min-w-0 flex-col gap-1">
        <Show
          when={multiple()}
          fallback={
            <label for={inputId(0)} class="text-[14px] font-medium text-foreground">
              {props.item.label}
            </label>
          }
        >
          <p class="m-0 text-[14px] font-medium text-foreground">{props.item.label}</p>
        </Show>
        <Show when={props.item.reason.trim()}>
          <p class="m-0 text-[14px] wrap-anywhere text-muted-foreground">{props.item.reason}</p>
        </Show>
      </div>
      <Show when={link()}>
        {(held) => (
          <div class="flex min-w-0 flex-col items-start gap-1.5">
            <a
              class={buttonVariants({ variant: "outline", size: "sm" })}
              href={held().href}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open {held().host}
              <ExternalLink aria-hidden="true" />
            </a>
            <Show when={props.item.url}>
              {(url) => (
                <p class="m-0 font-mono text-[12px] wrap-anywhere text-muted-foreground">{url()}</p>
              )}
            </Show>
          </div>
        )}
      </Show>
      <Show
        when={multiple()}
        fallback={
          <div class="flex min-w-0 items-center gap-2">
            {field(inputs()[0]!, 0)}
            {saveButton()}
          </div>
        }
      >
        <div class="flex min-w-0 flex-col gap-2.5">
          <For each={inputs()}>{(input, index) => field(input, index())}</For>
        </div>
      </Show>
      <Show when={request.itemAnswerError()}>
        {(error) => (
          <p id={errorId} role="alert" class={ERROR}>
            {error()}
          </p>
        )}
      </Show>
      <div class="flex min-w-0 items-center justify-between gap-2">
        <p id={privacyId} class={`${NOTE} flex min-w-0 items-center gap-1.5`}>
          <ShieldCheck class="size-3.5 flex-none" aria-hidden="true" />
          {secretRequestPrivacyNote(props.item)}
        </p>
        <div class="ms-auto flex flex-none items-center gap-2">
          <Button
            size="xs"
            variant="ghost-muted"
            disabled={busy()}
            onClick={() => void send({ type: "decline" })}
          >
            Decline
          </Button>
          <Show when={multiple()}>{saveButton()}</Show>
        </div>
      </div>
    </form>
  );
});

/** Whether the agent left the machine for the user to pick. */
const picksMachine = (item: LinkRequestItem) =>
  item.environmentId === undefined && item.url === undefined;

// Follows LinkRequestCard in apps/web/src/components/chat/LinkRequestCard.tsx.
function LinkCard(props: {
  item: LinkRequestItem;
  visibility: IVisibility;
  entity: IItemRequest | undefined;
}) {
  const display = () => linkRequestDisplay(props.item, props.visibility, accessLabel);
  const pending = () => (display().kind === "pending" ? props.entity : undefined);
  return (
    <Show
      when={pending()}
      fallback={
        <OutcomeRow
          type={props.item.type}
          icon={(() => {
            const shown = display();
            if (shown.kind !== "answered") return Link;
            return shown.outcome === "linked" ? Check : shown.outcome === "failed" ? X : Minus;
          })()}
          label={(() => {
            const shown = display();
            return shown.kind === "pending" ? "" : shown.label;
          })()}
        />
      }
    >
      {(entity) => <PendingLink state={entity()} item={props.item} />}
    </Show>
  );
}

const PendingLink = ItemRequest.provider<{ item: LinkRequestItem }>((props) => {
  const thread = OpenThread.use();
  const request = ItemRequest.use();
  const busy = useInFlight([answerLink], () => request.state);
  // Each open is its own; an answer that lands after a close and reopen leaves the new one open.
  const [opened, setOpened] = createSignal<number | null>(null);
  let opens = 0;
  return (
    <div class={CARD} data-item-type={props.item.type}>
      <div class="flex min-w-0 flex-col gap-1">
        <p class="m-0 text-[14px] font-medium text-foreground">
          {picksMachine(props.item)
            ? "Link a machine to this environment"
            : `Link ${linkRequestTargetName(props.item)} to this environment`}
        </p>
        <Show when={props.item.reason.trim()}>
          <p class="m-0 text-[14px] text-muted-foreground">{props.item.reason}</p>
        </Show>
      </div>
      <Show when={opened() === null && request.itemAnswerError()}>
        {(error) => (
          <p role="alert" class={ERROR}>
            {error()}
          </p>
        )}
      </Show>
      <div class="flex min-w-0 items-center justify-end gap-2">
        <Button
          size="xs"
          variant="ghost-muted"
          disabled={busy()}
          onClick={() =>
            void request.answerLink(thread.state.EnvironmentId, thread.state.ThreadId, {
              type: "decline",
            })
          }
        >
          Decline
        </Button>
        <Button size="xs" disabled={busy()} onClick={() => setOpened((opens += 1))}>
          {picksMachine(props.item) ? "Choose machine…" : "Review link…"}
        </Button>
      </div>
      <Presence when={opened()} keyed>
        {(open) => (
          <LinkDialog
            item={props.item}
            onClose={() => {
              if (opened() === open()) setOpened(null);
            }}
          />
        )}
      </Presence>
    </div>
  );
});

type ILinkStep = "machine" | "access";

function LinkDialog(props: { item: LinkRequestItem; onClose: () => void }) {
  const thread = OpenThread.use();
  const request = ItemRequest.use();
  const busy = useInFlight([answerLink], () => request.state);
  const formId = createUniqueId();
  const pickMachine = picksMachine(props.item);
  const target = linkRequestTarget(props.item, [], pickMachine ? ANOTHER_ADDRESS : null);
  const targetName = target.kind === "machine" ? target.label : linkRequestTargetName(props.item);
  const asksAddress = props.item.url === undefined;
  const steps: ILinkStep[] = asksAddress ? ["machine", "access"] : ["access"];
  const [step, setStep] = createSignal<ILinkStep>(steps[0]!);
  const [address, setAddress] = createSignal(props.item.url ?? "");
  const [access, setAccess] = createSignal(linkRequestDefaultAccess(props.item));
  const [pairingCode, setPairingCode] = createSignal("");
  const [attempted, setAttempted] = createSignal(false);
  const machineReady = () => target.kind !== "none" && address().trim().length > 0;
  const ready = () => machineReady() && pairingCode().trim().length > 0;
  const finishesHere = () => step() === "access";

  const submit = async () => {
    if (busy() || !ready()) return;
    setAttempted(true);
    const sent = await request.answerLink(thread.state.EnvironmentId, thread.state.ThreadId, {
      type: "link",
      target: { url: address() },
      access: access(),
      pairingCode: pairingCode(),
    });
    if (sent === true) props.onClose();
  };

  return (
    <Dialog
      onClose={() => {
        // An answer that lands after a close would still link.
        if (!busy()) props.onClose();
      }}
    >
      <WizardPopup>
        <WizardHeader
          title={pickMachine ? "Link a machine" : `Link ${targetName}`}
          description="Agents here can then launch, message and wait on threads there. Revoke it in that machine's Sharing & access."
        >
          <Show when={steps.length > 1}>
            <WizardSteps
              steps={["Machine", "Access"]}
              currentStep={steps.indexOf(step())}
              summaries={[target.kind === "none" ? null : targetName, null]}
              showSummaries
              isStepDisabled={(index) => busy() || (index === 1 && !machineReady())}
              onStepChange={(index) => {
                const next = steps[index];
                if (next !== undefined) setStep(next);
              }}
            />
          </Show>
        </WizardHeader>
        <WizardPanel holdHeight={busy()}>
          <form
            id={formId}
            class="space-y-4"
            autocomplete="off"
            onSubmit={(event) => {
              event.preventDefault();
              if (finishesHere()) void submit();
              else if (machineReady()) setStep("access");
            }}
          >
            <Show
              when={step() === "machine"}
              fallback={
                <>
                  <AddressWarning address={address()} />
                  <label class="flex flex-col gap-1.5">
                    <span class={FIELD_LABEL}>Pairing code</span>
                    <Input
                      value={pairingCode()}
                      onInput={(event) => setPairingCode(event.currentTarget.value)}
                      placeholder="Paste the code"
                      disabled={busy()}
                      autocomplete="one-time-code"
                      spellcheck={false}
                    />
                    <span class={NOTE}>
                      Create a link on {targetName}: Settings → Sharing & access → Authorized
                      clients → Create link, then paste its code here.
                    </span>
                  </label>
                  <AccessPicker value={access()} onChange={setAccess} disabled={busy()} />
                </>
              }
            >
              <label class="flex flex-col gap-1.5">
                <span class={FIELD_LABEL}>Address</span>
                <Input
                  value={address()}
                  onInput={(event) => setAddress(event.currentTarget.value)}
                  placeholder="https://machine.tailnet.ts.net"
                  disabled={busy()}
                  spellcheck={false}
                />
                <Show when={target.kind === "machine"}>
                  <span class={NOTE}>
                    This app has no address for {targetName} that another machine can reach. Enter
                    its https or Tailscale address.
                  </span>
                </Show>
              </label>
            </Show>
            <Show when={attempted() && request.itemAnswerError()}>
              {(error) => (
                <p role="alert" class={ERROR}>
                  {error()}
                </p>
              )}
            </Show>
          </form>
        </WizardPanel>
        <WizardFooter>
          <Show
            when={step() === "access" && steps.length > 1}
            fallback={
              <Button variant="outline" disabled={busy()} onClick={props.onClose}>
                Cancel
              </Button>
            }
          >
            <Button variant="outline" disabled={busy()} onClick={() => setStep("machine")}>
              Back
            </Button>
          </Show>
          <Button
            form={formId}
            type="submit"
            disabled={busy() || (finishesHere() ? !ready() : !machineReady())}
          >
            {busy() ? "Linking…" : finishesHere() ? "Link" : "Continue"}
          </Button>
        </WizardFooter>
      </WizardPopup>
    </Dialog>
  );
}

function AddressWarning(props: { address: string }) {
  return (
    <Alert variant="warning">
      <AlertTitle>Check this address</AlertTitle>
      <AlertDescription>
        This app cannot confirm it is one of your machines. The pairing code you paste is sent
        there.
        <span class="block break-all">{linkDestination(props.address)}</span>
      </AlertDescription>
    </Alert>
  );
}

// Follows LinkAccessPicker in apps/web/src/components/settings/LinkAccessPicker.tsx.
function AccessPicker(props: {
  value: AuthMcpClientAccess;
  onChange: (access: AuthMcpClientAccess) => void;
  disabled: boolean;
}): JSX.Element {
  const labelId = createUniqueId();
  return (
    <div class="flex flex-col gap-1.5">
      <span id={labelId} class={FIELD_LABEL}>
        What agents here may do there
      </span>
      <Select
        value={props.value}
        disabled={props.disabled}
        onValueChange={(value) => props.onChange(value as AuthMcpClientAccess)}
      >
        <SelectTrigger aria-labelledby={labelId}>
          <SelectValue>{ACCESS[props.value].Label}</SelectValue>
        </SelectTrigger>
        <SelectPopup alignItemWithTrigger={false}>
          <For each={AuthMcpClientAccess.literals}>
            {(option) => <SelectItem value={option}>{ACCESS[option].Label}</SelectItem>}
          </For>
        </SelectPopup>
      </Select>
      <p class={NOTE}>
        {ACCESS[props.value].Description} An agent never gets more access there than its own mode
        here. Below full access, it can change only threads this link started, not that machine's
        own threads, projects or settings.
      </p>
    </div>
  );
}
