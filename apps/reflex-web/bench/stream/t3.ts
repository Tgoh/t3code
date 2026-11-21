// @effect-diagnostics nodeBuiltinImport:off -- A Node script that drives the server CLI, outside any Effect runtime.
import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";

const repoRoot = NodePath.resolve(import.meta.dirname, "../../../..");
const serverDir = NodePath.join(repoRoot, "apps/server");

export const defaultBaseDir = NodePath.join(repoRoot, ".t3");

const argv = (baseDir: string, command: ReadonlyArray<string>, args: ReadonlyArray<string>) => [
  "src/bin.ts",
  ...command,
  "--base-dir",
  baseDir,
  ...args,
];

/** Runs `t3 <command> --base-dir <baseDir> <args>` from this checkout's server source. */
export function t3(
  baseDir: string,
  command: ReadonlyArray<string>,
  args: ReadonlyArray<string>,
): string {
  const result = NodeChildProcess.spawnSync(process.execPath, argv(baseDir, command, args), {
    cwd: serverDir,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`t3 ${command.join(" ")} exited ${result.status}: ${result.stderr}`);
  }
  return result.stdout;
}

/** Starts a Replay showcase thread and returns its id once its first turn has finished. */
export function startReplayThread(baseDir: string, project: string, title: string): string {
  const out = t3(
    baseDir,
    ["thread", "start"],
    ["--provider", "devReplay", "--model", "showcase", "--title", title, "--wait", "--json"].concat(
      [project, "go"],
    ),
  );
  return (JSON.parse(out) as { threadId: string }).threadId;
}

/** Sends one turn and resolves when it has finished. */
export function sendTurn(baseDir: string, threadId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    NodeChildProcess.execFile(
      process.execPath,
      argv(baseDir, ["thread", "send"], ["--wait", "--json", threadId, "go"]),
      { cwd: serverDir, encoding: "utf8" },
      (error, _stdout, stderr) =>
        error ? reject(new Error(`${error.message}\n${stderr}`)) : resolve(),
    );
  });
}

/** A one-time pairing credential for the running server. */
export function pairingCredential(baseDir: string): string {
  const out = t3(baseDir, ["auth", "pairing", "create"], ["--json"]);
  return (JSON.parse(out) as { credential: string }).credential;
}
