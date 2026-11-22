# Wire round trip

Checks the tree's codec (`wireCodec` in `src/Infrastructure/wire.ts`) against real server data. For the shell snapshot, every thread's bounded snapshot and each thread's first history page, it decodes with the full JSON codec, encodes with `wireCodec`, and decodes that again. Each must come back equal, with no throw. Run it after a contracts change or an upstream sync.

Run from the worktree root:

1. Seed the worktree's `.t3` with real data: `vp run migrate-dev-db`. If the source isn't `~/.t3/userdata/statev2.sqlite`, pass it with `--source`.
2. Start the dev server: `vp run dev`. Its port is the `serverPort` on the `[dev-runner]` line.
3. Mint a pairing credential, from `apps/server`: `node src/bin.ts pair --base-dir ../../.t3`. Use the `Token:` it prints.
4. From `apps/reflex-web`: `node bench/wire/roundTrip.ts --server http://localhost:<serverPort> --credential <token>`.

It prints the counts, then one line for each value that fails, and exits 1 if any did. The data stays on your machine: don't commit what it fetches.
