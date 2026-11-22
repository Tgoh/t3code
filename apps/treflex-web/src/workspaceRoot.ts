import Environment from "./Environment";
import OpenThread from "./OpenThread";

export function useWorkspaceRoot(): () => string | undefined {
  const thread = OpenThread.use();
  const environment = Environment.use();
  return () => {
    const held = thread.state.Thread;
    if (held === null) return undefined;
    return (
      held.worktreePath ??
      environment.state.Replica.Shell.Projects[held.projectId]?.workspaceRoot ??
      undefined
    );
  };
}
