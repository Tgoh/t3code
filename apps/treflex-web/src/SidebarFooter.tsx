import Environment from "./Environment";
import { Settings } from "./icons";
import { IconButton } from "./ui/IconButton";
import { useSidebarSheet } from "./viewport";

// Follows SidebarUtilityMenu in apps/web/src/components/sidebar/SidebarChrome.tsx, without its
// pull requests and usage buttons.
export function SidebarFooter() {
  const environment = Environment.use();
  const sidebar = useSidebarSheet();
  return (
    <footer class="mt-auto flex flex-none items-center gap-0.5 px-2 pt-1.5 pb-[calc(6px+env(safe-area-inset-bottom))]">
      <IconButton
        variant="sidebar-footer"
        aria-current={environment.state.Local.View?.Kind === "settings" ? "page" : undefined}
        aria-label="Settings"
        data-tip="Settings"
        onClick={() => {
          sidebar.setOpen(false);
          void environment.openView({ Kind: "settings", Page: "general" });
        }}
      >
        <Settings />
      </IconButton>
    </footer>
  );
}
