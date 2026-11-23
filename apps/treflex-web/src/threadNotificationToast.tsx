import { CircleAlert, CircleCheck, MessageCircleQuestion, ShieldQuestion } from "./icons";
import type { INotificationStatus } from "./threadNotifications";
import { toastManager } from "./ui/toastStore";

function leadingIcon(status: INotificationStatus) {
  switch (status) {
    case "completion":
      return <CircleCheck aria-hidden="true" class="size-4 text-success-foreground" />;
    case "approval":
      return <ShieldQuestion aria-hidden="true" class="size-4 text-warning-foreground" />;
    case "limited":
      return <CircleAlert aria-hidden="true" class="size-4 text-warning-foreground" />;
    case "failed":
      return <CircleAlert aria-hidden="true" class="size-4 text-destructive-foreground" />;
    default:
      return <MessageCircleQuestion aria-hidden="true" class="size-4 text-info-foreground" />;
  }
}

/** Follows the in-app branch of `present` in apps/web/src/components/ThreadNotificationCoordinator.tsx. */
export function showThreadToast(
  note: { Status: INotificationStatus; Title: string; Body: string },
  open: () => void,
  onRemove: () => void,
): string {
  const id: string = toastManager.add({
    type: note.Status === "completion" ? "success" : note.Status === "failed" ? "error" : "warning",
    title: note.Title,
    description: note.Body,
    onRemove,
    data: { hideCopyButton: true, leadingIcon: leadingIcon(note.Status) },
    actionProps: {
      children: "Open thread",
      onClick: () => {
        toastManager.close(id);
        open();
      },
    },
  });
  return id;
}

export const closeThreadToast = (id: string) => toastManager.close(id);
