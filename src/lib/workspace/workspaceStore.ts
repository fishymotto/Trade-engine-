import type { ChartInterval } from "../../types/chart";
import type { AppRoute } from "../../types/app";
import type { GroupedTrade } from "../../types/trade";
import { canUseMachineLegacyData, syncStores } from "../sync/syncStore";
import { loadDesktopStoreBackup, saveDesktopStoreBackup } from "../storage/desktopStoreBackup";

export interface WorkspaceTradeFilters {
  tradeDateStart: string;
  tradeDateEnd: string;
  playbook: string;
  symbol: string;
  status: string;
  game: string;
  execution: string;
}

export interface WorkspaceState {
  activeRoute: AppRoute;
  loadedTradeDates: string[];
  loadedTrades: GroupedTrade[];
  fileName: string;
  isCurrentImportSaved: boolean;
  reviewChartInterval: ChartInterval;
  dayChartInterval: ChartInterval;
  selectedJournalPageId: string;
  focusedTradeId: string;
  tradeFilters: WorkspaceTradeFilters;
}

export const defaultWorkspaceTradeFilters: WorkspaceTradeFilters = {
  tradeDateStart: "",
  tradeDateEnd: "",
  playbook: "all",
  symbol: "all",
  status: "all",
  game: "all",
  execution: "all"
};

export const defaultWorkspaceState: WorkspaceState = {
  activeRoute: "dashboard",
  loadedTradeDates: [],
  loadedTrades: [],
  fileName: "",
  isCurrentImportSaved: false,
  reviewChartInterval: "1m",
  dayChartInterval: "1D",
  selectedJournalPageId: "",
  focusedTradeId: "",
  tradeFilters: defaultWorkspaceTradeFilters
};

const normalizeLoadedTradeDates = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0) : [];

const normalizeLoadedTrades = (value: unknown): GroupedTrade[] =>
  Array.isArray(value) ? value.filter((entry): entry is GroupedTrade => Boolean(entry && typeof entry === "object")) : [];

const normalizeTradeFilters = (value: unknown): WorkspaceTradeFilters => {
  if (!value || typeof value !== "object") {
    return defaultWorkspaceTradeFilters;
  }

  const record = value as Partial<WorkspaceTradeFilters>;
  return {
    tradeDateStart: typeof record.tradeDateStart === "string" ? record.tradeDateStart : "",
    tradeDateEnd: typeof record.tradeDateEnd === "string" ? record.tradeDateEnd : "",
    playbook: typeof record.playbook === "string" && record.playbook.trim().length > 0 ? record.playbook : "all",
    symbol: typeof record.symbol === "string" && record.symbol.trim().length > 0 ? record.symbol : "all",
    status: typeof record.status === "string" && record.status.trim().length > 0 ? record.status : "all",
    game: typeof record.game === "string" && record.game.trim().length > 0 ? record.game : "all",
    execution:
      typeof record.execution === "string" && record.execution.trim().length > 0 ? record.execution : "all"
  };
};

const normalizeWorkspaceState = (state: unknown): WorkspaceState => {
  const parsed = state && typeof state === "object" ? (state as Partial<WorkspaceState>) : {};
  const loadedTrades = normalizeLoadedTrades(parsed.loadedTrades);
  const loadedTradeDates = Array.from(
    new Set([
      ...normalizeLoadedTradeDates(parsed.loadedTradeDates),
      ...loadedTrades
        .map((trade) => trade.tradeDate)
        .filter((tradeDate): tradeDate is string => typeof tradeDate === "string" && tradeDate.trim().length > 0)
    ])
  ).sort();

  return {
    ...defaultWorkspaceState,
    ...parsed,
    loadedTradeDates,
    loadedTrades,
    selectedJournalPageId:
      typeof parsed.selectedJournalPageId === "string" ? parsed.selectedJournalPageId : "",
    focusedTradeId: typeof parsed.focusedTradeId === "string" ? parsed.focusedTradeId : "",
    tradeFilters: normalizeTradeFilters(parsed.tradeFilters)
  };
};

export const loadWorkspaceState = (): WorkspaceState => {
  return normalizeWorkspaceState(syncStores.workspaceState.load<WorkspaceState>(defaultWorkspaceState));
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
  const normalizedState = normalizeWorkspaceState(state);
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

  const desktopState = normalizeWorkspaceState(desktopStateRaw);

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
