// @effect-diagnostics nodeBuiltinImport:off -- A Node script against a running server, outside any Effect runtime.
import * as NodeUtil from "node:util";

import {
  ORCHESTRATION_PROTOCOL_HEADER,
  ORCHESTRATION_PROTOCOL_VERSION_TEXT,
  OrchestrationV2ShellStreamItem,
  OrchestrationV2ThreadHistoryPage,
  OrchestrationV2ThreadStreamItem,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { wireCodec } from "../../src/Infrastructure/wire.ts";

const { values } = NodeUtil.parseArgs({
  options: { server: { type: "string" }, credential: { type: "string" } },
});
if (values.server === undefined || values.credential === undefined) {
  console.error(
    "Usage: node bench/wire/roundTrip.ts --server http://localhost:<port> --credential <token>",
  );
  process.exit(2);
}
const server = values.server.replace(/\/$/, "");

const session = await fetch(`${server}/api/auth/browser-session`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ credential: values.credential }),
});
if (!session.ok) throw new Error(`Pairing failed with HTTP ${session.status}.`);
const cookie = session.headers
  .getSetCookie()
  .map((header) => header.split(";")[0])
  .join("; ");

async function get(path: string): Promise<Record<string, unknown>> {
  const response = await fetch(`${server}${path}`, {
    headers: { cookie, [ORCHESTRATION_PROTOCOL_HEADER]: ORCHESTRATION_PROTOCOL_VERSION_TEXT },
  });
  if (!response.ok) throw new Error(`GET ${path} failed with HTTP ${response.status}.`);
  return (await response.json()) as Record<string, unknown>;
}

const failures: string[] = [];
const counts = { shell: 0, threads: 0, pages: 0 };

const codecs = <S extends Schema.Codec<unknown, unknown>>(schema: S) => ({
  decode: Schema.decodeUnknownSync(Schema.toCodecJson(schema)),
  encodeWire: Schema.encodeSync(wireCodec(schema)),
  decodeWire: Schema.decodeUnknownSync(wireCodec(schema)),
});
const shellCodecs = codecs(OrchestrationV2ShellStreamItem);
const threadCodecs = codecs(OrchestrationV2ThreadStreamItem);
const pageCodecs = codecs(OrchestrationV2ThreadHistoryPage);

interface ICodecs<A> {
  decode(raw: unknown): A;
  encodeWire(value: A): unknown;
  decodeWire(encoded: unknown): A;
}

function roundTrip<A>(codec: ICodecs<A>, raw: unknown, label: string) {
  try {
    const decoded = codec.decode(raw);
    const encoded: unknown = JSON.parse(JSON.stringify(codec.encodeWire(decoded)));
    if (!NodeUtil.isDeepStrictEqual(codec.decodeWire(encoded), decoded))
      failures.push(`${label}: decodes to a different value`);
  } catch (error) {
    failures.push(`${label}: ${String(error).slice(0, 500)}`);
  }
}

const { projectIdentities: _digest, ...shell } = await get("/api/orchestration/shell");
roundTrip(shellCodecs, { kind: "snapshot", snapshot: shell }, "shell");
counts.shell += 1;

for (const thread of shell.threads as ReadonlyArray<{ id: string }>) {
  const path = `/api/orchestration/threads/${encodeURIComponent(thread.id)}`;
  const snapshot = await get(`${path}/bounded`);
  roundTrip(threadCodecs, { kind: "snapshot", ...snapshot }, thread.id);
  counts.threads += 1;
  if (typeof snapshot.historyCursor !== "string") continue;
  const query = new URLSearchParams({ cursor: snapshot.historyCursor });
  roundTrip(pageCodecs, await get(`${path}/history?${query}`), `${thread.id} history`);
  counts.pages += 1;
}

console.log(
  `Round-tripped ${counts.shell} shell snapshot, ${counts.threads} thread snapshots and ${counts.pages} history pages.`,
);
for (const failure of failures) console.error(failure);
process.exit(failures.length === 0 ? 0 : 1);
