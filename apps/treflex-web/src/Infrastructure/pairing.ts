// @effect-diagnostics globalTimers:off globalDate:off -- Runs outside any Effect runtime.
import { getPairingTokenFromUrl, stripPairingTokenFromUrl } from "@t3tools/shared/remote";

// Follows submitServerAuthCredential and its helpers in apps/web/src/environments/primary/auth.ts.
const TRANSIENT_STATUSES = new Set([502, 503, 504]);
const RETRY_TIMEOUT_MS = 15_000;
const RETRY_STEP_MS = 500;
const SESSION_TIMEOUT_MS = 2_000;
const SESSION_STEP_MS = 100;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isTransient = (error: unknown) =>
  error instanceof TypeError || (error instanceof DOMException && error.name === "AbortError");

async function exchange(credential: string): Promise<Response> {
  const startedAt = Date.now();
  for (;;) {
    const late = () => Date.now() - startedAt >= RETRY_TIMEOUT_MS;
    try {
      const response = await fetch("/api/auth/browser-session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ credential }),
      });
      if (!TRANSIENT_STATUSES.has(response.status) || late()) return response;
    } catch (error) {
      if (!isTransient(error) || late()) throw error;
    }
    await wait(RETRY_STEP_MS);
  }
}

async function waitForSession(): Promise<string | null> {
  const startedAt = Date.now();
  for (;;) {
    const response = await fetch("/api/auth/session");
    if (!response.ok) return `Session check failed with HTTP ${response.status}.`;
    const session = await response.json();
    if (session.authenticated === true) return null;
    if (Date.now() - startedAt >= SESSION_TIMEOUT_MS)
      return "Timed out waiting for authenticated session after bootstrap.";
    await wait(SESSION_STEP_MS);
  }
}

async function rejectedCredential(response: Response): Promise<boolean> {
  const body = await response.json().catch(() => null);
  return body?._tag === "EnvironmentAuthInvalidError" && body.reason === "invalid_credential";
}

/**
 * Exchanges a pairing token for this browser's session cookie, and returns why it failed, or
 * null. Called outside the runtime, so the token never reaches an action or the record stream.
 */
export async function pairWithToken(credential: string): Promise<string | null> {
  const trimmed = credential.trim();
  if (trimmed === "") return "Enter a pairing token to continue.";
  try {
    const response = await exchange(trimmed);
    if (response.ok) return await waitForSession();
    if (await rejectedCredential(response))
      return "Invalid pairing token. Check the token and try again.";
    return `Primary environment request failed during exchange-bootstrap-credential (HTTP ${response.status}).`;
  } catch (error) {
    return error instanceof Error && error.message.trim() !== ""
      ? error.message
      : "Authentication failed.";
  }
}

let urlPairingError: string | null = null;

/** Why the address's pairing token failed, for the unpaired page to show first. */
export const pairingErrorFromUrl = () => urlPairingError;

/** Runs before the runtime exists, and pairs with the address's token, if it carries one. */
export async function pairFromUrl(): Promise<void> {
  const url = new URL(location.href);
  const credential = getPairingTokenFromUrl(url);
  if (credential === null) return;
  history.replaceState(null, "", stripPairingTokenFromUrl(url).toString());
  urlPairingError = await pairWithToken(credential);
  if (urlPairingError !== null) console.error(`Pairing failed: ${urlPairingError}`);
}
