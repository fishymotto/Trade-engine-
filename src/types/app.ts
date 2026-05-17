import type { WorkspaceIconKey } from "../lib/ui/workspaceIcons";

export type AppRoute =
  | "dashboard"
  | "trades"
  | "trade-database"
  | "journal"
  | "library"
  | "playbooks"
  | "reports"
  | "import"
  | "data"
  | "settings";

export interface AppNavItem {
  id: AppRoute;
  label: string;
  icon: WorkspaceIconKey;
}
