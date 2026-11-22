import Environment from "./Environment";
import { Settings } from "./icons";
import {
  SidebarFooter as Footer,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "./ui/Sidebar";
import { useSidebarSheet } from "./viewport";

export function SidebarFooter() {
  const environment = Environment.use();
  const sidebar = useSidebarSheet();
  return (
    <Footer>
      <SidebarMenu layout="row">
        <SidebarMenuItem class="shrink-0">
          <SidebarMenuButton
            size="icon"
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
        </SidebarMenuItem>
      </SidebarMenu>
    </Footer>
  );
}
