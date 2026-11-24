// Follows resolveRemoteOpenState in apps/web/src/remoteOpen.ts for a browser on its primary
// environment, with no desktop bridge and no SSH profile, and LOOPBACK_HOSTNAMES and
// isLoopbackHostname in apps/web/src/environments/primary/target.ts.

/**
 * `local-exec` runs editors and file managers on the server's machine, which is this client's
 * only when it reaches the server at a loopback address.
 */
export type IRemoteOpenMode = "local-exec" | "remote-links" | "remote-unavailable";

const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "::1", "localhost"]);

export function isLoopbackHostname(hostname: string): boolean {
  return LOOPBACK_HOSTNAMES.has(
    hostname
      .trim()
      .toLowerCase()
      .replace(/^\[(.*)\]$/, "$1"),
  );
}

export function remoteOpenMode(
  hostname: string,
  remoteOpenTargets: ReadonlyArray<unknown> | undefined,
): IRemoteOpenMode {
  if (isLoopbackHostname(hostname)) return "local-exec";
  return remoteOpenTargets !== undefined && remoteOpenTargets.length > 0
    ? "remote-links"
    : "remote-unavailable";
}

/** Follows `unavailableReason` in apps/web/src/components/chat/OpenInPicker.tsx, on a phone or tablet. */
export function editorUnavailableReason(mode: IRemoteOpenMode, label: string): string | null {
  const machine = label.length > 0 ? label : null;
  if (mode === "remote-unavailable") {
    return machine === null ? "No SSH route to this machine" : `No SSH route to ${machine}`;
  }
  if (mode === "remote-links") {
    return machine === null
      ? "Open from a computer to edit on this machine"
      : `Open from a computer to edit on ${machine}`;
  }
  return null;
}
