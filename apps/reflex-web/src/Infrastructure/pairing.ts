import { getPairingTokenFromUrl, stripPairingTokenFromUrl } from "@t3tools/shared/remote";

// Runs before the runtime exists, so the credential never reaches an action or the record stream.
export async function pairFromUrl(): Promise<void> {
  const url = new URL(location.href);
  const credential = getPairingTokenFromUrl(url);
  if (credential === null) return;
  history.replaceState(null, "", stripPairingTokenFromUrl(url).toString());
  const response = await fetch("/api/auth/browser-session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ credential }),
  });
  if (!response.ok) console.error(`Pairing failed with HTTP ${response.status}.`);
}
