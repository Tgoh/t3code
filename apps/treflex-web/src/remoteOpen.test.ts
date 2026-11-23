import { describe, expect, it } from "vite-plus/test";

import { editorUnavailableReason, remoteOpenMode } from "./remoteOpen";

const TAILSCALE = [{ kind: "tailscale", host: "box.tail.ts.net" }];

describe("where editors open", () => {
  it.each([
    ["localhost", undefined, "local-exec"],
    ["127.0.0.1", TAILSCALE, "local-exec"],
    ["[::1]", undefined, "local-exec"],
    [" LocalHost ", undefined, "local-exec"],
    // A tailnet or LAN address is another machine's browser, even on the server's own PC.
    ["box.tail.ts.net", undefined, "remote-unavailable"],
    ["192.168.1.20", [], "remote-unavailable"],
    ["box.tail.ts.net", TAILSCALE, "remote-links"],
  ] as const)("reads %s with targets %o as %s", (hostname, targets, mode) => {
    expect(remoteOpenMode(hostname, targets)).toBe(mode);
  });

  it("says why the editor can't open from here", () => {
    expect(editorUnavailableReason("local-exec", "Desk")).toBeNull();
    expect(editorUnavailableReason("remote-unavailable", "Desk")).toBe("No SSH route to Desk");
    expect(editorUnavailableReason("remote-links", "")).toBe(
      "Open from a computer to edit on this machine",
    );
  });
});
