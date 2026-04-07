import type { ChartInterval } from "../../types/chart";
import type { AppRoute } from "../../types/app";

const STORAGE_KEY = "trade-engine-workspace";

export interface WorkspaceState {
  activeRoute: AppRoute;
  loadedTradeDates: string[];
  fileName: string;
  isCurrentImportSaved: boolean;
  reviewChartInterval: ChartInterval;
  dayChartInterval: ChartInterval;
}

const defaultWorkspaceState: WorkspaceState = {
  activeRoute: "dashboard",
  loadedTradeDates: [],
  fileName: "",
  isCurrentImportSaved: false,
  reviewChartInterval: "1m",
  dayChartInterval: "1D"
};

export const loadWorkspaceState = (): WorkspaceState => {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return defaultWorkspaceState;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<WorkspaceState>;
    return {
      ...defaultWorkspaceState,
      ...parsed,
      loadedTradeDates: Array.isArray(parsed.loadedTradeDates) ? parsed.loadedTradeDates : []
    };
  } catch {
    return defaultWorkspaceState;
  }
};

export const saveWorkspaceState = (state: WorkspaceState): void => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
};
