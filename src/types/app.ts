import type { WorkspaceIconKey } from "../lib/ui/workspaceIcons";

export type AppRoute =
  | "dashboard"
  | "trades"
  | "journal"
  | "library"
  | "playbooks"
  | "reports"
  | "import"
  | "data";

export interface AppNavItem {
  id: AppRoute;
  label: string;
  icon: WorkspaceIconKey;
}
