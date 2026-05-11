import type { ChartInterval } from "../../types/chart";
import type { AppRoute } from "../../types/app";
import { canUseMachineLegacyData, syncStores } from "../sync/syncStore";
import { loadDesktopStoreBackup, saveDesktopStoreBackup } from "../storage/desktopStoreBackup";

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

const stableStringify = (value: unknown): string => {
  if (value === null || value === undefined) {
    return JSON.stringify(value);
  }

  if (typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
};

export const persistWorkspaceState = async (state: WorkspaceState): Promise<WorkspaceState> => {
  const normalizedState: WorkspaceState = {
    ...defaultWorkspaceState,
    ...(state && typeof state === "object" ? state : {}),
    loadedTradeDates: Array.isArray(state?.loadedTradeDates) ? state.loadedTradeDates : []
  };
  const syncPromise = syncStores.workspaceState.save(normalizedState);
  const activeUserId = syncStores.workspaceState.getUserId();

  if (canUseMachineLegacyData(activeUserId)) {
    try {
      await saveDesktopStoreBackup("workspace-state", normalizedState);
    } catch (error) {
      console.warn("[workspace] Failed to save desktop workspace state backup.", error);
    }
  }

  await syncPromise;
  return normalizedState;
};

export const recoverWorkspaceStateFromDesktopBackup = async (
  localState = loadWorkspaceState()
): Promise<WorkspaceState | null> => {
  const activeUserId = syncStores.workspaceState.getUserId();
  if (!canUseMachineLegacyData(activeUserId)) {
    return null;
  }

  const desktopStateRaw = await loadDesktopStoreBackup<WorkspaceState>("workspace-state");
  if (!desktopStateRaw) {
    return null;
  }

  const desktopState: WorkspaceState = {
    ...defaultWorkspaceState,
    ...(desktopStateRaw && typeof desktopStateRaw === "object" ? desktopStateRaw : {}),
    loadedTradeDates: Array.isArray(desktopStateRaw.loadedTradeDates) ? desktopStateRaw.loadedTradeDates : []
  };

  if (
    stableStringify(desktopState) === stableStringify(defaultWorkspaceState) ||
    stableStringify(desktopState) === stableStringify(localState)
  ) {
    return null;
  }

  if (stableStringify(localState) !== stableStringify(defaultWorkspaceState)) {
    return null;
  }

  await persistWorkspaceState(desktopState);
  return desktopState;
};

export const saveWorkspaceState = (state: WorkspaceState): void => {
  void persistWorkspaceState(state);
};
