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

export type PlaybookDetailPage = "playbook" | "tagged-charts" | "trades" | "a-plus";
export type LibrarySection = "collections" | "playbooks" | "chart-library";

export interface LibraryNavigationState {
  activeSection: LibrarySection;
}

export interface PlaybooksNavigationState {
  selectedPlaybookId: string | null;
  activePlaybookPage: PlaybookDetailPage;
}

export interface AppRouteSnapshot {
  route: AppRoute;
  library: LibraryNavigationState;
  playbooks: PlaybooksNavigationState;
}
