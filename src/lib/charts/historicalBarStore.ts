import type { HistoricalBarSet } from "../../types/chart";
import { syncStores } from "../sync/syncStore";

export const buildBarSetKey = (symbol: string, tradeDate: string): string => `${symbol}__${tradeDate}`;

export const loadHistoricalBarSets = (): HistoricalBarSet[] => {
  const parsed = syncStores.historicalBars.load<HistoricalBarSet[]>([]);
  return Array.isArray(parsed) ? parsed : [];
};

export const saveHistoricalBarSets = (barSets: HistoricalBarSet[]): void => {
  void syncStores.historicalBars.save(barSets);
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
