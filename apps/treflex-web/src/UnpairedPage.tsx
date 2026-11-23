import { createSignal, Show } from "solid-js";

import { pairingErrorFromUrl, pairWithToken } from "./Infrastructure/pairing";
import Root from "./Root";
import { Alert, AlertDescription } from "./ui/Alert";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import { StandalonePage, StandalonePageHeader } from "./ui/StandalonePage";

// Follows PairingRouteSurface, describeAuthGate and describeSupportedMethods in
// apps/web/src/components/auth/PairingRouteSurface.tsx.
function authGate(methods: readonly string[]): string {
  return methods.includes("desktop-bootstrap")
    ? "This environment expects a trusted pairing credential before the app can connect."
    : "Enter a pairing token to start a session with this environment.";
}

function supportedMethods(methods: readonly string[]): string {
  if (methods.includes("desktop-bootstrap") && methods.includes("one-time-token"))
    return "Desktop-managed pairing and one-time pairing tokens are both accepted for this environment.";
  if (methods.includes("desktop-bootstrap"))
    return "This environment is desktop-managed. Open it from the desktop app or paste a bootstrap credential if one was issued explicitly.";
  return "This environment accepts one-time pairing tokens. Pairing links can open this page directly, or you can paste the token here.";
}

export function UnpairedPage() {
  const root = Root.use();
  const [credential, setCredential] = createSignal("");
  const [error, setError] = createSignal(pairingErrorFromUrl() ?? "");
  const [submitting, setSubmitting] = createSignal(false);
  const submit = async (event: SubmitEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    const failure = await pairWithToken(credential());
    if (failure === null) return void root.load();
    setSubmitting(false);
    setError(failure);
  };
  return (
    <StandalonePage>
      <StandalonePageHeader
        context={root.state.Label}
        title="Pair with this environment"
        description={authGate(root.state.BootstrapMethods)}
      />
      <form class="mt-6 space-y-4" onSubmit={(event) => void submit(event)}>
        <div class="space-y-2">
          <label class="text-sm font-medium" for="pairing-token">
            Pairing token
          </label>
          <Input
            id="pairing-token"
            autocapitalize="none"
            autocomplete="off"
            autocorrect="off"
            disabled={submitting()}
            onInput={(event) => setCredential(event.currentTarget.value)}
            placeholder="Paste a one-time token or pairing secret"
            spellcheck="false"
            value={credential()}
          />
        </div>
        <Show when={error()}>
          <Alert variant="error">
            <AlertDescription>{error()}</AlertDescription>
          </Alert>
        </Show>
        <div class="flex flex-wrap gap-2">
          <Button disabled={submitting()} size="sm" type="submit">
            {submitting() ? "Pairing..." : "Continue"}
          </Button>
          <Button
            disabled={submitting()}
            onClick={() => location.reload()}
            size="sm"
            variant="outline"
          >
            Reload app
          </Button>
        </div>
      </form>
      <div class="mt-6 rounded-lg border border-border/70 bg-background/55 px-3 py-3 text-xs leading-relaxed text-muted-foreground">
        {supportedMethods(root.state.BootstrapMethods)}
      </div>
    </StandalonePage>
  );
}
