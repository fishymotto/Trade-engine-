import type { ChartInterval } from "../../types/chart";
import type { AppRoute } from "../../types/app";
import { syncStores } from "../sync/syncStore";

export interface WorkspaceState {
  activeRoute: AppRoute;
  loadedTradeDates: string[];
  fileName: string;
  isCurrentImportSaved: boolean;
  reviewChartInterval: ChartInterval;
  dayChartInterval: ChartInterval;
}

export const defaultWorkspaceState: WorkspaceState = {
  activeRoute: "dashboard",
  loadedTradeDates: [],
  fileName: "",
  isCurrentImportSaved: false,
  reviewChartInterval: "1m",
  dayChartInterval: "1D"
};

export const loadWorkspaceState = (): WorkspaceState => {
  const parsed = syncStores.workspaceState.load<WorkspaceState>(defaultWorkspaceState);
  return {
    ...defaultWorkspaceState,
    ...(parsed && typeof parsed === "object" ? parsed : {}),
    loadedTradeDates: Array.isArray(parsed?.loadedTradeDates) ? parsed.loadedTradeDates : []
  };
};

export const saveWorkspaceState = (state: WorkspaceState): void => {
  void syncStores.workspaceState.save(state);
};
