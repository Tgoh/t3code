import Environment from "./Environment";
import { ChartNoAxesColumn, Settings } from "./icons";
import { IconButton } from "./ui/IconButton";
import { useSidebarSheet } from "./viewport";

const current = (on: boolean) => (on ? "page" : undefined);

// Follows SidebarUtilityMenu in apps/web/src/components/sidebar/SidebarChrome.tsx, without its
// pull requests button.
export function SidebarFooter() {
  const environment = Environment.use();
  const sidebar = useSidebarSheet();
  const view = () => environment.state.Local.View;
  const go = (next: "settings" | "usage") => {
    sidebar.setOpen(false);
    void environment.openView(
      next === "usage" ? { Kind: "usage" } : { Kind: "settings", Page: "general" },
    );
  };
  return (
    <footer class="mt-auto flex flex-none items-center gap-0.5 px-2 pt-1.5 pb-[calc(6px+env(safe-area-inset-bottom))]">
      <IconButton
        variant="sidebar-footer"
        aria-current={current(view()?.Kind === "settings")}
        aria-label="Settings"
        data-tip="Settings"
        onClick={() => go("settings")}
      >
        <Settings />
      </IconButton>
      <IconButton
        variant="sidebar-footer"
        aria-current={current(view()?.Kind === "usage")}
        aria-label="Usage"
        data-tip="Usage"
        onClick={() => go("usage")}
      >
        <ChartNoAxesColumn />
      </IconButton>
    </footer>
  );
}
