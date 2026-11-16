import Environment from "./Environment";
import { ChartNoAxesColumn, Settings } from "./icons";
import { useSidebarSheet } from "./viewport";

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
    <footer class="sidebar-footer">
      <button
        class="icon-button"
        classList={{ pressed: view()?.Kind === "settings" }}
        aria-label="Settings"
        data-tip="Settings"
        onClick={() => go("settings")}
      >
        <Settings />
      </button>
      <button
        class="icon-button"
        classList={{ pressed: view()?.Kind === "usage" }}
        aria-label="Usage"
        data-tip="Usage"
        onClick={() => go("usage")}
      >
        <ChartNoAxesColumn />
      </button>
    </footer>
  );
}
