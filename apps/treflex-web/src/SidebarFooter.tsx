import Environment from "./Environment";
import { Settings } from "./icons";
import { SidebarMenuButton } from "./ui/Sidebar";
import { useSidebarSheet } from "./viewport";

// Follows SidebarUtilityMenu in apps/web/src/components/sidebar/SidebarChrome.tsx, without its
// pull requests and usage buttons.
export function SidebarFooter() {
  const environment = Environment.use();
  const sidebar = useSidebarSheet();
  return (
    <footer class="mt-auto flex flex-none items-center gap-0.5 px-2 pt-1.5 pb-[calc(6px+env(safe-area-inset-bottom))]">
      <SidebarMenuButton
        size="icon"
        class="shrink-0"
        isActive={environment.state.Local.View?.Kind === "settings"}
        aria-current={environment.state.Local.View?.Kind === "settings" ? "page" : undefined}
        aria-label="Settings"
        data-tip="Settings"
        onClick={() => {
          sidebar.setOpen(false);
          void environment.openView({ Kind: "settings", Page: "general" });
        }}
      >
        <Settings />
      </SidebarMenuButton>
    </footer>
  );
}
