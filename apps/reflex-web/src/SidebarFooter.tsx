import Environment from "./Environment";
import { ChartNoAxesColumn, Settings } from "./icons";
import { useSidebarSheet } from "./viewport";

const footerButton =
  "icon-button text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground aria-[current=page]:bg-sidebar-accent aria-[current=page]:text-sidebar-foreground";
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
      <button
        class={footerButton}
        aria-current={current(view()?.Kind === "settings")}
        aria-label="Settings"
        data-tip="Settings"
        onClick={() => go("settings")}
      >
        <Settings />
      </button>
      <button
        class={footerButton}
        aria-current={current(view()?.Kind === "usage")}
        aria-label="Usage"
        data-tip="Usage"
        onClick={() => go("usage")}
      >
        <ChartNoAxesColumn />
      </button>
    </footer>
  );
}
