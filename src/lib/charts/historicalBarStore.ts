import type { HistoricalBarSet } from "../../types/chart";

const STORAGE_KEY = "trade-engine-historical-bars";

export const buildBarSetKey = (symbol: string, tradeDate: string): string => `${symbol}__${tradeDate}`;

export const loadHistoricalBarSets = (): HistoricalBarSet[] => {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as HistoricalBarSet[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const saveHistoricalBarSets = (barSets: HistoricalBarSet[]): void => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(barSets));
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
