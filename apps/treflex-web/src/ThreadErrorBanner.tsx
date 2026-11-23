import {
  CHATGPT_USAGE_LIMIT_CODE,
  CHATGPT_USAGE_URL,
  CHATGPT_WORKSPACE_ADMIN_REQUEST,
  CHATGPT_WORKSPACE_USAGE_LIMIT_CODE,
} from "@t3tools/shared/usageLimits";
import { createSignal, createUniqueId, Show } from "solid-js";

import { ProviderIcon } from "./brand";
import { copyText } from "./clipboard";
import { CircleAlert, ExternalLink, X } from "./icons";
import type { IThreadError } from "./threadError";
import { threadErrorBannerMessage } from "./threadError";
import { Alert, AlertAction, AlertDescription } from "./ui/Alert";
import { Button, buttonVariants, InlineButton } from "./ui/Button";
import { toastManager } from "./ui/toastStore";

// Follows ExpandableText in apps/web/src/components/settings/ExpandableText.tsx.
function ExpandableText(props: { text: string; collapsedText: string }) {
  const id = createUniqueId();
  const [expanded, setExpanded] = createSignal(false);
  const canExpand = () =>
    props.collapsedText !== props.text || props.text.length > 180 || props.text.includes("\n");
  return (
    <div class="min-w-0">
      <div
        id={id}
        class="whitespace-pre-wrap break-words data-clamped:line-clamp-3"
        data-clamped={!expanded() && canExpand() ? "" : undefined}
      >
        {expanded() ? props.text : props.collapsedText}
      </div>
      <Show when={canExpand()}>
        <InlineButton
          aria-expanded={expanded() ? "true" : "false"}
          aria-controls={id}
          tone="muted"
          class="mt-1"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded() ? "Show less" : "Show full error"}
        </InlineButton>
      </Show>
    </div>
  );
}

// Follows copyAdminRequest in apps/web/src/components/chat/ThreadErrorBanner.tsx.
async function copyAdminRequest() {
  toastManager.add(
    (await copyText(CHATGPT_WORKSPACE_ADMIN_REQUEST))
      ? {
          type: "success",
          title: "Request copied",
          description: "Send it to your workspace admin.",
        }
      : { type: "error", title: "Could not copy the request" },
  );
}

function CopyAdminRequest() {
  return (
    <Button variant="default" size="sm" onClick={() => void copyAdminRequest()}>
      Copy request for admin
    </Button>
  );
}

// Follows ThreadErrorBanner in apps/web/src/components/chat/ThreadErrorBanner.tsx.
export function ThreadErrorBanner(props: { error: IThreadError; onDismiss: () => void }) {
  const workspaceLimit = () => props.error.Code === CHATGPT_WORKSPACE_USAGE_LIMIT_CODE;
  const chatGptLimit = () => workspaceLimit() || props.error.Code === CHATGPT_USAGE_LIMIT_CODE;
  const variant = () =>
    props.error.Class === "usage_limit" || chatGptLimit() ? "warning" : "error";
  return (
    <div class="pointer-events-auto mx-auto w-fit max-w-[min(48rem,calc(100%-2rem))] pt-3">
      <Alert
        variant={variant()}
        surface="glass"
        controlAlignment="first-line"
        data-variant={variant()}
      >
        <Show when={chatGptLimit()} fallback={<CircleAlert />}>
          <span class="flex text-foreground">
            <ProviderIcon driver="codex" />
          </span>
        </Show>
        <AlertDescription>
          <Show
            when={chatGptLimit()}
            fallback={
              <ExpandableText
                text={props.error.Error}
                collapsedText={threadErrorBannerMessage(props.error.Error)}
              />
            }
          >
            <div class="space-y-1">
              <p class="m-0 font-medium">ChatGPT usage limit reached</p>
              <Show when={workspaceLimit()}>
                <p class="m-0">
                  You've reached your workspace's limit for using your ChatGPT plan in other apps.
                  Copy a request to ask your workspace admin for increased usage limits.
                </p>
              </Show>
            </div>
          </Show>
        </AlertDescription>
        <AlertAction>
          <Show when={workspaceLimit()}>
            <CopyAdminRequest />
          </Show>
          <Show when={chatGptLimit() && !workspaceLimit()}>
            <a
              class={buttonVariants({ variant: "default", size: "sm" })}
              href={CHATGPT_USAGE_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              Manage usage
              <ExternalLink class="size-3.5" aria-hidden="true" />
            </a>
          </Show>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Dismiss error"
            onClick={() => props.onDismiss()}
          >
            <X />
          </Button>
        </AlertAction>
      </Alert>
    </div>
  );
}
