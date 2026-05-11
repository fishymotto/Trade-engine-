import type { HistoricalBarSet } from "../../types/chart";
import { canUseMachineLegacyData, syncStores } from "../sync/syncStore";
import { loadDesktopStoreBackup, saveDesktopStoreBackup } from "../storage/desktopStoreBackup";

export const buildBarSetKey = (symbol: string, tradeDate: string): string => `${symbol}__${tradeDate}`;

export const loadHistoricalBarSets = (): HistoricalBarSet[] => {
  const parsed = syncStores.historicalBars.load<HistoricalBarSet[]>([]);
  return Array.isArray(parsed) ? parsed : [];
};

const normalizeHistoricalBarSets = (value: unknown): HistoricalBarSet[] =>
  Array.isArray(value) ? (value as HistoricalBarSet[]) : [];

const getSerializedSize = (value: unknown): number => {
  try {
    return JSON.stringify(value).length;
  } catch {
    return 0;
  }
};

const getLatestTimestamp = (barSets: HistoricalBarSet[]): number =>
  barSets.reduce((latest, barSet) => {
    const parsed = Date.parse(barSet.updatedAt || "");
    return Number.isFinite(parsed) ? Math.max(latest, parsed) : latest;
  }, 0);

const shouldUseDesktopHistoricalBarsForRecovery = (
  localBarSets: HistoricalBarSet[],
  desktopBarSets: HistoricalBarSet[]
): boolean => {
  if (desktopBarSets.length === 0) {
    return false;
  }

  if (localBarSets.length === 0) {
    return true;
  }

  if (desktopBarSets.length > localBarSets.length) {
    return true;
  }

  const localSize = getSerializedSize(localBarSets);
  const desktopSize = getSerializedSize(desktopBarSets);
  if (desktopSize > localSize) {
    return true;
  }

  return getLatestTimestamp(desktopBarSets) > getLatestTimestamp(localBarSets) && desktopSize >= localSize;
};

export const persistHistoricalBarSets = async (barSets: HistoricalBarSet[]): Promise<void> => {
  const normalized = normalizeHistoricalBarSets(barSets);
  const syncPromise = syncStores.historicalBars.save(normalized);
  const activeUserId = syncStores.historicalBars.getUserId();

  if (canUseMachineLegacyData(activeUserId)) {
    try {
      await saveDesktopStoreBackup("historical-bars", normalized);
    } catch (error) {
      console.warn("[bars] Failed to save desktop historical bars backup.", error);
    }
  }

  await syncPromise;
};

export const loadHistoricalBarSetsFromDesktopBackup = async (): Promise<HistoricalBarSet[] | null> =>
  normalizeHistoricalBarSets(await loadDesktopStoreBackup<HistoricalBarSet[]>("historical-bars"));

export const recoverHistoricalBarSetsFromDesktopBackup = async (
  localBarSets = loadHistoricalBarSets()
): Promise<HistoricalBarSet[] | null> => {
  const activeUserId = syncStores.historicalBars.getUserId();
  if (!canUseMachineLegacyData(activeUserId)) {
    return null;
  }

  const desktopBarSets = await loadHistoricalBarSetsFromDesktopBackup();
  if (!desktopBarSets || !shouldUseDesktopHistoricalBarsForRecovery(localBarSets, desktopBarSets)) {
    return null;
  }

  await persistHistoricalBarSets(desktopBarSets);
  return desktopBarSets;
};

export const saveHistoricalBarSets = (barSets: HistoricalBarSet[]): void => {
  void persistHistoricalBarSets(barSets);
};

export const upsertHistoricalBarSet = (
  currentBarSets: HistoricalBarSet[],
  nextBarSet: HistoricalBarSet
): HistoricalBarSet[] => {
  const filtered = currentBarSets.filter((set) => set.key !== nextBarSet.key);
  return [nextBarSet, ...filtered].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
};

export const removeHistoricalBarSet = (
  currentBarSets: HistoricalBarSet[],
  key: string
): HistoricalBarSet[] => currentBarSets.filter((set) => set.key !== key);
